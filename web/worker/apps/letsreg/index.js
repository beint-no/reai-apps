// @ts-check
import { pairVoucherRows } from '../../lib/voucher-rows.js';
import { fetchJson, num } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { currentMonthIso, formatMinor, monthBounds } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/** @typedef {{ account: string, description: string, signedMinor: number, ratePct: number | null }} VoucherLine */
/** @typedef {{ date: string, ref: string, lines: VoucherLine[], debitMinor: number, creditMinor: number, orders: number, netMinor: number, reportedNetMinor: number, account: string }} Voucher */
/** @typedef {{ code: string, rate: number, vatType: string, amountBasis: string, reverseCharge: boolean }} VatCode */

const SLUG = 'letsreg';
const BRAND = 'LetsReg';
const BASE_PATH = '/app/letsreg';
const TITLE = 'LetsReg Settlement Accounting';
const EYEBROW = 'EVENTS · REGISTRATION';
const LEAD = 'Turn each LetsReg payout in a month into a balanced ReAI review voucher: registrations per VAT rate, the LetsReg fee and the amount paid out.';
const TOKEN_URL = 'https://legacyapi.deltager.no/token';
const API = 'https://integrate.deltager.no';
const MAX_DETAIL_CALLS = 20;
const CONCURRENCY = 5;
const KNOWN_RATES = [25, 15, 12, 0];
/** @type {Record<string, string>} */
const REVENUE_ACCOUNTS = { 25: '3000', 15: '3010', 12: '3020', 0: '3100' };
const OSLO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** @param {unknown} v */
function minor(v) {
  return Math.round(num(v) * 100);
}

