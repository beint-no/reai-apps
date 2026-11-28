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
/** @typedef {{ date: string, ref: string, payments: Payment[], sales: SalesRate[] }} Settlement */
/** @typedef {{ account: string, description: string, signedMinor: number, ratePct: number | null }} VoucherLine */
/** @typedef {{ date: string, ref: string, lines: VoucherLine[], debitMinor: number, creditMinor: number }} Voucher */
/** @typedef {{ code: string, rate: number, vatType: string, amountBasis: string, reverseCharge: boolean }} VatCode */

const SLUG = 'front-systems';
const BRAND = 'Front Systems';
const BASE_PATH = '/app/front-systems';
const TITLE = 'Front Systems POS Settlements';
const EYEBROW = 'RETAIL POS · NORWAY';
const LEAD = 'Turn the Front Systems POS settlements for one day into a balanced ReAI review voucher, split by payment type and VAT rate.';
const API_HINT = 'You need two keys: the subscription key from your profile on developer.frontsystems.com, and an API key from Front Systems Portal under Admin → Integration users. Leave store id empty to include every store.';
/** @type {import('../../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [
  { name: 'subscriptionKey', label: 'Subscription key (developer portal)', type: 'password', placeholder: 'Ocp-Apim-Subscription-Key' },
  { name: 'apiKey', label: 'API key (Integration users)', type: 'password', placeholder: 'x-api-key' },
  { name: 'storeId', label: 'Store id (optional)', required: false },
  { name: 'date', label: 'Settlement date', type: 'date', defaultValue: '$TODAY' },
];
const API = 'https://frontsystemsapis.frontsystems.no/restapi/V2';

/** @type {Record<string, string>} */
const REVENUE_ACCOUNTS = { 25: '3000', 15: '3010', 12: '3020' };

/** @type {Settlement} */
const SAMPLE = {
  date: '2026-10-24',
  ref: 'Z 1042',
  payments: [
    { label: 'Kontant', amountMinor: 245000, account: '1900' },
    { label: 'Bankkort', amountMinor: 1895000, account: '1580' },
    { label: 'Vipps', amountMinor: 610000, account: '1580' },
  ],
  sales: [
    { ratePct: 25, grossMinor: 2700000, account: '3000', label: 'Salg 25 % MVA' },
    { ratePct: 0, grossMinor: 50000, account: '3100', label: 'Salg 0 % MVA' },
  ],
};

/**
 * Reads a field from a Front Systems DTO. The developer portal shows PascalCase keys and the
 * backend Swagger shows camelCase keys for the same SettlementDto, so both are accepted.
 * @param {any} obj
 * @param {string} key camelCase key
 */
function field(obj, key) {
  if (!obj || typeof obj !== 'object') return undefined;
  if (key in obj) return obj[key];
  const pascal = key[0]?.toUpperCase() + key.slice(1);
  if (pascal in obj) return obj[pascal];
  const upper = key.toUpperCase();
  return Object.entries(obj).find(([k]) => k.toUpperCase() === upper)?.[1];
}

/** @param {unknown} v */
function minor(v) {
  return Math.round(num(v) * 100);
}

/** @param {string} label */
function paymentAccount(label) {
  return /(cash|kontant)/i.test(label) ? '1900' : '1580';
}

/** @param {number} ratePct */
function revenueAccount(ratePct) {
  return REVENUE_ACCOUNTS[String(ratePct)] ?? '3100';
}

