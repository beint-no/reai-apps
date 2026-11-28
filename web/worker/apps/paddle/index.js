// @ts-check
import { assertPublicHttpsUrl } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { parseCsv } from '../../lib/csv.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { assertTwoDecimalCurrency, formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';
import { pairVoucherRows } from '../../lib/voucher-rows.js';

/**
 * @typedef {{ remittance: string, currency: string, payoutCreated: string, rows: number, sales: number, refunds: number,
 *   grossMinor: number, taxMinor: number, revenueMinor: number, paddleFeeMinor: number, otherFeeMinor: number,
 *   rebateMinor: number, payoutMinor: number }} PaddlePayout
 * @typedef {{ payout: PaddlePayout, date: string, bankMinor: number, accounts: { bank: string, revenue: string, fee: string } }} PaddleVoucher
 * @typedef {(input: string | URL, init?: RequestInit) => Promise<Response>} FetchLike
 * @typedef {{ status: 'pending', reportId: string } | { status: 'ready', reportId: string, payout: PaddlePayout }} FetchResult
 */

const SLUG = 'paddle';
const BASE_PATH = `/app/${SLUG}`;
const BRAND = 'Paddle';
const TITLE = 'Paddle Payout Accounting';
const LEAD = 'Fetch the Paddle payout reconciliation report for one payout and book it in ReAI as a review voucher with sales ex. tax, Paddle fees and the amount paid to your bank.';
/** Paddle API version 1 is the current version (https://developer.paddle.com/api-reference/about/versioning). */
const PADDLE_VERSION = '1';
const POLL_ATTEMPTS = 4;
const POLL_DELAY_MS = 2000;

/** @type {PaddlePayout} */
const SAMPLE_PAYOUT = {
  remittance: 'PAY-2026-10-000123',
  currency: 'NOK',
  payoutCreated: '2026-11-01',
  rows: 214,
  sales: 210,
  refunds: 4,
  grossMinor: 23062500,
  taxMinor: 3412500,
  revenueMinor: 19650000,
  paddleFeeMinor: 1018000,
  otherFeeMinor: 25000,
  rebateMinor: 0,
  payoutMinor: 18607000,
};

/** Columns read from the payout reconciliation report (https://developer.paddle.com/build/reports/payout-reconciliation). */
const COLS = /** @type {const} */ ([
  'remittance_reference', 'balance_movement_type', 'direction', 'balance_currency_code', 'payout_created_at',
  'total_gross_in_balance_currency', 'tax_in_balance_currency', 'paddle_fee_in_balance_currency',
  'retained_fee_in_balance_currency', 'fx_fee_in_balance_currency', 'fx_fee_precision_adjustment_in_balance_currency',
  'chargeback_fee_in_balance_currency', 'payout_rebates_and_fees_in_balance_currency', 'balance_movement_in_balance_currency',
]);
const AMOUNT_COLS = COLS.slice(5);