/** @param {unknown} v */
function osloDay(v) {
  const s = String(v ?? '').trim();
  if (!s) return '';
  // Swagger date-time values without an offset are read as Norwegian local time.
  if (!/(Z|[+-][0-9]{2}:?[0-9]{2})$/i.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  return Number.isNaN(t) ? '' : OSLO_DAY.format(t);
}

/**
 * Builds the voucher for one LetsReg settlement from its transactions.
 * @param {any} s Settlement
 * @param {any[]} details SettlementDetail[]
 * @returns {Voucher}
 */
export function settlementVoucher(s, details) {
  /** @type {Map<number, number>} */ const byRate = new Map();
  let feeMinor = 0;
  let netMinor = 0;
  for (const d of details) {
    const gross = minor(d.grossAmount);
    const vat = minor(d.vatAmount);
    const base = gross - vat;
    const implied = base !== 0 ? (vat / base) * 100 : 0;
    const rate = KNOWN_RATES.find((k) => Math.abs(k - implied) < 0.5);
    if (rate === undefined) throw new HttpError(400, `LetsReg order ${String(d.orderId)} has a VAT share (${implied.toFixed(1)}%) that is not a Norwegian rate.`);
    byRate.set(rate, (byRate.get(rate) ?? 0) + gross);
    feeMinor += minor(d.fee);
    netMinor += minor(d.netAmount);
  }
  const ref = `settlement ${String(s.reference || s.id)}`;
  const pfx = `${BRAND} ${ref}`;
  const grossTotal = [...byRate.values()].reduce((t, v) => t + v, 0);
  /** @type {VoucherLine[]} */ const lines = [];
  if (grossTotal - feeMinor !== 0) lines.push({ account: '1580', description: `${pfx} · Paid out by LetsReg`, signedMinor: grossTotal - feeMinor, ratePct: null });
  if (feeMinor !== 0) lines.push({ account: '7770', description: `${pfx} · LetsReg fees`, signedMinor: feeMinor, ratePct: null });
  for (const [rate, gross] of byRate) if (gross !== 0) lines.push({ account: REVENUE_ACCOUNTS[String(rate)] ?? '3000', description: `${pfx} · Registrations ${rate}% VAT`, signedMinor: -gross, ratePct: rate });
  const debitMinor = lines.filter((l) => l.signedMinor > 0).reduce((t, l) => t + l.signedMinor, 0);
  const creditMinor = lines.filter((l) => l.signedMinor < 0).reduce((t, l) => t - l.signedMinor, 0);
  return { date: osloDay(s.payoutDate), ref, lines, debitMinor, creditMinor, orders: details.length, netMinor, reportedNetMinor: minor(s.netAmount), account: String(s.accountNumber ?? '') };
}

/**
 * Logs in with an organiser administrator and reads the LetsReg settlements paid out in one month.
 * Docs: https://help.letsreg.com/nb/articles/13598282-api-integration (POST https://legacyapi.deltager.no/token, form
 * grant_type=password, username, password, affid; Authorization: bearer access_token; GET /organizers for the organiser id)
 * and https://integrate.deltager.no/swagger/v1/swagger.json (Deltager Integration API 2.2.8: GET /organizers,
 * GET /organizers/{organizerId}/settlements returns the last 20 settlements and needs an elevated API role,
 * GET /organizers/{organizerId}/settlements/{settlementId} returns SettlementDetail[] with grossAmount, vatAmount, fee, netAmount).
 * @param {Record<string, string>} creds `username`, `password`, `affid`, `organizerId` (optional), `month`
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<{ organizer: string, vouchers: Voucher[] }>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const username = (creds.username ?? '').trim();
  const password = creds.password ?? '';
  const affid = (creds.affid ?? '').trim() || '1';
  const wantedOrganizer = (creds.organizerId ?? '').trim();
  if (!username || !password) throw new HttpError(400, 'Enter the username and password of a LetsReg organiser administrator.');
  if (!/^[0-9]+$/.test(affid) || (wantedOrganizer && !/^[0-9]+$/.test(wantedOrganizer))) throw new HttpError(400, 'Site id and organiser id are numbers.');
  const bounds = monthBounds((creds.month ?? '').trim());

  const login = await fetchJson(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'password', username, password, affid }).toString(),
  }, BRAND, fetchImpl);
  const token = typeof login?.access_token === 'string' ? login.access_token : '';
  if (!token) throw new HttpError(400, 'LetsReg did not return an access token. Check the username, password and site id.');
  const headers = { authorization: `bearer ${token}`, accept: 'application/json' };

  let organizerId = wantedOrganizer;
  let organizer = wantedOrganizer;
  if (!organizerId) {
    /** @type {any[]} */ const orgs = await fetchJson(`${API}/organizers?Offset=0&Limit=100`, { headers }, BRAND, fetchImpl);
    const list = Array.isArray(orgs) ? orgs : [];
    if (list.length !== 1) throw new HttpError(400, list.length === 0 ? 'This LetsReg user has no organisers.' : `This user has several organisers: ${list.map((o) => `${o.name} (${o.id})`).join(', ')}. Enter the organiser id.`);
    organizerId = String(list[0].id);
    organizer = `${String(list[0].name ?? '')} (${organizerId})`;
  }

  /** @type {any[]} */ const settlements = await fetchJson(`${API}/organizers/${organizerId}/settlements`, { headers }, BRAND, fetchImpl);
  const inMonth = (Array.isArray(settlements) ? settlements : []).filter((s) => {
    const day = osloDay(s.payoutDate);
    return day >= bounds.start && day <= bounds.lastDay;
  }).slice(0, MAX_DETAIL_CALLS);
  if (inMonth.length === 0) throw new HttpError(400, `LetsReg has no settlement paid out in ${bounds.month} among the latest 20 settlements.`);

  /** @type {Voucher[]} */ const vouchers = [];
  for (let i = 0; i < inMonth.length; i += CONCURRENCY) {
    const batch = inMonth.slice(i, i + CONCURRENCY);
    const details = await Promise.all(batch.map((s) => fetchJson(`${API}/organizers/${organizerId}/settlements/${encodeURIComponent(String(s.id))}`, { headers }, BRAND, fetchImpl)));
    batch.forEach((s, j) => vouchers.push(settlementVoucher(s, Array.isArray(details[j]) ? details[j] : [])));
  }
  return { organizer, vouchers: vouchers.sort((a, b) => a.date.localeCompare(b.date)) };
}