/**
 * Fetches one day's POS settlements from the Front Systems REST API.
 * Docs: https://developer.frontsystems.com/quickstart (Ocp-Apim-Subscription-Key from the developer
 * portal plus x-api-key from Front Systems Portal → Admin → Integration users) and
 * https://developer.frontsystems.com/api-details#api=front-systems-webshop-api-V2&operation=62ff835221446f431685d5f0
 * (GET /api/Possettlementv2?date=yyyy-mm-dd with offset, limit, storeId and includePaymentTypes; gateway
 * frontsystemsapis.frontsystems.no, path restapi/V2). The response is a SettlementDto per register
 * (also described at https://webapi.frontsystems.no/swagger/v1/swagger.json): PaymentTypes carry the
 * amount and ledger account per payment type, and SAFT_ZReport.reportCashSalesVat carries the sales per
 * VAT rate.
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<Settlement>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const date = isoDate(creds.date);
  const subscriptionKey = (creds.subscriptionKey ?? '').trim();
  const apiKey = (creds.apiKey ?? '').trim();
  const storeId = (creds.storeId ?? '').trim();
  if (!subscriptionKey || !apiKey) throw new HttpError(400, 'Enter both the Front Systems subscription key and API key.');
  if (storeId && !/^[0-9]+$/.test(storeId)) throw new HttpError(400, 'Store id must be a number.');
  const headers = { 'ocp-apim-subscription-key': subscriptionKey, 'x-api-key': apiKey, accept: 'application/json' };

  /** @type {any[]} */ const settlements = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const query = new URLSearchParams({ date, includePaymentTypes: 'true', offset: String(offset), limit: '100' });
    if (storeId) query.set('storeId', storeId);
    const data = await fetchJson(`${API}/api/Possettlementv2?${query}`, { headers }, BRAND, fetchImpl);
    const page = Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : [];
    settlements.push(...page);
    if (page.length < 100) break;
  }
  if (settlements.length === 0) throw new HttpError(400, `${BRAND} has no POS settlements dated ${date}.`);

  /** @type {Map<string, Payment>} */ const payments = new Map();
  /** @type {Map<string, SalesRate>} */ const sales = new Map();
  /** @type {string[]} */ const refs = [];
  for (const s of settlements) {
    const currency = String(field(s, 'currency') ?? 'NOK').trim().toUpperCase() || 'NOK';
    if (currency !== 'NOK') throw new HttpError(400, `Settlement ${String(field(s, 'settlementId'))} is in ${currency}. Only NOK settlements can be booked.`);
    refs.push(String(field(s, 'batchNumber') ?? field(s, 'settlementId') ?? ''));
    const z = field(s, 'safT_ZReport') ?? {};

    /** @type {any[]} */ const paymentTypes = Array.isArray(field(s, 'paymentTypes')) ? field(s, 'paymentTypes') : [];
    /** @type {any[]} */ const zPayments = Array.isArray(field(z, 'reportPayments')) ? field(z, 'reportPayments') : [];
    const source = paymentTypes.length > 0
      ? paymentTypes.map((p) => ({ label: [field(p, 'type'), field(p, 'subType')].filter(Boolean).join(' ').trim(), amount: field(p, 'amount'), account: String(field(p, 'accountNumber') ?? '').trim() }))
      : zPayments.map((p) => ({ label: String(field(p, 'paymentType') ?? '').trim(), amount: field(p, 'paymentAmnt'), account: String(field(p, 'accID') ?? '').trim() }));
    for (const p of source) {
      const amountMinor = minor(p.amount);
      if (amountMinor === 0) continue;
      const label = p.label || 'Payment';
      const account = /^[0-9]{4}$/.test(p.account) ? p.account : paymentAccount(label);
      const key = `${account}|${label.toLowerCase()}`;
      const prev = payments.get(key);
      payments.set(key, { label, account, amountMinor: (prev?.amountMinor ?? 0) + amountMinor });
    }

    /** @type {any[]} */ const vatLines = Array.isArray(field(z, 'reportCashSalesVat')) ? field(z, 'reportCashSalesVat') : [];
    // cashSaleAmnt is the net or gross amount per VAT code depending on the register. Compare its sum
    // with the settlement's NetTotal and GrandTotal to know whether VAT must be added.
    const saleSum = vatLines.reduce((t, l) => t + num(field(l, 'cashSaleAmnt')), 0);
    const isNet = Math.abs(saleSum - num(field(s, 'netTotal'))) < Math.abs(saleSum - num(field(s, 'grandTotal')));
    for (const l of vatLines) {
      const ratePct = num(field(l, 'vatPerc'));
      const grossMinor = minor(field(l, 'cashSaleAmnt')) + (isNet ? minor(field(l, 'vatAmnt')) : 0);
      if (grossMinor === 0) continue;
      const accID = String(field(l, 'accID') ?? '').trim();
      const account = /^[0-9]{4}$/.test(accID) ? accID : revenueAccount(ratePct);
      const key = `${account}|${ratePct}`;
      const prev = sales.get(key);
      sales.set(key, { ratePct, account, label: `Salg ${ratePct} % MVA`, grossMinor: (prev?.grossMinor ?? 0) + grossMinor });
    }
  }
  if (sales.size === 0) throw new HttpError(400, `${BRAND} returned settlements for ${date} without VAT lines in the Z-report.`);
  return { date, ref: `Z ${refs.filter(Boolean).join(', ')}`.trim(), payments: [...payments.values()], sales: [...sales.values()] };
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
        ${reaiMetric({ label: 'Sales incl. VAT (credit)', value: `${formatMinor(v.creditMinor)} NOK` })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Posting</th><th>VAT</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${v.lines.map((l) => html`<tr><td class="mono">${l.account}</td><td>${l.description}</td><td>${l.ratePct === null ? 'None' : `${l.ratePct}%`}</td><td class="num">${l.signedMinor > 0 ? formatMinor(l.signedMinor) : ''}</td><td class="num">${l.signedMinor < 0 ? formatMinor(-l.signedMinor) : ''}</td></tr>`)}</tbody>
      </table></div>
      <p class="muted-note">Sales lines are posted including VAT with the matching ReAI output VAT code, so ReAI separates the taxable base and VAT. Payment accounts come from the payment types in Front Systems; card and Vipps without an account go to clearing account 1580.</p>
      ${balanced && !isSample
        ? html`<form class="stack-sm confirm-box" hx-post="${BASE_PATH}/book" hx-target="#${SLUG}-book" hx-swap="innerHTML">
            <input type="hidden" name="voucherJson" value="${JSON.stringify(v)}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I verified these figures against the ${BRAND} Z-report and will attach it in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="${SLUG}-book" class="stack-sm"></div>`
        : isSample
          ? reaiCallout({ tone: 'info', body: `Sample ${BRAND} settlement loaded. Connect to ReAI and fetch a real day above to book it.` })
          : reaiCallout({ tone: 'warn', body: `Payments and sales do not balance for this day in ${BRAND}. Check the Z-report there before booking.` })}
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
 * Handles /app/front-systems/* routes.
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
          reviewReason: `${BRAND} POS settlement imported via apps.reai.no. Check against the ${BRAND} Z-report.`,
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
