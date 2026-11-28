// @ts-check
import { pairVoucherRows } from '../../lib/voucher-rows.js';
import { assertPublicHttpsUrl, isoDate, num, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/** @typedef {{ label: string, amountMinor: number, account?: string }} Payment */
/** @typedef {{ ratePct: number, grossMinor: number, account?: string, label?: string, vatCode?: string }} SalesRate */
/** @typedef {{ date: string, ref: string, payments: Payment[], sales: SalesRate[], tipsMinor: number, discountMinor?: number, lineCount?: number }} Settlement */
/** @typedef {{ account: string, description: string, signedMinor: number, ratePct: number | null, vatMinor: number, vatCode?: string }} VoucherLine */
/** @typedef {{ date: string, ref: string, lines: VoucherLine[], debitMinor: number, creditMinor: number, discountMinor?: number }} Voucher */

/** @type {Record<string, string>} */
const REVENUE_ACCOUNTS = { 25: '3000', 15: '3010', 12: '3020' };

/**
 * Adds an amount to a keyed running total.
 * @param {Map<string, number>} totals
 * @param {string} key
 * @param {number} amountMinor
 */
function addTo(totals, key, amountMinor) {
  totals.set(key, (totals.get(key) ?? 0) + amountMinor);
}

/**
 * Turns keyed totals into a settlement.
 * @param {string} date
 * @param {string} ref
 * @param {Map<string, number>} payments
 * @param {Map<string, number>} salesByRate
 * @param {number} tipsMinor
 * @returns {Settlement}
 */
function toSettlement(date, ref, payments, salesByRate, tipsMinor) {
  return {
    date,
    ref,
    payments: [...payments].filter(([, a]) => a !== 0).map(([label, amountMinor]) => ({ label, amountMinor })),
    sales: [...salesByRate].filter(([, a]) => a !== 0).map(([rate, grossMinor]) => ({ ratePct: Number(rate), grossMinor })).sort((a, b) => b.ratePct - a.ratePct),
    tipsMinor,
  };
}

/**
 * Converts a decimal amount in kroner to øre.
 * @param {unknown} v
 */
function minor(v) {
  return Math.round(num(v) * 100);
}

const SLUG = 'caspeco';
const BRAND = 'Caspeco';
const BASE_PATH = '/app/caspeco';
const TITLE = 'Caspeco Daily Sales Accounting';
const EYEBROW = 'HOSPITALITY POS · NORDICS';
const LEAD = 'Total one Caspeco business day of POS sales into a balanced ReAI review voucher with sales split by VAT rate, payments by type and tips payable.';
const API_HINT = 'Caspeco support issues the Export API AuthKey together with your Caspeco system name. A business day runs from 06:00 to 05:59 the next morning.';
/** @type {import('../../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [
  { name: 'authKey', label: 'Export API AuthKey', type: 'password' },
  { name: 'system', label: 'Caspeco system name', placeholder: 'From Caspeco support' },
  { name: 'date', label: 'Business day', type: 'date', defaultValue: '$TODAY' },
];
const API = 'https://salesapi.caspeco.net/api/sales';
const RATES = [25, 15, 12, 0];

/** @type {Settlement} */
const SAMPLE = {
  date: '2026-10-24',
  ref: 'restaurant-eksempel',
  payments: [
    { label: 'Card', amountMinor: 4128000 },
    { label: 'Cash', amountMinor: 162000 },
    { label: 'Vipps', amountMinor: 433000 },
  ],
  sales: [
    { ratePct: 25, grossMinor: 3684000 },
    { ratePct: 15, grossMinor: 889000 },
  ],
  tipsMinor: 150000,
};

/**
 * Reads a documented field regardless of JSON casing (SalesExVat or salesExVat).
 * @param {Record<string, unknown>} row
 * @param {string} name
 */
function field(row, name) {
  if (name in row) return row[name];
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(row)) if (k.toLowerCase() === lower) return v;
  return undefined;
}

/** @param {number} exMinor @param {number} vatMinor */
function nearestRate(exMinor, vatMinor) {
  if (exMinor === 0) return 0;
  const pct = (vatMinor / exMinor) * 100;
  return RATES.reduce((best, r) => (Math.abs(r - pct) < Math.abs(best - pct) ? r : best), 25);
}

