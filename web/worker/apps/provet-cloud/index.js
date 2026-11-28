// @ts-check
import { pairVoucherRows } from '../../lib/voucher-rows.js';
import { fetchJson, isoDate, num, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/**
 * One review voucher line. signedMinor is NOK øre: positive debit, negative credit.
 * Sales lines carry the gross amount and a vat_inclusive ReAI output VAT code, so ReAI splits net and VAT.
 * @typedef {{ account: string, vatCode: string, vatRate: number, description: string, signedMinor: number }} ProvetLine
 * @typedef {{ from: string, to: string, invoices: number, lines: ProvetLine[] }} ProvetVoucher
 * @typedef {{ id?: number, status?: unknown, invoice_number?: string | null, invoice_date?: string, total_with_vat?: unknown }} ProvetInvoice
 * @typedef {{ invoice?: string, vat_percentage?: unknown, sum_total?: unknown }} ProvetInvoiceRow
 * @typedef {{ invoice?: string, payment_type?: unknown, paid?: unknown, status?: unknown }} ProvetPayment
 * @typedef {{ token: string, fetchImpl: import('../../lib/api-http.js').FetchLike, left: number }} ProvetReader
 */

/** Provet subrequest budget per fetch (token excluded), well under the Workers cap of 50. */
const MAX_PROVET_PAGES = 45;
/** Invoices per page, and IDs per invoice__in list (the billing guide recommends up to 200). */
const INVOICE_PAGE = 200;

const BRAND = 'Provet Cloud';
const BASE_PATH = '/app/provet-cloud';
const TITLE = 'Provet Cloud Veterinary Sales Accounting';
const LEAD = 'Fetch finalized Provet Cloud invoices for a period and create one balanced review voucher in ReAI: clinic payments by type, open client balances and sales by VAT rate.';

/** Norwegian output VAT: rate → ReAI VAT code and revenue account. 0% rows are treated as outside the VAT act (code 6). */
const VAT_MAP = /** @type {Record<number, { code: string, account: string, label: string }>} */ ({
  25: { code: '3', account: '3000', label: 'Veterinary sales 25% VAT' },
  15: { code: '31', account: '3010', label: 'Sales 15% VAT' },
  12: { code: '33', account: '3020', label: 'Sales 12% VAT' },
  0: { code: '6', account: '3200', label: 'Sales outside the VAT act' },
});

/**
 * Provet payment_type codes (GET /invoicepayment/ description) that settle at the clinic.
 * Other types (bank payment, cheque, consolidated invoice, financing, other, credit invoice, insurance claim) stay in 1570.
 */
const PAYMENT_ACCOUNTS = /** @type {Record<string, { account: string, label: string }>} */ ({
  '0': { account: '1580', label: 'Card payments' },
  '7': { account: '1580', label: 'Mobile payments' },
  '1': { account: '1900', label: 'Cash payments' },
  '3': { account: '7790', label: 'Rounding' },
  '5': { account: '2900', label: 'Vouchers and present cards' },
  '9': { account: '2900', label: 'Vouchers and present cards' },
  '8': { account: '2900', label: 'Prepayments used' },
});

/** @param {unknown} v */
const minor = (v) => Math.round(num(v) * 100);

/** @param {string} isoDay */
function nextDay(isoDay) {
  return new Date(Date.parse(`${isoDay}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10);
}

/**
 * Builds the period voucher from invoices, rows and payments.
 * @param {ProvetInvoice[]} invoices @param {ProvetInvoiceRow[]} rows @param {ProvetPayment[]} payments @param {string} from @param {string} to
 * @returns {ProvetVoucher}
 */
export function buildVoucher(invoices, rows, payments, from, to) {
  /** @type {Map<string, ProvetLine>} */
  const byKey = new Map();
  /** @param {string} account @param {string} vatCode @param {number} vatRate @param {string} description @param {number} signedMinor */
  const add = (account, vatCode, vatRate, description, signedMinor) => {
    if (signedMinor === 0) return;
    const key = `${account}|${vatCode}|${description}`;
    const line = byKey.get(key);
    if (line) line.signedMinor += signedMinor;
    else byKey.set(key, { account, vatCode, vatRate, description, signedMinor });
  };
  const grossMinor = invoices.reduce((s, i) => s + minor(i.total_with_vat), 0);
  let settledMinor = 0;
  for (const p of payments) {
    // Status 1 pending and 4 failed brought in no money. Cancelled payments (2) stay in, because Provet
    // reverses them with a separate negative payment record, so the pair nets to zero.
    const status = Number(p.status);
    if (status === 1 || status === 4) continue;
    const target = PAYMENT_ACCOUNTS[String(p.payment_type ?? '')];
    if (!target) continue;
    const amount = minor(p.paid);
    settledMinor += amount;
    add(target.account, '0', 0, `${BRAND} ${target.label}`, amount);
  }
  add('1570', '0', 0, `${BRAND} open and externally settled client invoices`, grossMinor - settledMinor);
  for (const r of rows) {
    const rate = Math.round(num(r.vat_percentage));
    const vat = VAT_MAP[rate];
    if (!vat) throw new HttpError(400, `Provet invoice row has a ${rate}% VAT rate. Only Norwegian rates 25, 15, 12 and 0% are supported.`);
    add(vat.account, vat.code, rate, `${BRAND} ${vat.label}`, -minor(r.sum_total));
  }
  return { from, to, invoices: invoices.length, lines: [...byKey.values()].filter((l) => l.signedMinor !== 0) };
}

/**
 * Reads one Provet list page, counting it against the shared page budget.
 * @param {string} url @param {ProvetReader} reader @param {string} host
 * @returns {Promise<{ results: any[], next: string | null }>}
 */
async function readPage(url, reader, host) {
  if (new URL(url).host !== host) throw new HttpError(502, `${BRAND} pagination left the Provet host.`);
  if (reader.left <= 0) throw new HttpError(400, `${BRAND} has more invoices in this period than one request can read. Choose a shorter period.`);
  reader.left -= 1;
  const res = await reader.fetchImpl(url, { headers: { authorization: `Bearer ${reader.token}`, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  if (res.status === 429) throw new HttpError(429, `${BRAND} rate limit reached. Wait ${res.headers.get('retry-after') ?? '60'} seconds and try again.`);
  if (!res.ok) throw new HttpError(400, `${BRAND} API ${res.status === 401 || res.status === 403 ? 'rejected the token. Check that the integration user has the Financial: Invoices permission' : `returned HTTP ${res.status}`}.`);
  const data = await res.json();
  return { results: Array.isArray(data?.results) ? data.results : [], next: typeof data?.next === 'string' && data.next ? data.next : null };
}

/**
 * Reads every page of a Provet list endpoint by following `next` until it is null (same host only).
 * @param {string} firstUrl @param {ProvetReader} reader
 * @returns {Promise<any[]>}
 */
async function readAll(firstUrl, reader) {
  const host = new URL(firstUrl).host;
  /** @type {any[]} */ const all = [];
  /** @type {string | null} */ let url = firstUrl;
  while (url) {
    const page = await readPage(url, reader, host);
    all.push(...page.results);
    url = page.next;
  }
  return all;
}

/**
 * Fetches finalized invoices, their rows and payments from the Provet Cloud REST API.
 * Docs: https://developers.provetcloud.com/restapi/authentication_oauth2.html (client credentials,
 * POST /<provet_id>/oauth2/token/ with HTTP Basic client auth, scope restapi),
 * https://developers.provetcloud.com/restapi/howto_billing.html (GET /invoice/ with invoice_date filters, statuses),
 * https://developers.provetcloud.com/restapi/howto_erp_accounting.html (GET /invoicerow/, VAT per row),
 * https://developers.provetcloud.com/restapi/pagination.html (count/next/results) and the OpenAPI
 * reference https://developers.provetcloud.com/restapi/0.1/ (invoice__in, payment_type codes).
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<ProvetVoucher>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const clientId = (creds.clientId ?? '').trim();
  const clientSecret = (creds.clientSecret ?? '').trim();
  const to = isoDate(creds.toDate ?? creds.date);
  const from = isoDate(creds.fromDate, to);
  if (!clientId || !clientSecret) throw new HttpError(400, 'Enter the Provet Cloud client ID and client secret.');
  if (from > to) throw new HttpError(400, 'From date must be on or before the to date.');
  let instance;
  try {
    instance = new URL((creds.provetUrl ?? '').trim());
  } catch {
    throw new HttpError(400, 'Enter your Provet Cloud address, for example https://provetcloud.com/1234/.');
  }
  const provetId = instance.pathname.split('/').filter(Boolean)[0] ?? '';
  if (instance.protocol !== 'https:' || !/(^|\.)provetcloud\.com$/i.test(instance.hostname) || !/^[0-9]+$/.test(provetId)) {
    throw new HttpError(400, 'The Provet Cloud address must look like https://provetcloud.com/<provet id>/.');
  }
  const root = `https://${instance.host}/${provetId}`;
  const tokenRes = await fetchJson(`${root}/oauth2/token/`, {
    method: 'POST',
    headers: { authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'restapi' }).toString(),
  }, BRAND, fetchImpl);
  const token = typeof tokenRes?.access_token === 'string' ? tokenRes.access_token : '';
  if (!token) throw new HttpError(400, `${BRAND} did not return an access token.`);
  const api = `${root}/api/0.1`;
  const host = new URL(api).host;
  /** @type {ProvetReader} */ const reader = { token, fetchImpl, left: MAX_PROVET_PAGES };
  /** @type {ProvetInvoice[]} */ const invoices = [];
  /** @type {ProvetInvoiceRow[]} */ const rows = [];
  /** @type {ProvetPayment[]} */ const payments = [];
  // One invoice page at a time, then the rows and payments of that page's invoices in two parallel
  // invoice__in lists, as the billing guide's ERP sync pattern recommends.
  /** @type {string | null} */ let url = `${api}/invoice/?invoice_date__gte=${from}&invoice_date__lt=${nextDay(to)}&page_size=${INVOICE_PAGE}`;
  while (url) {
    const page = await readPage(url, reader, host);
    url = page.next;
    const issued = /** @type {ProvetInvoice[]} */ (page.results).filter((i) => { const s = Number(i.status); return s !== 0 && s !== 99 && !!i.invoice_number && typeof i.id === 'number'; });
    if (issued.length === 0) continue;
    invoices.push(...issued);
    const ids = issued.map((x) => x.id).join(',');
    const [r, p] = await Promise.all([
      readAll(`${api}/invoicerow/?invoice__in=${ids}&page_size=1000`, reader),
      readAll(`${api}/invoicepayment/?invoice__in=${ids}&page_size=1000`, reader),
    ]);
    rows.push(...r);
    payments.push(...p);
  }
  if (invoices.length === 0) throw new HttpError(400, `${BRAND} returned no finalized invoices from ${from} to ${to}.`);
  return buildVoucher(invoices, rows, payments, from, to);
}

/** @returns {ProvetVoucher} */
function sampleVoucher() {
  return buildVoucher(
    [
      { id: 1, status: 3, invoice_number: '10021', invoice_date: '2026-10-24T10:15:00+02:00', total_with_vat: 2487.5 },
      { id: 2, status: 3, invoice_number: '10022', invoice_date: '2026-10-24T13:40:00+02:00', total_with_vat: 6250 },
      { id: 3, status: 4, invoice_number: '10023', invoice_date: '2026-10-24T15:05:00+02:00', total_with_vat: 3750 },
    ],
    [
      { invoice: '1', vat_percentage: 25, sum_total: 2487.5 },
      { invoice: '2', vat_percentage: 25, sum_total: 6250 },
      { invoice: '3', vat_percentage: 25, sum_total: 3750 },
    ],
    [
      { invoice: '1', payment_type: '0', paid: 2487.5 },
      { invoice: '2', payment_type: '7', paid: 5000 },
      { invoice: '2', payment_type: '1', paid: 1250 },
    ],
    '2026-10-24',
    '2026-10-24',
  );
}

/** @param {ProvetLine} l */
function vatPartMinor(l) {
  if (l.vatRate <= 0 || l.vatCode === '0') return 0;
  return l.signedMinor - Math.round((l.signedMinor * 100) / (100 + l.vatRate));
}

/** @param {ProvetVoucher} v @param {boolean} isSample */
function renderPreview(v, isSample) {
  const debit = v.lines.filter((l) => l.signedMinor > 0).reduce((s, l) => s + l.signedMinor, 0);
  const credit = v.lines.filter((l) => l.signedMinor < 0).reduce((s, l) => s - l.signedMinor, 0);
  const diff = debit - credit;
  const balanced = diff === 0 && debit > 0;
  const outputVat = -v.lines.reduce((s, l) => s + vatPartMinor(l), 0);
  const period = v.from === v.to ? v.to : `${v.from} to ${v.to}`;
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI REVIEW VOUCHER`,
    title: `${period} · ${v.invoices} invoice${v.invoices === 1 ? '' : 's'}`,
    badge: balanced ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }) : reaiBadge({ text: `Diff ${formatMinor(Math.abs(diff))} NOK`, tone: 'danger' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Invoices incl. VAT (debit)', value: `${formatMinor(debit)} NOK` })}
        ${reaiMetric({ label: 'Sales incl. VAT (credit)', value: `${formatMinor(credit)} NOK` })}
        ${reaiMetric({ label: 'Estimated output VAT', value: `${formatMinor(outputVat)} NOK`, detail: 'ReAI calculates VAT from the VAT code' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>VAT code</th><th>Posting</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${v.lines.map((l) => html`<tr><td class="mono">${l.account}</td><td class="mono">${l.vatCode}</td><td>${l.description}</td><td class="num">${l.signedMinor > 0 ? formatMinor(l.signedMinor) : ''}</td><td class="num">${l.signedMinor < 0 ? formatMinor(-l.signedMinor) : ''}</td></tr>`)}</tbody>
      </table></div>
      ${balanced && !isSample
        ? html`<form class="stack-sm confirm-box" hx-post="${BASE_PATH}/book" hx-target="#provet-book" hx-swap="innerHTML">
            <input type="hidden" name="voucherJson" value="${JSON.stringify(v)}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I checked these totals against the Provet Cloud sales report and will attach it in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="provet-book" class="stack-sm"></div>`
        : isSample
          ? reaiCallout({ tone: 'info', body: `Synthetic ${BRAND} invoices loaded. Connect to ReAI and fetch a real period to book.` })
          : reaiCallout({ tone: 'warn', body: 'Invoice rows do not add up to the invoice totals. Check the period in Provet Cloud before booking.' })}
    `,
  });
}

/**
 * Verifies the VAT codes used exist in ReAI with the expected rate and gross (vat_inclusive) basis.
 * @param {import('../../lib/types.d.ts').Env} env @param {{ accessToken: string, tenantId: number }} session @param {ProvetLine[]} lines
 */
async function assertVatCodes(env, session, lines) {
  const codes = /** @type {Array<{ code: string, rate: number, amountBasis: string, reverseCharge: boolean }>} */ (
    await reaiRequest(env, '/api/vat-codes', { token: session.accessToken, tenantId: session.tenantId })
  );
  for (const l of lines) {
    if (l.vatCode === '0') continue;
    const c = codes.find((x) => x.code === l.vatCode);
    if (!c || Math.round(c.rate) !== l.vatRate || c.reverseCharge || (l.vatRate > 0 && c.amountBasis !== 'vat_inclusive')) {
      throw new HttpError(400, `ReAI VAT code ${l.vatCode} (${l.vatRate}%) is not available as a gross output VAT code for this company.`);
    }
  }
}

/**
 * Handles /app/provet-cloud/* routes.
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
      <section class="app-intro"><p class="eyebrow">VETERINARY CLINICS</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-provet-cloud-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({
          basePath: BASE_PATH,
          targetId: 'provet-output',
          brand: BRAND,
          hint: 'Request REST API access from Provet for a client credentials integration whose virtual user has the Financial: Invoices permission, then paste your Provet Cloud address, client ID and client secret.',
          fields: [
            { name: 'provetUrl', label: 'Provet Cloud address', type: 'url', placeholder: 'https://provetcloud.com/1234/' },
            { name: 'clientId', label: 'Client ID' },
            { name: 'clientSecret', label: 'Client secret', type: 'password' },
            { name: 'fromDate', label: 'From invoice date', type: 'date', defaultValue: '$TODAY' },
            { name: 'toDate', label: 'To invoice date', type: 'date', defaultValue: '$TODAY' },
          ],
          sampleAction: true,
        })}
        <div id="provet-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderPreview(sampleVoucher(), true));
  try {
    const form = await request.formData();
    if (pathname === `${BASE_PATH}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderPreview(await fetchApi(creds), false));
    }
    if (pathname === `${BASE_PATH}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('confirm') !== 'on') throw new HttpError(400, 'Confirm that you checked the sales report first.');
      const v = /** @type {ProvetVoucher} */ (JSON.parse(String(form.get('voucherJson') ?? '{}')));
      const dateRe = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
      if (!dateRe.test(v.from ?? '') || !dateRe.test(v.to ?? '') || !Array.isArray(v.lines) || v.lines.length === 0) throw new HttpError(400, 'Invalid voucher.');
      if (!v.lines.every((l) => /^[0-9]{4}$/.test(l.account) && /^[0-9]{1,2}$/.test(l.vatCode) && Number.isInteger(l.signedMinor))) throw new HttpError(400, 'Invalid voucher line.');
      if (v.lines.reduce((s, l) => s + l.signedMinor, 0) !== 0) throw new HttpError(400, 'Voucher must balance to 0.00.');
      await assertVatCodes(env, session, v.lines);
      const marker = `${BRAND} invoices ${v.from} to ${v.to}`;
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (await reaiAll(env, '/api/vouchers', { token: session.accessToken, tenantId: session.tenantId, query: { startDate: v.to, endDate: v.to, includeReversed: 'true' } }));
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      const created = /** @type {{ id: number, number: string, webUrl?: string }} */ (await reaiRequest(env, '/api/manual-vouchers', {
        token: session.accessToken,
        tenantId: session.tenantId,
        method: 'POST',
        body: {
          date: v.to,
          description: `${marker} (${v.invoices} invoices)`,
          reviewReason: `${BRAND} invoices imported via apps.reai.no. Check against the Provet Cloud sales report.`,
          postings: pairVoucherRows(v.lines.map((l) => ({ accountNumber: l.account, postingDate: v.to, currencyCode: 'NOK', amount: Number((l.signedMinor / 100).toFixed(2)), vatCode: l.vatCode, description: l.description }))),
        },
      }));
      const href = created.webUrl ?? `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${href}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
