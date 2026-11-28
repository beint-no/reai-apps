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
 * Sales lines carry the gross amount and a ReAI output VAT code (6 for VAT exempt health services).
 * @typedef {{ account: string, vatCode: string, vatRate: number, description: string, signedMinor: number }} PsykLine
 * @typedef {{ from: string, to: string, invoices: number, lines: PsykLine[] }} PsykVoucher
 * @typedef {{ vat?: unknown, vat_rate?: unknown, total?: unknown }} PsykInvoiceLine
 * @typedef {{ id?: number, number?: number, draft?: boolean, date?: string, paid?: boolean, payment_type?: string | null, currency?: string, total?: unknown, lines?: PsykInvoiceLine[] }} PsykInvoice
 */

const BRAND = 'PsykBase';
const BASE_PATH = '/app/psykbase';
const API_BASE = 'https://system.psykbase.no/api/v1';
const TITLE = 'PsykBase Clinic Invoice Accounting';
const LEAD = 'Fetch PsykBase Online invoices for a period and create one balanced review voucher in ReAI: VAT exempt treatment revenue, any taxable sales and payments by method.';
const PAGE_SIZE = 100;

/** Health services are exempt from VAT (code 6, outside the VAT act). Taxable lines map to Norwegian output VAT codes. */
const VAT_MAP = /** @type {Record<number, { code: string, account: string, label: string }>} */ ({
  0: { code: '6', account: '3200', label: 'Treatment revenue, VAT exempt health services' },
  25: { code: '3', account: '3000', label: 'Sales 25% VAT' },
  15: { code: '31', account: '3010', label: 'Sales 15% VAT' },
  12: { code: '33', account: '3020', label: 'Sales 12% VAT' },
});

/** Documented payment_type values (POST /invoices/{id}/mark-as-paid) settled at the clinic. */
const PAYMENT_ACCOUNTS = /** @type {Record<string, { account: string, label: string }>} */ ({
  cash: { account: '1900', label: 'Cash' },
  card: { account: '1580', label: 'Card' },
  other: { account: '1580', label: 'Other payment methods' },
});

/** @param {unknown} v */
const minor = (v) => Math.round(num(v) * 100);

/**
 * Builds the period voucher from PsykBase invoices.
 * @param {PsykInvoice[]} invoices @param {string} from @param {string} to
 * @returns {PsykVoucher}
 */
export function buildVoucher(invoices, from, to) {
  /** @type {Map<string, PsykLine>} */
  const byKey = new Map();
  /** @param {string} account @param {string} vatCode @param {number} vatRate @param {string} description @param {number} signedMinor */
  const add = (account, vatCode, vatRate, description, signedMinor) => {
    if (signedMinor === 0) return;
    const key = `${account}|${vatCode}|${description}`;
    const line = byKey.get(key);
    if (line) line.signedMinor += signedMinor;
    else byKey.set(key, { account, vatCode, vatRate, description, signedMinor });
  };
  for (const inv of invoices) {
    if (inv.currency && inv.currency.toUpperCase() !== 'NOK') throw new HttpError(400, `Invoice ${inv.number} is in ${inv.currency}. Only NOK invoices are supported.`);
    const total = minor(inv.total);
    const method = PAYMENT_ACCOUNTS[String(inv.payment_type ?? '')];
    if (inv.paid && method) add(method.account, '0', 0, `${BRAND} paid by ${method.label.toLowerCase()}`, total);
    else add('1570', '0', 0, `${BRAND} unpaid, transfer and insurance invoices`, total);
    for (const l of inv.lines ?? []) {
      const rate = l.vat === true ? Math.round(num(l.vat_rate)) : 0;
      const vat = VAT_MAP[rate];
      if (!vat) throw new HttpError(400, `Invoice ${inv.number} has a ${rate}% VAT line. Only Norwegian rates 25, 15, 12 and 0% are supported.`);
      add(vat.account, vat.code, rate, `${BRAND} ${vat.label}`, -minor(l.total));
    }
  }
  return { from, to, invoices: invoices.length, lines: [...byKey.values()].filter((l) => l.signedMinor !== 0) };
}