/** @returns {Voucher} */
function sampleVoucher() {
  return settlementVoucher(
    { id: 812, reference: 'LR-2026-10-812', payoutDate: '2026-10-15T00:00:00', grossAmount: 18450, netAmount: 17788.5, accountNumber: '12345678903' },
    [
      { orderId: 5001, grossAmount: 12500, vatAmount: 0, fee: 437.5, netAmount: 12062.5 },
      { orderId: 5002, grossAmount: 5950, vatAmount: 1190, fee: 224, netAmount: 5726 },
    ],
  );
}

/** @param {Voucher} v @param {number} idx @param {boolean} isSample */
function renderVoucher(v, idx, isSample) {
  const diff = v.debitMinor - v.creditMinor;
  const netMatches = v.netMinor === v.reportedNetMinor;
  const bookable = diff === 0 && v.debitMinor > 0 && netMatches && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v.date);
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI REVIEW VOUCHER`,
    title: `${v.ref} · ${v.date}`,
    badge: bookable ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }) : reaiBadge({ text: netMatches ? `Diff ${formatMinor(Math.abs(diff))} NOK` : 'Net does not match', tone: 'danger' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Orders', value: String(v.orders) })}
        ${reaiMetric({ label: 'Paid out', value: `${formatMinor(v.reportedNetMinor)} NOK`, detail: v.account ? `To account ${v.account}` : '' })}
        ${reaiMetric({ label: 'Sum of order nets', value: `${formatMinor(v.netMinor)} NOK` })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Posting</th><th>VAT</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${v.lines.map((l) => html`<tr><td class="mono">${l.account}</td><td>${l.description}</td><td>${l.ratePct === null ? 'None' : `Output ${l.ratePct}%`}</td><td class="num">${l.signedMinor > 0 ? formatMinor(l.signedMinor) : ''}</td><td class="num">${l.signedMinor < 0 ? formatMinor(-l.signedMinor) : ''}</td></tr>`)}</tbody>
      </table></div>
      ${bookable && !isSample
        ? html`<form class="stack-sm confirm-box" hx-post="${BASE_PATH}/book" hx-target="#${SLUG}-book-${idx}" hx-swap="innerHTML">
            <input type="hidden" name="voucherJson" value="${JSON.stringify(v)}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I verified these figures against the ${BRAND} settlement report and will attach it in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="${SLUG}-book-${idx}" class="stack-sm"></div>`
        : isSample
          ? reaiCallout({ tone: 'info', body: `Sample ${BRAND} settlement loaded. Connect to ReAI and fetch a real month above to book it.` })
          : reaiCallout({ tone: 'warn', body: 'The order lines do not add up to the amount paid out. Check the settlement report in LetsReg before booking.' })}
    `,
  });
}

/** @param {Voucher[]} vouchers @param {string} organizer @param {boolean} isSample */
function renderAll(vouchers, organizer, isSample) {
  return html`
    ${reaiCallout({ tone: 'info', body: `${vouchers.length} settlement${vouchers.length === 1 ? '' : 's'} for ${organizer}. Registrations are posted including VAT with the matching ReAI VAT code; registrations without VAT use the exempt code. The LetsReg fee is posted without input VAT. The payout stays on clearing account 1580 until it is matched against the bank.` })}
    ${vouchers.map((v, i) => renderVoucher(v, i, isSample))}
  `;
}

/**
 * Picks the ReAI output VAT code for a VAT-inclusive sales rate.
 * @param {VatCode[]} codes @param {number} ratePct
 */
function outputVatCode(codes, ratePct) {
  const usable = codes.filter((c) => !c.reverseCharge && c.amountBasis === 'vat_inclusive' && Math.abs(c.rate - ratePct) < 0.001);
  const match = ratePct > 0
    ? usable.find((c) => c.vatType === 'output_vat')
    : (usable.find((c) => c.vatType === 'exempt') ?? usable.find((c) => c.vatType === 'outside_scope') ?? usable.find((c) => c.vatType === 'output_vat'));
  if (!match) throw new HttpError(400, `ReAI has no output VAT code for ${ratePct}% in this company.`);
  return match.code;
}

/**
 * Handles /app/letsreg/* routes.
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
        ${reaiCard({
          eyebrow: 'LETSREG INTEGRATION API',
          title: 'Fetch LetsReg settlements',
          body: html`
            <p class="muted-note">Use the login of an organiser administrator. LetsReg support must give the user API access to settlements. The password is used only for this request and is never stored.</p>
            <form class="stack" hx-post="${BASE_PATH}/fetch-api" hx-target="#${SLUG}-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="lr-user">Username (email)</label><input id="lr-user" name="username" type="text" autocomplete="off" required></div>
                <div class="field"><label for="lr-pass">Password</label><input id="lr-pass" name="password" type="password" autocomplete="off" required></div>
                <div class="field"><label for="lr-aff">Site id (affid)</label><input id="lr-aff" name="affid" type="text" value="1" required></div>
                <div class="field"><label for="lr-org">Organiser id (optional)</label><input id="lr-org" name="organizerId" type="text" placeholder="Only if the user has several"></div>
                <div class="field"><label for="lr-month">Payout month</label><input id="lr-month" name="month" type="text" pattern="[0-9]{4}-[0-9]{2}" value="${currentMonthIso()}" required placeholder="YYYY-MM"></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Fetch from LetsReg</button>
                <button type="button" class="button secondary" hx-post="${BASE_PATH}/sample" hx-target="#${SLUG}-output" hx-swap="innerHTML">Load sample preview</button>
              </div>
            </form>
          `,
        })}
        <div id="${SLUG}-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderAll([sampleVoucher()], 'Sample organiser', true));
  try {
    const form = await request.formData();
    if (pathname === `${BASE_PATH}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      const result = await fetchApi(creds);
      return htmlResponse(renderAll(result.vouchers, result.organizer, false));
    }
    if (pathname === `${BASE_PATH}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('confirm') !== 'on') throw new HttpError(400, 'Confirm the verification checkbox first.');
      const v = /** @type {Voucher} */ (JSON.parse(String(form.get('voucherJson') ?? '{}')));
      if (!Array.isArray(v.lines) || !v.lines.length || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(v.date))) throw new HttpError(400, 'Voucher is empty.');
      const company = session.tenants.find((t) => t.id === session.tenantId);
      if (company && company.currencyCode !== 'NOK') throw new HttpError(400, 'LetsReg settles in NOK, but the ReAI company uses another currency.');
      const sum = v.lines.reduce((t, l) => t + Math.round(Number(l.signedMinor)), 0);
      if (sum !== 0 || !v.lines.every((l) => /^[0-9]{4}$/.test(String(l.account)))) throw new HttpError(400, 'Voucher must balance to 0.00.');
      const marker = `${BRAND} ${String(v.ref).slice(0, 80)} ${v.date}`;
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const [existing, vatCodes] = await Promise.all([
        /** @type {Promise<Array<{ id: number, number: string, description?: string | null }>>} */ (reaiAll(env, '/api/vouchers', { ...auth, query: { startDate: v.date, endDate: v.date, includeReversed: 'true' } })),
        /** @type {Promise<VatCode[]>} */ (reaiRequest(env, '/api/vat-codes', auth)),
      ]);
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', {
        ...auth,
        method: 'POST',
        body: {
          date: v.date,
          description: marker,
          reviewReason: `${BRAND} settlement imported via apps.reai.no. Check against the ${BRAND} settlement report.`,
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
