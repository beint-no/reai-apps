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
/** @typedef {{ date: string, ref: string, currency: string, payments: Payment[], sales: SalesRate[], credited: string[] }} Settlement */
/** @typedef {{ account: string, description: string, signedMinor: number, ratePct: number | null }} VoucherLine */
/** @typedef {{ date: string, ref: string, currency: string, lines: VoucherLine[], debitMinor: number, creditMinor: number, credited: string[] }} Voucher */
/** @typedef {{ code: string, rate: number, vatType: string, amountBasis: string, reverseCharge: boolean }} VatCode */

const SLUG = 'easypractice';
const BRAND = 'EasyPractice';
const BASE_PATH = '/app/easypractice';
const TITLE = 'EasyPractice Invoice Accounting';
const EYEBROW = 'CLINICS & THERAPISTS';
const LEAD = 'Turn the EasyPractice invoices dated in a period into one balanced ReAI review voucher, split by VAT rate and payment status.';
const API_HINT = 'In EasyPractice, activate the API app under Apps, open API Settings and create a personal access token with the invoices-read scope.';
/** @type {import('../../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [
  { name: 'apiToken', label: 'Personal access token', type: 'password', placeholder: 'invoices-read token' },
  { name: 'fromDate', label: 'Invoice date from', type: 'date', defaultValue: '$MONTH_START' },
  { name: 'toDate', label: 'Invoice date to', type: 'date', defaultValue: '$TODAY' },
];
const API = 'https://system.easypractice.net/api/v1';
/** Documented default limit is 60 requests per minute per token; stay below it and the Workers subrequest cap. */
const MAX_PAGES = 40;
const PAGE_SIZE = 100;

/** @type {Settlement} */
const SAMPLE = {
  date: '2026-10-31',
  ref: 'invoices 1201 to 1248',
  currency: 'NOK',
  credited: [],
  payments: [
    { label: 'Paid by card', amountMinor: 5240000, account: '1580' },
    { label: 'Not yet paid', amountMinor: 1070000, account: '1570' },
  ],
  sales: [
    { ratePct: 0, grossMinor: 5810000, account: '3100', label: 'Treatments without VAT' },
    { ratePct: 25, grossMinor: 500000, account: '3000', label: 'Sales 25% VAT' },
  ],
};

/** @param {unknown} v */
function minor(v) {
  return Math.round(num(v) * 100);
}

/**
 * Fetches the EasyPractice invoices dated in a period.
 * Docs (Documentarian reference, served at https://system.easypractice.net/api/ and now behind the
 * EasyPractice login; last public copy https://web.archive.org/web/20260718211007/https://system.easypractice.net/api/index.html):
 * personal access tokens are sent as Authorization: Bearer {token}; GET api/v1/invoices (scope invoices-read)
 * takes id, number, client_id, paid, unpaid, order_by_number, page_size and page, and returns { data, links, meta }
 * where each invoice has draft, date, paid, paid_date, payment_type, currency, total and lines with
 * vat, vat_rate and total, plus credited. The endpoint has no date filter, so invoices are read newest first by
 * number and filtered by invoice date here. Rate limit: 60 requests per minute per token, 429 with Retry-After.
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<Settlement>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const to = isoDate(creds.toDate ?? creds.date);
  const from = isoDate(creds.fromDate, to);
  if (!token) throw new HttpError(400, 'Enter your EasyPractice personal access token.');
  if (from > to) throw new HttpError(400, 'The from date must be on or before the to date.');
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  /** @type {import('../../lib/api-http.js').FetchLike} */
  const limited = async (input, init) => {
    const res = await fetchImpl(input, init);
    if (res.status === 429) throw new HttpError(429, `EasyPractice rate limit reached. Wait ${res.headers.get('retry-after') ?? '60'} seconds and try again.`);
    return res;
  };

  /** @type {any[]} */ const invoices = [];
  let complete = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const query = new URLSearchParams({ order_by_number: 'desc', page_size: String(PAGE_SIZE), page: String(page) });
    const data = await fetchJson(`${API}/invoices?${query}`, { headers }, BRAND, limited);
    /** @type {any[]} */ const items = Array.isArray(data?.data) ? data.data : [];
    invoices.push(...items.filter((i) => { const d = String(i.date ?? '').slice(0, 10); return d >= from && d <= to; }));
    const lastPage = Number(data?.meta?.last_page ?? 0);
    const allOlder = items.length > 0 && items.every((i) => String(i.date ?? '').slice(0, 10) < from);
    if (items.length === 0 || allOlder || (lastPage > 0 && page >= lastPage)) { complete = true; break; }
  }
  if (!complete) throw new HttpError(400, `EasyPractice has more than ${MAX_PAGES * PAGE_SIZE} invoices newer than ${from}. Choose a more recent period.`);

  const booked = invoices.filter((i) => i.draft !== true);
  if (booked.length === 0) throw new HttpError(400, `EasyPractice has no invoices dated ${from} to ${to}.`);
  const currency = String(booked[0]?.currency ?? '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, `Invoice ${String(booked[0]?.number)} has no currency.`);
  const foreign = booked.find((i) => String(i.currency ?? '').toUpperCase() !== currency);
  if (foreign) throw new HttpError(400, `Invoices ${String(booked[0]?.number)} and ${String(foreign.number)} have different currencies. Choose a period with one currency.`);

  /** @type {Map<string, SalesRate>} */ const sales = new Map();
  /** @type {Map<string, Payment>} */ const payments = new Map();
  for (const inv of booked) {
    let invoiceMinor = 0;
    for (const l of /** @type {any[]} */ (Array.isArray(inv.lines) ? inv.lines : [])) {
      const grossMinor = minor(l.total);
      if (grossMinor === 0) continue;
      const ratePct = l.vat === true ? num(l.vat_rate) : 0;
      const account = ratePct > 0 ? '3000' : '3100';
      const key = `${account}|${ratePct}`;
      const prev = sales.get(key);
      sales.set(key, { ratePct, account, label: ratePct > 0 ? `Sales ${ratePct}% VAT` : 'Sales without VAT', grossMinor: (prev?.grossMinor ?? 0) + grossMinor });
      invoiceMinor += grossMinor;
    }
    if (invoiceMinor === 0) continue;
    const type = String(inv.payment_type ?? '').trim();
    const payment = inv.paid !== true
      ? { label: 'Not yet paid', account: '1570' }
      : type.toLowerCase() === 'cash'
        ? { label: 'Paid in cash', account: '1900' }
        : { label: `Paid${type ? ` by ${type}` : ''}`, account: '1580' };
    const prev = payments.get(payment.label);
    payments.set(payment.label, { ...payment, amountMinor: (prev?.amountMinor ?? 0) + invoiceMinor });
  }
  const numbers = booked.map((i) => Number(i.number)).filter(Number.isFinite).sort((a, b) => a - b);
  const ref = numbers.length > 0 ? `invoices ${numbers[0]} to ${numbers.at(-1)}` : `invoices ${from}`;
  const credited = booked.filter((i) => i.credited === true).map((i) => String(i.number));
  return { date: to, ref, currency, payments: [...payments.values()], sales: [...sales.values()], credited };
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
  return { date: s.date, ref: s.ref, currency: s.currency, lines, debitMinor, creditMinor, credited: s.credited };
}