/**
 * Fetches PsykBase Online invoices dated within the period. PsykBase runs on the EasyPractice
 * platform API; the PsykBase help article https://help.psykbase.no/nb/articles/204383-api links to
 * the reference https://system.easypractice.net/api/index.html (Personal Access Token from the API app,
 * header Authorization: Bearer {token}, scope invoices-read; GET api/v1/invoices with page, page_size and
 * order_by_number; response { data: [...], links, meta } with date, draft, paid, payment_type, total, lines[].vat,
 * lines[].vat_rate and lines[].total). The endpoint has no date filter, so pages are read newest first.
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<PsykVoucher>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const to = isoDate(creds.toDate ?? creds.date);
  const from = isoDate(creds.fromDate, to);
  if (!token) throw new HttpError(400, 'Enter your PsykBase Personal Access Token.');
  if (from > to) throw new HttpError(400, 'From date must be on or before the to date.');
  /** @type {PsykInvoice[]} */ const found = [];
  let complete = false;
  for (let page = 1; page <= 30; page++) {
    const data = await fetchJson(`${API_BASE}/invoices?order_by_number=desc&page_size=${PAGE_SIZE}&page=${page}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, BRAND, fetchImpl);
    const items = /** @type {PsykInvoice[]} */ (Array.isArray(data?.data) ? data.data : []);
    for (const inv of items) {
      const d = String(inv.date ?? '').slice(0, 10);
      if (!inv.draft && d >= from && d <= to) found.push(inv);
    }
    const oldest = items.map((i) => String(i.date ?? '').slice(0, 10)).filter(Boolean).sort()[0] ?? '';
    if (items.length < PAGE_SIZE || (oldest && oldest < from)) { complete = true; break; }
  }
  if (!complete) throw new HttpError(400, `The period is too far back to read from ${BRAND} in one request. Choose a more recent period.`);
  if (found.length === 0) throw new HttpError(400, `${BRAND} returned no invoices dated ${from} to ${to}.`);
  return buildVoucher(found, from, to);
}

/** @returns {PsykVoucher} */
function sampleVoucher() {
  const session = (/** @type {number} */ number, /** @type {boolean} */ paid, /** @type {string} */ paymentType, /** @type {number} */ amount) => ({
    id: number, number, draft: false, date: '2026-10-31T00:00:00+01:00', paid, payment_type: paymentType, currency: 'NOK', total: amount,
    lines: [{ vat: false, vat_rate: 0, total: amount }],
  });
  return buildVoucher(
    [
      session(2041, true, 'card', 1450),
      session(2042, true, 'card', 1450),
      session(2043, false, 'transfer', 1950),
      session(2044, true, 'health_insurance', 1950),
      { id: 2045, number: 2045, draft: false, date: '2026-10-31T00:00:00+01:00', paid: true, payment_type: 'card', currency: 'NOK', total: 1825, lines: [{ vat: false, vat_rate: 0, total: 1200 }, { vat: true, vat_rate: 25, total: 625 }] },
    ],
    '2026-10-01',
    '2026-10-31',
  );
}

/** @param {PsykLine} l */
function vatPartMinor(l) {
  if (l.vatRate <= 0 || l.vatCode === '0') return 0;
  return l.signedMinor - Math.round((l.signedMinor * 100) / (100 + l.vatRate));
}

/** @param {PsykVoucher} v @param {boolean} isSample */
function renderPreview(v, isSample) {
  const debit = v.lines.filter((l) => l.signedMinor > 0).reduce((s, l) => s + l.signedMinor, 0);
  const credit = v.lines.filter((l) => l.signedMinor < 0).reduce((s, l) => s - l.signedMinor, 0);
  const diff = debit - credit;
  const balanced = diff === 0 && debit > 0;
  const outputVat = -v.lines.reduce((s, l) => s + vatPartMinor(l), 0);
  const exempt = -v.lines.filter((l) => l.vatCode === '6').reduce((s, l) => s + l.signedMinor, 0);
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI REVIEW VOUCHER`,
    title: `${v.from} to ${v.to} · ${v.invoices} invoice${v.invoices === 1 ? '' : 's'}`,
    badge: balanced ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }) : reaiBadge({ text: `Diff ${formatMinor(Math.abs(diff))} NOK`, tone: 'danger' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Invoiced (debit)', value: `${formatMinor(debit)} NOK` })}
        ${reaiMetric({ label: 'VAT exempt revenue', value: `${formatMinor(exempt)} NOK`, detail: 'VAT code 6' })}
        ${reaiMetric({ label: 'Estimated output VAT', value: `${formatMinor(outputVat)} NOK`, detail: 'ReAI calculates VAT from the VAT code' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>VAT code</th><th>Posting</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${v.lines.map((l) => html`<tr><td class="mono">${l.account}</td><td class="mono">${l.vatCode}</td><td>${l.description}</td><td class="num">${l.signedMinor > 0 ? formatMinor(l.signedMinor) : ''}</td><td class="num">${l.signedMinor < 0 ? formatMinor(-l.signedMinor) : ''}</td></tr>`)}</tbody>
      </table></div>
      ${balanced && !isSample
        ? html`<form class="stack-sm confirm-box" hx-post="${BASE_PATH}/book" hx-target="#psykbase-book" hx-swap="innerHTML">
            <input type="hidden" name="voucherJson" value="${JSON.stringify(v)}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I checked these totals against the PsykBase accounting report and will attach it in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="psykbase-book" class="stack-sm"></div>`
        : isSample
          ? reaiCallout({ tone: 'info', body: `Synthetic ${BRAND} invoices loaded. Connect to ReAI and fetch a real period to book.` })
          : reaiCallout({ tone: 'warn', body: 'Invoice lines do not add up to the invoice totals. Check the period in PsykBase before booking.' })}
    `,
  });
}

/**
 * Verifies the VAT codes used exist in ReAI with the expected rate and gross (vat_inclusive) basis.
 * @param {import('../../lib/types.d.ts').Env} env @param {{ accessToken: string, tenantId: number }} session @param {PsykLine[]} lines
 */
async function assertVatCodes(env, session, lines) {
  const codes = /** @type {Array<{ code: string, rate: number, amountBasis: string, reverseCharge: boolean }>} */ (
    await reaiRequest(env, '/api/vat-codes', { token: session.accessToken, tenantId: session.tenantId })
  );
  for (const l of lines) {
    if (l.vatCode === '0') continue;
    const c = codes.find((x) => x.code === l.vatCode);
    if (!c || Math.round(c.rate) !== l.vatRate || c.reverseCharge || (l.vatRate > 0 && c.amountBasis !== 'vat_inclusive')) {
      throw new HttpError(400, `ReAI VAT code ${l.vatCode} (${l.vatRate}%) is not available as an output VAT code for this company.`);
    }
  }
}

/**
 * Handles /app/psykbase/* routes.
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
      <section class="app-intro"><p class="eyebrow">PSYCHOLOGY & PSYCHIATRY CLINICS</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-psykbase-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({
          basePath: BASE_PATH,
          targetId: 'psykbase-output',
          brand: BRAND,
          hint: 'In PsykBase activate the API app, open API settings and create a Personal Access Token with the invoices-read scope.',
          fields: [
            { name: 'apiToken', label: 'Personal Access Token', type: 'password', placeholder: 'Bearer token' },
            { name: 'fromDate', label: 'From invoice date', type: 'date', defaultValue: '$MONTH_START' },
            { name: 'toDate', label: 'To invoice date', type: 'date', defaultValue: '$TODAY' },
          ],
          sampleAction: true,
        })}
        <div id="psykbase-output" class="stack"></div>
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
      if (form.get('confirm') !== 'on') throw new HttpError(400, 'Confirm that you checked the accounting report first.');
      const v = /** @type {PsykVoucher} */ (JSON.parse(String(form.get('voucherJson') ?? '{}')));
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
          reviewReason: `${BRAND} invoices imported via apps.reai.no. Check against the PsykBase accounting report.`,
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
