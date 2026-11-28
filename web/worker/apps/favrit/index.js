// @ts-check
import { pairVoucherRows } from '../../lib/voucher-rows.js';
import { fetchJson, isoDate, num, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/** @typedef {{ label: string, amountMinor: number, account: string }} Payment */
/** @typedef {{ ratePct: number, grossMinor: number, account: string, label: string }} SalesRate */
/** @typedef {{ date: string, ref: string, payments: Payment[], sales: SalesRate[], tipsMinor: number }} Settlement */
/** @typedef {{ account: string, description: string, signedMinor: number, ratePct: number | null }} VoucherLine */
/** @typedef {{ date: string, ref: string, lines: VoucherLine[], debitMinor: number, creditMinor: number }} Voucher */
/** @typedef {{ code: string, rate: number, vatType: string, amountBasis: string, reverseCharge: boolean }} VatCode */

const SLUG = 'favrit';
const BRAND = 'Favrit';
const BASE_PATH = '/app/favrit';
const TITLE = 'Favrit Settlement Accounting';
const EYEBROW = 'RESTAURANT ORDERING · NORWAY';
const LEAD = 'Turn the Favrit settlements created on one day into a balanced ReAI review voucher with sales per account and VAT rate, tips and payment fees.';
const API_HINT = 'Create a client app in Favrit admin under Company Settings → Integration → Developer → Integrate to Favrit with the prod/accounting scope (add prod/user to look up locations). Leave location id empty if you have one location.';
/** @type {import('../../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [
  { name: 'clientId', label: 'Client id', placeholder: 'ClientId' },
  { name: 'clientSecret', label: 'Secret id', type: 'password', placeholder: 'SecretId' },
  { name: 'locationId', label: 'Location id (optional)', required: false },
  { name: 'date', label: 'Settlement created on', type: 'date', defaultValue: '$TODAY' },
];
const AUTH = 'https://accounting-api-auth.favrit.com/oauth2/token';
const API = 'https://favrit.com/ws/accounting-api-service/v1/api';

/** @type {Record<string, string>} */
const REVENUE_ACCOUNTS = { 25: '3000', 15: '3010', 12: '3020' };

/** @type {Settlement} */
const SAMPLE = {
  date: '2026-10-24',
  ref: 'settlement 131214',
  payments: [
    { label: 'Payout clearing', amountMinor: 4770000, account: '1580' },
    { label: 'Payment fees', amountMinor: 85000, account: '7770' },
  ],
  sales: [
    { ratePct: 25, grossMinor: 3850000, account: '3000', label: 'Mat' },
    { ratePct: 25, grossMinor: 815000, account: '3020', label: 'Beer' },
  ],
  tipsMinor: 190000,
};

/** @param {unknown} v */
function minor(v) {
  return Math.round(num(v) * 100);
}

/** @param {number} ratePct */
function revenueAccount(ratePct) {
  return REVENUE_ACCOUNTS[String(ratePct)] ?? '3100';
}

/**
 * Fetches the Favrit settlements created on one day and their accounting reports.
 * Docs: https://support.favrit.com/getting-started-1 (client app with ClientId and SecretId),
 * https://support.favrit.com/authentication (POST https://accounting-api-auth.favrit.com/oauth2/token,
 * Basic auth, grant_type=client_credentials), https://support.favrit.com/important-urls-and-models
 * (API base https://favrit.com/ws/accounting-api-service, { status, data } envelope),
 * https://support.favrit.com/user-location-api-documentation (GET /v1/api/user/locations, scope prod/user) and
 * https://support.favrit.com/accounting-api-documentation (GET /v1/api/accounting/locations/{id}/settlements and
 * /settlements/{id}/reports?type=json, scope prod/accounting: accountLines with accountReference, vatPercent as a
 * fraction and sumWithVat, plus tipsAmount, deliveryFee and totalPaymentFee).
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<Settlement>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const date = isoDate(creds.date);
  const clientId = (creds.clientId ?? '').trim();
  const clientSecret = (creds.clientSecret ?? '').trim();
  let locationId = (creds.locationId ?? '').trim();
  if (!clientId || !clientSecret) throw new HttpError(400, 'Enter the Favrit client id and secret id.');
  if (locationId && !/^[0-9]+$/.test(locationId)) throw new HttpError(400, 'Location id must be a number.');
  const login = await fetchJson(AUTH, {
    method: 'POST',
    headers: { authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: locationId ? 'prod/accounting' : 'prod/user prod/accounting' }).toString(),
  }, BRAND, fetchImpl);
  const token = typeof login?.access_token === 'string' ? login.access_token : '';
  if (!token) throw new HttpError(400, 'Favrit did not return an access token. Check the client id, secret id and scopes.');
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };

  if (!locationId) {
    const loc = await fetchJson(`${API}/user/locations`, { headers }, BRAND, fetchImpl);
    /** @type {any[]} */ const active = (Array.isArray(loc?.data?.locations) ? loc.data.locations : []).filter((/** @type {any} */ l) => l.active !== false);
    if (active.length !== 1) {
      const list = active.map((l) => `${l.id} ${l.name ?? ''}`.trim()).join(', ');
      throw new HttpError(400, active.length === 0 ? 'Favrit returned no active locations for this client.' : `Choose one Favrit location id: ${list}.`);
    }
    locationId = String(active[0].id);
  }

  const list = await fetchJson(`${API}/accounting/locations/${encodeURIComponent(locationId)}/settlements`, { headers }, BRAND, fetchImpl);
  /** @type {any[]} */ const settlements = (Array.isArray(list?.data?.settlements) ? list.data.settlements : [])
    .filter((/** @type {any} */ s) => String(s.creationDate ?? '').replaceAll('/', '-').slice(0, 10) === date);
  if (settlements.length === 0) throw new HttpError(400, `Favrit lists no settlements created on ${date} for location ${locationId}.`);

  /** @type {Map<string, SalesRate>} */ const sales = new Map();
  let tipsMinor = 0;
  let feeMinor = 0;
  /** @type {string[]} */ const ids = [];
  for (const s of settlements.slice(0, 20)) {
    const sid = String(s.settlementId ?? '');
    if (!/^[0-9]+$/.test(sid)) continue;
    const report = await fetchJson(`${API}/accounting/locations/${encodeURIComponent(locationId)}/settlements/${sid}/reports?type=json`, { headers }, BRAND, fetchImpl);
    const d = report?.data ?? {};
    ids.push(sid);
    for (const l of /** @type {any[]} */ (Array.isArray(d.accountLines) ? d.accountLines : [])) {
      const rawRate = num(l.vatPercent);
      const ratePct = Math.round((rawRate <= 1 ? rawRate * 100 : rawRate) * 100) / 100;
      const grossMinor = minor(l.sumWithVat);
      if (grossMinor === 0) continue;
      const ref = String(l.accountReference ?? '').trim();
      const account = /^[0-9]{4}$/.test(ref) ? ref : revenueAccount(ratePct);
      const key = `${account}|${ratePct}`;
      const prev = sales.get(key);
      sales.set(key, { ratePct, account, label: String(l.accountName ?? `Sales ${ratePct}% VAT`).trim(), grossMinor: (prev?.grossMinor ?? 0) + grossMinor });
    }
    const deliveryMinor = minor(d.deliveryFee);
    if (deliveryMinor !== 0) {
      const prev = sales.get('3000|25|delivery');
      sales.set('3000|25|delivery', { ratePct: 25, account: '3000', label: 'Delivery fee', grossMinor: (prev?.grossMinor ?? 0) + deliveryMinor });
    }
    tipsMinor += minor(d.tipsAmount);
    feeMinor += minor(d.totalPaymentFee);
  }
  if (ids.length === 0) throw new HttpError(400, `Favrit returned no settlement reports for ${date}.`);
  const salesTotal = [...sales.values()].reduce((t, r) => t + r.grossMinor, 0);
  /** @type {Payment[]} */ const payments = [{ label: 'Payout clearing', amountMinor: salesTotal + tipsMinor - feeMinor, account: '1580' }];
  if (feeMinor !== 0) payments.push({ label: 'Payment fees', amountMinor: feeMinor, account: '7770' });
  return { date, ref: `settlement ${ids.join(', ')}`, payments, sales: [...sales.values()], tipsMinor };
}