/** @param {string} key */
function apiBase(key) {
  return key.startsWith('pdl_sdbx_') ? 'https://sandbox-api.paddle.com' : 'https://api.paddle.com';
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One Paddle API call with the documented error handling (429 + Retry-After, error.detail).
 * @param {string} url
 * @param {string} key
 * @param {RequestInit} init
 * @param {FetchLike} fetchImpl
 * @returns {Promise<any>}
 */
async function paddleJson(url, key, init, fetchImpl) {
  const res = await fetchImpl(url, {
    ...init,
    headers: { authorization: `Bearer ${key}`, accept: 'application/json', 'content-type': 'application/json', 'paddle-version': PADDLE_VERSION },
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  /** @type {any} */ let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (res.ok) return data;
  if (res.status === 429) throw new HttpError(429, `Paddle rate limit reached. Wait ${res.headers.get('retry-after') ?? '60'} seconds and try again.`);
  if (res.status === 401) throw new HttpError(400, 'Paddle rejected the API key. Check that you copied a live API key.');
  if (res.status === 403) throw new HttpError(400, 'The Paddle API key lacks permission. Give the key read and write access to reports.');
  const detail = typeof data?.error?.detail === 'string' ? ` ${data.error.detail.slice(0, 200)}` : '';
  throw new HttpError(400, `Paddle API returned HTTP ${res.status}.${detail}`);
}

/**
 * Reads a report amount. Paddle states API money is a string in the lowest denomination, but the report
 * page does not state the unit for these columns, so decimals are detected and checked against the payout.
 * @param {string | undefined} raw
 */
function amountOf(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s.toLowerCase() === 'null') return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new HttpError(400, `Paddle report has an invalid amount '${s.slice(0, 30)}'.`);
  return n;
}

/**
 * Sums a payout reconciliation report into one payout. All rows must belong to one remittance and balance
 * currency. Each row must satisfy Paddle's documented formula: gross - tax - fees + rebates = balance movement.
 * @param {string} csvText
 * @param {number} expectedPayoutMinor Payout amount from the remittance advice, in minor units.
 * @returns {PaddlePayout}
 */
export function summarizeReport(csvText, expectedPayoutMinor) {
  const doc = parseCsv(csvText);
  const idx = Object.fromEntries(COLS.map((c) => [c, doc.headers.indexOf(c)]));
  const missing = COLS.filter((c) => (idx[c] ?? -1) < 0);
  if (missing.length) throw new HttpError(400, `The Paddle report is missing the columns ${missing.join(', ')}.`);
  /** @param {string[]} r @param {string} c */
  const cell = (r, c) => String(r[idx[c] ?? -1] ?? '').trim();
  const decimals = doc.rows.some((r) => AMOUNT_COLS.some((c) => cell(r, c).includes('.')));
  const remittances = new Set(doc.rows.map((r) => cell(r, 'remittance_reference')));
  const currencies = new Set(doc.rows.map((r) => cell(r, 'balance_currency_code').toUpperCase()));
  if (remittances.size !== 1 || currencies.size !== 1) throw new HttpError(400, 'The Paddle report covers more than one payout or balance currency.');
  const currency = [...currencies][0] ?? '';
  assertTwoDecimalCurrency(currency);
  /** @type {Record<string, number>} */
  const raw = Object.fromEntries(AMOUNT_COLS.map((c) => [c, 0]));
  let sales = 0;
  let refunds = 0;
  for (const [n, r] of doc.rows.entries()) {
    const v = Object.fromEntries(AMOUNT_COLS.map((c) => [c, amountOf(cell(r, c))]));
    const fees = (v.paddle_fee_in_balance_currency ?? 0) + (v.retained_fee_in_balance_currency ?? 0) + (v.fx_fee_in_balance_currency ?? 0)
      + (v.fx_fee_precision_adjustment_in_balance_currency ?? 0) + (v.chargeback_fee_in_balance_currency ?? 0);
    const formula = (v.total_gross_in_balance_currency ?? 0) - (v.tax_in_balance_currency ?? 0) - fees + (v.payout_rebates_and_fees_in_balance_currency ?? 0);
    const movement = v.balance_movement_in_balance_currency ?? 0;
    if (Math.abs(formula - movement) > (decimals ? 0.011 : 1.1)) throw new HttpError(400, `Paddle report row ${n + 2} does not add up to its balance movement. Generate the report again in Paddle.`);
    // A row that deducts from the balance (direction out) with a positive movement is unsigned: negate it.
    const sign = cell(r, 'direction') === 'out' && movement > 0 ? -1 : 1;
    for (const c of AMOUNT_COLS) raw[c] = (raw[c] ?? 0) + sign * (v[c] ?? 0);
    const type = cell(r, 'balance_movement_type');
    if (type === 'sale') sales += 1;
    else if (type === 'refund' || type === 'chargeback') refunds += 1;
  }
  /** Converts a summed column to minor units. Without decimals in the file the unit is chosen by the payout check. */
  const sumMovement = raw.balance_movement_in_balance_currency ?? 0;
  let factor = 100;
  if (!decimals) {
    if (Math.round(sumMovement) === expectedPayoutMinor) factor = 1;
    else if (Math.round(sumMovement * 100) === expectedPayoutMinor) factor = 100;
    else throw new HttpError(400, `The Paddle report sums to ${sumMovement} ${currency}, which does not match the payout amount you entered. Check the remittance advice or generate the report again.`);
  }
  /** @param {string} c */
  const minor = (c) => Math.round((raw[c] ?? 0) * factor);
  const payoutMinor = minor('balance_movement_in_balance_currency');
  if (payoutMinor !== expectedPayoutMinor) {
    throw new HttpError(400, `The Paddle report sums to ${formatMinor(payoutMinor)} ${currency}, but you entered ${formatMinor(expectedPayoutMinor)} ${currency}. Check the remittance advice or generate the report again.`);
  }
  const grossMinor = minor('total_gross_in_balance_currency');
  const taxMinor = minor('tax_in_balance_currency');
  const paddleFeeMinor = minor('paddle_fee_in_balance_currency');
  const rebateMinor = minor('payout_rebates_and_fees_in_balance_currency');
  const revenueMinor = grossMinor - taxMinor;
  // Remaining fee lines (retained, FX, chargeback) are derived so the payout always balances to the cent.
  const otherFeeMinor = revenueMinor - paddleFeeMinor + rebateMinor - payoutMinor;
  const firstRow = doc.rows[0] ?? [];
  return {
    remittance: [...remittances][0] ?? '',
    currency,
    payoutCreated: cell(firstRow, 'payout_created_at').slice(0, 10),
    rows: doc.rows.length,
    sales,
    refunds,
    grossMinor,
    taxMinor,
    revenueMinor,
    paddleFeeMinor,
    otherFeeMinor,
    rebateMinor,
    payoutMinor,
  };
}

/**
 * Creates (or re-checks) a Paddle payout reconciliation report for one remittance reference and, when it is
 * ready, downloads and summarizes the CSV.
 * Docs: POST /reports, GET /reports/{report_id}, GET /reports/{report_id}/download-url
 * (https://developer.paddle.com/api-reference/reports/overview).
 * Subrequests: create 1 + up to POLL_ATTEMPTS status checks + download-url 1 + CSV 1.
 * @param {Record<string, string>} creds
 * @param {FetchLike} [fetchImpl]
 * @param {{ attempts?: number, delayMs?: number }} [poll]
 * @returns {Promise<FetchResult>}
 */
export async function fetchApi(creds, fetchImpl = fetch, poll = {}) {
  const key = (creds.apiKey ?? '').trim();
  const remittance = (creds.remittance ?? '').trim();
  const expectedPayoutMinor = Math.round(Number(String(creds.payoutAmount ?? '').replace(',', '.')) * 100);
  if (!/^pdl_(live|sdbx)_apikey_/.test(key)) throw new HttpError(400, 'Enter a Paddle API key. It starts with pdl_live_apikey_.');
  if (!remittance || remittance.length > 100) throw new HttpError(400, 'Enter the remittance reference from the Payouts page in Paddle.');
  if (!Number.isFinite(expectedPayoutMinor) || expectedPayoutMinor <= 0) throw new HttpError(400, 'Enter the payout amount from the Paddle remittance advice.');
  const base = apiBase(key);
  let reportId = (creds.reportId ?? '').trim();
  if (reportId && !/^rep_[a-z0-9]{26}$/.test(reportId)) reportId = '';
  if (!reportId) {
    const created = await paddleJson(`${base}/reports`, key, {
      method: 'POST',
      body: JSON.stringify({ type: 'payout_reconciliation', filters: [{ name: 'remittance_reference', operator: null, value: [remittance] }] }),
    }, fetchImpl);
    reportId = String(created?.data?.id ?? '');
    if (!reportId) throw new HttpError(502, 'Paddle did not return a report ID.');
    if (created?.data?.status === 'ready') return downloadReady(base, key, reportId, expectedPayoutMinor, fetchImpl);
  }
  const attempts = poll.attempts ?? POLL_ATTEMPTS;
  for (let i = 0; i < attempts; i++) {
    if (i > 0 || !creds.reportId) await sleep(poll.delayMs ?? POLL_DELAY_MS);
    const report = await paddleJson(`${base}/reports/${reportId}`, key, { method: 'GET' }, fetchImpl);
    const status = String(report?.data?.status ?? '');
    if (status === 'ready') return downloadReady(base, key, reportId, expectedPayoutMinor, fetchImpl);
    if (status === 'failed' || status === 'expired') throw new HttpError(400, `The Paddle report ${status === 'failed' ? 'failed' : 'expired'}. Fetch it again to create a new report.`);
  }
  return { status: 'pending', reportId };
}

/**
 * @param {string} base @param {string} key @param {string} reportId @param {number} expectedPayoutMinor @param {FetchLike} fetchImpl
 * @returns {Promise<FetchResult>}
 */
async function downloadReady(base, key, reportId, expectedPayoutMinor, fetchImpl) {
  const link = await paddleJson(`${base}/reports/${reportId}/download-url`, key, { method: 'GET' }, fetchImpl);
  const url = assertPublicHttpsUrl(String(link?.data?.url ?? ''));
  // The download link is pre-signed and expires after three minutes; it gets no Paddle credentials.
  const res = await fetchImpl(url.toString(), { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new HttpError(502, `Downloading the Paddle report returned HTTP ${res.status}. Fetch it again.`);
  const text = await res.text();
  if (text.length > 10_000_000) throw new HttpError(400, 'The Paddle report is larger than 10 MB.');
  return { status: 'ready', reportId, payout: summarizeReport(text, expectedPayoutMinor) };
}

/** @param {PaddleVoucher} v */
function voucherLines(v) {
  const p = v.payout;
  const rate = v.bankMinor / p.payoutMinor;
  /** @param {number} m */
  const conv = (m) => Math.round(m * rate);
  const revenue = conv(p.revenueMinor);
  const bank = v.bankMinor;
  return [
    { account: v.accounts.bank, description: `Paddle payout ${p.remittance}`, signedMinor: bank, kind: 'bank' },
    { account: v.accounts.fee, description: 'Paddle fees, net of rebates', signedMinor: revenue - bank, kind: 'fee' },
    { account: v.accounts.revenue, description: `Paddle sales ex. tax (${p.sales} sales, ${p.refunds} refunds)`, signedMinor: -revenue, kind: 'revenue' },
  ].filter((l) => l.signedMinor !== 0);
}

/** @param {{ v: PaddleVoucher, companyCurrency: string, isSample?: boolean }} state */
function renderPreview(state) {
  const { v, companyCurrency, isSample } = state;
  const p = v.payout;
  const lines = voucherLines(v);
  const foreign = p.currency !== companyCurrency;
  return reaiCard({
    eyebrow: 'PADDLE PAYOUT VOUCHER',
    title: `${p.remittance} · ${v.date}`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Report matches the payout', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Payout', value: `${formatMinor(p.payoutMinor)} ${p.currency}`, detail: `${p.rows} balance movements` })}
        ${reaiMetric({ label: 'Sales ex. tax', value: `${formatMinor(p.revenueMinor)} ${p.currency}`, detail: `Gross ${formatMinor(p.grossMinor)}, tax collected by Paddle ${formatMinor(p.taxMinor)}` })}
        ${reaiMetric({ label: 'Fees', value: `${formatMinor(p.paddleFeeMinor + p.otherFeeMinor - p.rebateMinor)} ${p.currency}`, detail: `Paddle ${formatMinor(p.paddleFeeMinor)}, other ${formatMinor(p.otherFeeMinor)}, rebates ${formatMinor(p.rebateMinor)}` })}
      </div>
      ${foreign ? html`<p class="muted-note">Converted to ${companyCurrency} at the rate of the bank deposit: ${formatMinor(v.bankMinor)} ${companyCurrency} for ${formatMinor(p.payoutMinor)} ${p.currency}.</p>` : ''}
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Posting</th><th>VAT</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${lines.map((l) => html`<tr>
          <td class="mono">${l.account}</td><td>${l.description}</td><td>${l.kind === 'revenue' ? 'Export, zero rated' : 'None'}</td>
          <td class="num">${l.signedMinor > 0 ? formatMinor(l.signedMinor) : ''}</td><td class="num">${l.signedMinor < 0 ? formatMinor(-l.signedMinor) : ''}</td>
        </tr>`)}</tbody>
      </table></div>
      ${isSample
        ? reaiCallout({ tone: 'info', body: 'Sample payout loaded. Connect to ReAI and fetch a real payout to book it.' })
        : html`<form class="stack-sm confirm-box" hx-post="${BASE_PATH}/book" hx-target="#${SLUG}-book" hx-swap="innerHTML">
            <input type="hidden" name="voucherJson" value="${JSON.stringify(v)}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I checked these totals against the Paddle remittance advice and will attach it in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="${SLUG}-book" class="stack-sm"></div>`}
    `,
  });
}

/** @param {string} reportId */
function renderPending(reportId) {
  return reaiCallout({
    tone: 'info',
    title: 'Paddle is still preparing the report',
    body: html`Reports usually take a few minutes.
      <form class="inline-row" hx-post="${BASE_PATH}/fetch-api" hx-include="#${SLUG}-form" hx-target="#${SLUG}-output" hx-swap="innerHTML">
        <input type="hidden" name="reportId" value="${reportId}">
        <button type="submit" class="button secondary">Check again</button>
      </form>`,
  });
}

/** @param {FormData} form */
function accountsOf(form) {
  /** @param {string} k @param {string} d */
  const acct = (k, d) => {
    const s = String(form.get(k) ?? '').trim() || d;
    if (!/^[0-9]{4,6}$/.test(s)) throw new HttpError(400, 'Accounts must be ReAI account numbers.');
    return s;
  };
  return { bank: acct('bankAccount', '1920'), revenue: acct('revenueAccount', '3100'), fee: acct('feeAccount', '7770') };
}

/**
 * Handles /app/paddle/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE_PATH && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE_PATH}/`, request.url), 301);
  if (pathname === `${BASE_PATH}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro"><p class="eyebrow">SAAS BILLING & MERCHANT OF RECORD</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${SLUG}-web`, clientName: `ReAI ${BRAND} (Web)` })}
        ${reaiCard({
          eyebrow: 'LIVE PADDLE REPORTS API',
          title: 'Fetch one Paddle payout',
          body: html`
            <p class="muted-note">Create an API key in Paddle under Developer tools, Authentication, with read and write access to reports. Find the remittance reference and amount on the Payouts page or the remittance advice. The key is used only for this request and is never stored.</p>
            <form id="${SLUG}-form" class="stack" hx-post="${BASE_PATH}/fetch-api" hx-target="#${SLUG}-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="pd-key">Paddle API key</label><input id="pd-key" name="apiKey" type="password" autocomplete="off" required placeholder="pdl_live_apikey_..."></div>
                <div class="field"><label for="pd-ref">Remittance reference</label><input id="pd-ref" name="remittance" type="text" required></div>
                <div class="field"><label for="pd-amt">Payout amount (remittance advice)</label><input id="pd-amt" name="payoutAmount" type="number" step="0.01" min="0.01" required></div>
                <div class="field"><label for="pd-date">Date on the bank statement</label><input id="pd-date" name="date" type="date" value="${today}" required></div>
                <div class="field"><label for="pd-bank">Amount received in the bank, in company currency</label><input id="pd-bank" name="bankAmount" type="number" step="0.01" min="0.01" placeholder="Only when the payout currency differs"></div>
                <div class="field"><label for="pd-a1">Bank account</label><input id="pd-a1" name="bankAccount" type="text" inputmode="numeric" value="1920"></div>
                <div class="field"><label for="pd-a2">Sales account</label><input id="pd-a2" name="revenueAccount" type="text" inputmode="numeric" value="3100"></div>
                <div class="field"><label for="pd-a3">Fee account</label><input id="pd-a3" name="feeAccount" type="text" inputmode="numeric" value="7770"></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Fetch from Paddle API</button>
                <button type="button" class="button secondary" hx-post="${BASE_PATH}/sample" hx-target="#${SLUG}-output" hx-swap="innerHTML">Load sample preview</button>
              </div>
            </form>`,
        })}
        <div id="${SLUG}-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE_PATH}/sample`) {
    return htmlResponse(renderPreview({ v: { payout: SAMPLE_PAYOUT, date: '2026-11-14', bankMinor: SAMPLE_PAYOUT.payoutMinor, accounts: { bank: '1920', revenue: '3100', fee: '7770' } }, companyCurrency: 'NOK', isSample: true }));
  }
  try {
    const form = await request.formData();
    if (pathname === `${BASE_PATH}/fetch-api`) {
      const session = await readSession(env, request);
      const companyCurrency = session?.tenants.find((t) => t.id === session.tenantId)?.currencyCode ?? 'NOK';
      const date = String(form.get('date') ?? '').trim();
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) throw new HttpError(400, 'Enter the date on the bank statement.');
      const accounts = accountsOf(form);
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, val] of form.entries()) if (typeof val === 'string') creds[k] = val;
      const result = await fetchApi(creds);
      if (result.status === 'pending') return htmlResponse(renderPending(result.reportId));
      const p = result.payout;
      let bankMinor = p.payoutMinor;
      if (p.currency !== companyCurrency) {
        bankMinor = Math.round(Number(String(form.get('bankAmount') ?? '').replace(',', '.')) * 100);
        if (!Number.isFinite(bankMinor) || bankMinor <= 0) throw new HttpError(400, `The payout is in ${p.currency}. Enter the amount received in the bank in ${companyCurrency}.`);
      }
      return htmlResponse(renderPreview({ v: { payout: p, date, bankMinor, accounts }, companyCurrency }));
    }
    if (pathname === `${BASE_PATH}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('confirm') !== 'on') throw new HttpError(400, 'Confirm the verification checkbox first.');
      const company = session.tenants.find((t) => t.id === session.tenantId);
      if (!company) throw new HttpError(400, 'Select a valid ReAI company.');
      const v = /** @type {PaddleVoucher} */ (JSON.parse(String(form.get('voucherJson') ?? '{}')));
      if (!v?.payout?.remittance || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(v.date)) || !(v.bankMinor > 0) || !(v.payout.payoutMinor > 0)) throw new HttpError(400, 'The voucher is incomplete. Fetch the payout again.');
      if (v.payout.currency === company.currencyCode && v.bankMinor !== v.payout.payoutMinor) throw new HttpError(400, 'The bank amount must equal the payout. Fetch the payout again.');
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const marker = `${BRAND} payout ${String(v.payout.remittance).slice(0, 100)}`;
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (await reaiAll(env, '/api/vouchers', { ...auth, query: { startDate: v.date, endDate: v.date, includeReversed: 'true' } }));
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      const codes = /** @type {Array<{ code: string, rate: number, vatType: string }>} */ (await reaiRequest(env, '/api/vat-codes', auth));
      const exportCode = codes.find((c) => c.code === '52' && c.rate === 0 && (c.vatType === 'exempt' || c.vatType === 'outside_scope'));
      if (!exportCode) throw new HttpError(400, 'ReAI has no VAT code 52 (export, zero rated) in this company.');
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', {
        ...auth,
        method: 'POST',
        body: {
          date: v.date,
          description: `${marker} ${v.payout.currency} ${formatMinor(v.payout.payoutMinor)}`.slice(0, 255),
          reviewReason: 'Paddle payout imported via apps.reai.no. Paddle is the merchant of record and collects the sales tax. Attach the remittance advice and check the VAT treatment.',
          postings: pairVoucherRows(voucherLines(v).map((l) => ({
            accountNumber: l.account,
            postingDate: v.date,
            currencyCode: company.currencyCode,
            amount: l.signedMinor / 100,
            vatCode: l.kind === 'revenue' ? exportCode.code : '0',
            description: l.description,
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