/**
 * Fetches one Caspeco business day of sales lines from the Export API and totals it.
 * Docs: https://developers.caspeco.se/v1/guides/sales-export-api/overview/ (AuthKey header, system name and
 * YYYY-MM-DD date, 100 requests per day per token), https://developers.caspeco.se/v1/api/analytics/operations/exportapi_sales/
 * (GET /api/sales/{system}/{date}) and https://developers.caspeco.se/v1/guides/sales-export-api/data-specification/
 * (SalesExVat, SalesVat, Payment, TicketTip and RecieptId per line; the tip is shared by all lines of a receipt).
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<Settlement>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const date = isoDate(creds.date);
  const authKey = (creds.authKey ?? '').trim();
  const system = (creds.system ?? '').trim();
  if (!authKey || !/^[A-Za-z0-9_.-]{1,100}$/.test(system)) throw new HttpError(400, 'Enter the Caspeco AuthKey and system name.');
  const url = `${API}/${encodeURIComponent(system)}/${date}`;
  assertPublicHttpsUrl(url);
  const res = await fetchImpl(url, { headers: { AuthKey: authKey, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  if (res.status === 429) throw new HttpError(429, 'Caspeco allows 100 Export API requests per day for each AuthKey. Try again tomorrow.');
  if (res.status === 401 || res.status === 403) throw new HttpError(400, 'Caspeco rejected the AuthKey. Check the key and the system name with Caspeco support.');
  if (res.status === 404) throw new HttpError(400, `Caspeco returned HTTP 404 for system ${system}. Check the system name with Caspeco support.`);
  if (!res.ok) throw new HttpError(400, `Caspeco Export API returned HTTP ${res.status}.`);
  const data = await res.json();
  /** @type {Array<Record<string, unknown>>} */ const rows = (Array.isArray(data) ? data : []).filter((r) => r && typeof r === 'object' && field(r, 'EmptyGroup') !== true);
  if (rows.length === 0) throw new HttpError(400, `Caspeco returned no sales lines for ${date}.`);
  /** @type {Map<string, number>} */ const payments = new Map();
  /** @type {Map<string, number>} */ const salesByRate = new Map();
  /** @type {Map<string, { tip: number, payment: string }>} */ const receipts = new Map();
  let discountMinor = 0;
  for (const row of rows) {
    discountMinor += minor(field(row, 'DiscountExVat')) + minor(field(row, 'DiscountVat'));
    const exMinor = minor(field(row, 'SalesExVat'));
    const vatMinor = minor(field(row, 'SalesVat'));
    const gross = exMinor + vatMinor;
    const payment = String(field(row, 'Payment') ?? '').trim() || 'Unspecified payment';
    addTo(salesByRate, String(nearestRate(exMinor, vatMinor)), gross);
    addTo(payments, payment, gross);
    const receiptId = String(field(row, 'RecieptId') ?? field(row, 'ReceiptId') ?? '').trim();
    const tip = minor(field(row, 'TicketTip'));
    if (receiptId && tip !== 0 && !receipts.has(receiptId)) receipts.set(receiptId, { tip, payment });
  }
  let tipsMinor = 0;
  for (const { tip, payment } of receipts.values()) {
    tipsMinor += tip;
    addTo(payments, payment, tip);
  }
  return { ...toSettlement(date, system, payments, salesByRate, tipsMinor), discountMinor: Math.abs(discountMinor) };
}

/** @param {string} label */
function paymentAccount(label) {
  return /^(cash|kontant)/i.test(label.trim()) ? '1900' : '1580';
}

/** @param {number} ratePct */
function revenueAccount(ratePct) {
  return REVENUE_ACCOUNTS[String(ratePct)] ?? '3100';
}

/** @param {number} grossMinor @param {number} pct */
function splitVat(grossMinor, pct) {
  if (pct <= 0 || grossMinor === 0) return { net: grossMinor, vat: 0 };
  const net = Math.round((grossMinor * 100) / (100 + pct));
  return { net, vat: grossMinor - net };
}

/** @param {Settlement} s @returns {Voucher} */
function buildVoucher(s) {
  /** @type {VoucherLine[]} */ const lines = [];
  const pfx = `${BRAND} ${s.ref}`;
  for (const p of s.payments) {
    if (p.amountMinor !== 0) lines.push({ account: p.account ?? paymentAccount(p.label), description: `${pfx} · ${p.label}`, signedMinor: p.amountMinor, ratePct: null, vatMinor: 0 });
  }
  for (const r of s.sales) {
    if (r.grossMinor !== 0) {
      const { vat } = r.vatCode ? { vat: 0 } : splitVat(r.grossMinor, r.ratePct);
      lines.push({ account: r.account ?? revenueAccount(r.ratePct), description: `${pfx} · ${r.label ?? `Sales ${r.ratePct}% VAT`}`, signedMinor: -r.grossMinor, ratePct: r.ratePct, vatMinor: -vat, ...(r.vatCode ? { vatCode: r.vatCode } : {}) });
    }
  }
  if (s.tipsMinor !== 0) lines.push({ account: '2930', description: `${pfx} · Staff tips payable`, signedMinor: -s.tipsMinor, ratePct: null, vatMinor: 0 });
  const debitMinor = lines.filter((l) => l.signedMinor > 0).reduce((t, l) => t + l.signedMinor, 0);
  const creditMinor = lines.filter((l) => l.signedMinor < 0).reduce((t, l) => t - l.signedMinor, 0);
  return { date: s.date, ref: s.ref, lines, debitMinor, creditMinor, ...(s.discountMinor ? { discountMinor: s.discountMinor } : {}) };
}