/** @param {Voucher} v @param {boolean} isSample */
function renderPreview(v, isSample) {
  const diff = v.debitMinor - v.creditMinor;
  const balanced = diff === 0 && v.debitMinor > 0;
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI REVIEW VOUCHER`,
    title: `${v.ref} · ${v.date}`,
    badge: balanced ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }) : reaiBadge({ text: `Diff ${formatMinor(Math.abs(diff))} ${v.currency}`, tone: 'danger' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Paid and unpaid (debit)', value: `${formatMinor(v.debitMinor)} ${v.currency}` })}
        ${reaiMetric({ label: 'Sales incl. VAT (credit)', value: `${formatMinor(v.creditMinor)} ${v.currency}` })}
      </div>
      ${v.credited.length > 0 ? reaiCallout({ tone: 'warn', title: 'Credited invoices', body: `EasyPractice marks invoice ${v.credited.join(', ')} as credited. Check that the credit note is in the period or book it separately.` }) : ''}
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Posting</th><th>VAT</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${v.lines.map((l) => html`<tr><td class="mono">${l.account}</td><td>${l.description}</td><td>${l.ratePct === null ? 'None' : `${l.ratePct}%`}</td><td class="num">${l.signedMinor > 0 ? formatMinor(l.signedMinor) : ''}</td><td class="num">${l.signedMinor < 0 ? formatMinor(-l.signedMinor) : ''}</td></tr>`)}</tbody>
      </table></div>
      <p class="muted-note">Sales lines are posted including VAT with the matching ReAI output VAT code, so ReAI separates the taxable base and VAT. Paid invoices go to 1900 for cash and to clearing account 1580 for other payment types. Unpaid invoices go to 1570 until the payment arrives.</p>
      ${balanced && !isSample
        ? html`<form class="stack-sm confirm-box" hx-post="${BASE_PATH}/book" hx-target="#${SLUG}-book" hx-swap="innerHTML">
            <input type="hidden" name="voucherJson" value="${JSON.stringify(v)}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I verified these figures against the ${BRAND} invoice list and will attach it in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="${SLUG}-book" class="stack-sm"></div>`
        : isSample
          ? reaiCallout({ tone: 'info', body: `Sample ${BRAND} settlement loaded. Connect to ReAI and fetch a real period above to book it.` })
          : reaiCallout({ tone: 'warn', body: `Payments and sales do not balance for this period in ${BRAND}. Check the invoices there before booking.` })}
    `,
  });
}

/**
 * Picks the ReAI output VAT code for a sales rate (VAT-inclusive amounts). Lines without VAT are treatments
 * outside the VAT Act (health services), so a code outside the scope of VAT is preferred over a zero rate.
 * @param {VatCode[]} codes
 * @param {number} ratePct
 */
function outputVatCode(codes, ratePct) {
  const usable = codes.filter((c) => !c.reverseCharge && (ratePct === 0 || c.amountBasis === 'vat_inclusive') && Math.abs(c.rate - ratePct) < 0.001);
  const match = ratePct > 0
    ? usable.find((c) => c.vatType === 'output_vat')
    : (usable.find((c) => c.vatType === 'outside_scope') ?? usable.find((c) => c.vatType === 'exempt') ?? usable.find((c) => c.vatType === 'output_vat'));
  if (!match) throw new HttpError(400, `ReAI has no output VAT code for ${ratePct}% in this company.`);
  return match.code;
}

/**
 * Handles /app/easypractice/* routes.
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
      const company = session.tenants.find((t) => t.id === session.tenantId);
      if (company && company.currencyCode !== v.currency) throw new HttpError(400, `The invoices are in ${String(v.currency)} but ${company.companyName} keeps its accounts in ${company.currencyCode}.`);
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
          reviewReason: `${BRAND} POS settlement imported via apps.reai.no. Check against the ${BRAND} invoice list.`,
          postings: pairVoucherRows(v.lines.map((l) => ({
            accountNumber: String(l.account),
            postingDate: v.date,
            currencyCode: String(v.currency),
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