/** @param {Settlement} s @returns {Voucher} */
function buildVoucher(s) {
  /** @type {VoucherLine[]} */ const lines = [];
  const pfx = `${BRAND} ${s.ref}`;
  for (const p of s.payments) {
    if (p.amountMinor !== 0) lines.push({ account: p.account, description: `${pfx} · ${p.label}`, signedMinor: p.amountMinor, ratePct: null });
  }
  for (const r of s.sales) {
    if (r.grossMinor !== 0) lines.push({ account: r.account, description: `${pfx} · ${r.label}`, signedMinor: -r.grossMinor, ratePct: r.ratePct });
  }
  if (s.tipsMinor !== 0) lines.push({ account: '2930', description: `${pfx} · Staff tips payable`, signedMinor: -s.tipsMinor, ratePct: null });
  const debitMinor = lines.filter((l) => l.signedMinor > 0).reduce((t, l) => t + l.signedMinor, 0);
  const creditMinor = lines.filter((l) => l.signedMinor < 0).reduce((t, l) => t - l.signedMinor, 0);
  return { date: s.date, ref: s.ref, lines, debitMinor, creditMinor };
}

/** @param {Voucher} v @param {boolean} isSample */
function renderPreview(v, isSample) {
  const diff = v.debitMinor - v.creditMinor;
  const balanced = diff === 0 && v.debitMinor > 0;
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI REVIEW VOUCHER`,
    title: `${v.ref} · ${v.date}`,
    badge: balanced ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }) : reaiBadge({ text: `Diff ${formatMinor(Math.abs(diff))} NOK`, tone: 'danger' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Payments (debit)', value: `${formatMinor(v.debitMinor)} NOK` })}
        ${reaiMetric({ label: 'Sales incl. VAT and tips (credit)', value: `${formatMinor(v.creditMinor)} NOK` })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Posting</th><th>VAT</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${v.lines.map((l) => html`<tr><td class="mono">${l.account}</td><td>${l.description}</td><td>${l.ratePct === null ? 'None' : `${l.ratePct}%`}</td><td class="num">${l.signedMinor > 0 ? formatMinor(l.signedMinor) : ''}</td><td class="num">${l.signedMinor < 0 ? formatMinor(-l.signedMinor) : ''}</td></tr>`)}</tbody>
      </table></div>
      <p class="muted-note">Sales lines are posted including VAT with the matching ReAI output VAT code, so ReAI separates the taxable base and VAT. The payout from Favrit goes to clearing account 1580 for bank matching, payment fees to 7770 and tips to 2930. Sales accounts come from the account references in Favrit.</p>
      ${balanced && !isSample
        ? html`<form class="stack-sm confirm-box" hx-post="${BASE_PATH}/book" hx-target="#${SLUG}-book" hx-swap="innerHTML">
            <input type="hidden" name="voucherJson" value="${JSON.stringify(v)}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I verified these figures against the ${BRAND} settlement report and will attach it in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="${SLUG}-book" class="stack-sm"></div>`
        : isSample
          ? reaiCallout({ tone: 'info', body: `Sample ${BRAND} settlement loaded. Connect to ReAI and fetch a real day above to book it.` })
          : reaiCallout({ tone: 'warn', body: `Payments and sales do not balance for this day in ${BRAND}. Check the settlement report there before booking.` })}
    `,
  });
}

/**
 * Picks the ReAI output VAT code for a sales rate (VAT-inclusive amounts).
 * @param {VatCode[]} codes
 * @param {number} ratePct
 */
function outputVatCode(codes, ratePct) {
  const usable = codes.filter((c) => !c.reverseCharge && c.amountBasis === 'vat_inclusive' && Math.abs(c.rate - ratePct) < 0.001);
  const match = ratePct > 0
    ? usable.find((c) => c.vatType === 'output_vat')
    : (usable.find((c) => c.vatType === 'output_vat') ?? usable.find((c) => c.vatType === 'exempt') ?? usable.find((c) => c.vatType === 'outside_scope'));
  if (!match) throw new HttpError(400, `ReAI has no output VAT code for ${ratePct}% in this company.`);
  return match.code;
}

/**
 * Handles /app/favrit/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE_PATH && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE_PATH}/`, request.url), 301);
  if (pathname === `${BASE_PATH}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">${EYEBROW}</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${SLUG}-web`, clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({ basePath: BASE_PATH, targetId: `${SLUG}-output`, brand: BRAND, hint: API_HINT, fields: API_FIELDS, sampleAction: true })}
        <div id="${SLUG}-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderPreview(buildVoucher(SAMPLE), true));
  try {
    const form = await request.formData();
    if (pathname === `${BASE_PATH}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderPreview(buildVoucher(await fetchApi(creds)), false));
    }
    if (pathname === `${BASE_PATH}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('confirm') !== 'on') throw new HttpError(400, 'Confirm the verification checkbox first.');
      const v = /** @type {Voucher} */ (JSON.parse(String(form.get('voucherJson') ?? '{}')));
      if (!Array.isArray(v.lines) || !v.lines.length || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(v.date))) throw new HttpError(400, 'Voucher is empty.');
      const sum = v.lines.reduce((t, l) => t + Math.round(Number(l.signedMinor)), 0);
      if (sum !== 0 || !v.lines.every((l) => /^[0-9]{4}$/.test(String(l.account)))) throw new HttpError(400, 'Voucher must balance to 0.00.');
      const marker = `${BRAND} ${String(v.ref).slice(0, 80)} ${v.date}`;
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (await reaiAll(env, '/api/vouchers', { ...auth, query: { startDate: v.date, endDate: v.date, includeReversed: 'true' } }));
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      const vatCodes = /** @type {VatCode[]} */ (await reaiRequest(env, '/api/vat-codes', auth));
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', {
        ...auth,
        method: 'POST',
        body: {
          date: v.date,
          description: marker,
          reviewReason: `${BRAND} POS settlement imported via apps.reai.no. Check against the ${BRAND} settlement report.`,
          postings: pairVoucherRows(v.lines.map((l) => ({
            accountNumber: String(l.account),
            postingDate: v.date,
            currencyCode: 'NOK',
            amount: Number((Math.round(Number(l.signedMinor)) / 100).toFixed(2)),
            vatCode: l.ratePct === null ? '0' : outputVatCode(vatCodes, Number(l.ratePct)),
            description: String(l.description).slice(0, 200),
          }))),
        },
      }));
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