/** @param {Voucher} v @param {boolean} isSample */
function renderPreview(v, isSample) {
  const diff = v.debitMinor - v.creditMinor;
  const balanced = diff === 0 && v.debitMinor > 0;
  const vatTotal = v.lines.reduce((t, l) => t - l.vatMinor, 0);
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI REVIEW VOUCHER`,
    title: `${v.ref} · ${v.date}`,
    badge: balanced ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }) : reaiBadge({ text: `Diff ${formatMinor(Math.abs(diff))} NOK`, tone: 'danger' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Payments (debit)', value: `${formatMinor(v.debitMinor)} NOK` })}
        ${reaiMetric({ label: 'Sales incl. VAT + tips (credit)', value: `${formatMinor(v.creditMinor)} NOK` })}
        ${reaiMetric({ label: 'Output VAT (split by ReAI)', value: `${formatMinor(vatTotal)} NOK` })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Posting</th><th>VAT</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${v.lines.map((l) => html`<tr><td class="mono">${l.account}</td><td>${l.description}</td><td>${l.vatCode ? `Code ${l.vatCode}` : l.ratePct === null ? 'None' : `${l.ratePct}% (${formatMinor(-l.vatMinor)})`}</td><td class="num">${l.signedMinor > 0 ? formatMinor(l.signedMinor) : ''}</td><td class="num">${l.signedMinor < 0 ? formatMinor(-l.signedMinor) : ''}</td></tr>`)}</tbody>
      </table></div>
      ${v.discountMinor ? reaiCallout({ tone: 'warn', body: `Caspeco reports ${formatMinor(v.discountMinor)} NOK in discounts including VAT. Sales are taken as already net of discounts; check the totals against the Caspeco day report.` }) : ''}
      <p class="muted-note">Sales lines are posted including VAT with the matching ReAI output VAT code, so ReAI separates the taxable base and VAT. Card, Vipps and other terminal payments go to clearing account 1580 for later bank matching.</p>
      ${balanced && !isSample
        ? html`<form class="stack-sm confirm-box" hx-post="${BASE_PATH}/book" hx-target="#${SLUG}-book" hx-swap="innerHTML">
            <input type="hidden" name="voucherJson" value="${JSON.stringify(v)}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I verified these figures against the ${BRAND} report and will attach it in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="${SLUG}-book" class="stack-sm"></div>`
        : isSample
          ? reaiCallout({ tone: 'info', body: `Sample ${BRAND} settlement loaded. Connect to ReAI and fetch a real day above to book it.` })
          : reaiCallout({ tone: 'warn', body: `Payments and sales do not balance for this day in ${BRAND}. Check the report there before booking.` })}
    `,
  });
}

/**
 * Picks the ReAI output VAT code for each sales rate (VAT-inclusive amounts).
 * @param {Array<{ code: string, rate: number, vatType: string, amountBasis: string, reverseCharge: boolean }>} codes
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
 * Checks a VAT code taken from the POS report against the ReAI VAT codes.
 * @param {Array<{ code: string, rate: number, vatType: string, amountBasis: string, reverseCharge: boolean }>} codes
 * @param {string} code
 */
function knownOutputVatCode(codes, code) {
  const match = codes.find((c) => c.code === code);
  if (!match || match.reverseCharge || match.amountBasis !== 'vat_inclusive' || match.vatType === 'input_vat') throw new HttpError(400, `VAT code ${code} from ${BRAND} is not a ReAI output VAT code. Check the VAT mapping in ${BRAND}.`);
  return match.code;
}

/**
 * Handles /app/caspeco/* routes.
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
      const vatCodes = /** @type {Array<{ code: string, rate: number, vatType: string, amountBasis: string, reverseCharge: boolean }>} */ (await reaiRequest(env, '/api/vat-codes', auth));
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', {
        ...auth,
        method: 'POST',
        body: {
          date: v.date,
          description: marker,
          reviewReason: `${BRAND} daily settlement imported via apps.reai.no. Check against the ${BRAND} report.`,
          postings: pairVoucherRows(v.lines.map((l) => ({
            accountNumber: String(l.account),
            postingDate: v.date,
            currencyCode: 'NOK',
            amount: Number((Math.round(Number(l.signedMinor)) / 100).toFixed(2)),
            vatCode: l.vatCode ? knownOutputVatCode(vatCodes, String(l.vatCode)) : l.ratePct === null ? '0' : outputVatCode(vatCodes, Number(l.ratePct)),
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
