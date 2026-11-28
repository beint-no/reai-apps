// @ts-check
import { pairVoucherRows } from '../../lib/voucher-rows.js';
import { fetchJson, isoDate, num, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/** @typedef {{ label: string, amountMinor: number, account?: string }} Payment */
/** @typedef {{ ratePct: number, grossMinor: number, account?: string, label?: string, vatCode?: string }} SalesRate */
/** @typedef {{ date: string, ref: string, payments: Payment[], sales: SalesRate[], tipsMinor: number }} Settlement */
/** @typedef {{ account: string, description: string, signedMinor: number, ratePct: number | null, vatMinor: number, vatCode?: string }} VoucherLine */
/** @typedef {{ date: string, ref: string, lines: VoucherLine[], debitMinor: number, creditMinor: number }} Voucher */

/** @type {Record<string, string>} */
const REVENUE_ACCOUNTS = { 25: '3000', 15: '3010', 12: '3020' };

const SLUG = 'flow-retail';
const BRAND = 'Flow Retail';
const BASE_PATH = '/app/flow-retail';
const TITLE = 'Flow Retail Daily Accounting';
const EYEBROW = 'RETAIL POS · NORWAY';
const LEAD = 'Turn the Flow Retail accounting report for one day into a balanced ReAI review voucher, using the accounts and VAT codes mapped in Flow Retail.';
const API_HINT = 'Create a user with account type Integration in Flow Retail Admin under Users → New User, give it the Reporting role and generate an integration token. API access is included from Flow Pro.';
/** @type {import('../../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [
  { name: 'token', label: 'Integration token', type: 'password' },
  { name: 'tenantUid', label: 'Tenant id (client in Flow Retail Admin)' },
  { name: 'organizationUid', label: 'Organization id (optional with one organization)', required: false },
  { name: 'date', label: 'Report date', type: 'date', defaultValue: '$TODAY' },
];
const API = 'https://api.flowretail.com/v2';
const SECTIONS = /** @type {const} */ (['asset', 'debet', 'credit', 'ledger']);

/** @type {Settlement} */
const SAMPLE = {
  date: '2026-10-24',
  ref: 'Butikk Eksempel',
  payments: [
    { label: 'Kontant', amountMinor: 246000, account: '1900' },
    { label: 'Bankterminal', amountMinor: 3518000, account: '1580' },
    { label: 'Vipps', amountMinor: 640500, account: '1580' },
    { label: 'Øreavrunding', amountMinor: -50, account: '3099' },
  ],
  sales: [
    { ratePct: 25, grossMinor: 4404450, account: '3000', label: 'Varesalg 25%', vatCode: '3' },
  ],
  tipsMinor: 0,
};

/**
 * Fetches the Flow Retail accounting report (already aggregated debit and credit postings) for one day.
 * Docs: https://docs.flowretail.com/docs/developers/authentication.md (integration token as Bearer),
 * https://docs.flowretail.com/docs/integrations/erp.md ("Pull one accounting report per day after close"),
 * https://docs.flowretail.com/docs/developers/api-documentation/reports/accounting-report-for-stores-json-format.md
 * (POST /tenants/{tenantUid}/reports/accounting with fromDate, toDate and organizationUid; postings with account,
 * debetAmount, creditAmount, text and vatCode), https://docs.flowretail.com/docs/developers/quantity-and-price-representation.md
 * (integer amounts with two implied decimals) and the OpenAPI spec https://api.flowretail.com/v2/spec
 * (GET /tenants/{tenantUid}/organizations returns items with organizationUid).
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<Settlement>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const date = isoDate(creds.date);
  const token = (creds.token ?? '').trim();
  const tenantUid = (creds.tenantUid ?? '').trim();
  let organizationUid = (creds.organizationUid ?? '').trim();
  if (!token || !/^[A-Za-z0-9_-]+$/.test(tenantUid)) throw new HttpError(400, 'Enter the Flow Retail integration token and tenant id.');
  if (organizationUid && !/^[A-Za-z0-9_-]+$/.test(organizationUid)) throw new HttpError(400, 'Enter a valid Flow Retail organization id.');
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const tenantPath = `${API}/tenants/${encodeURIComponent(tenantUid)}`;
  if (!organizationUid) {
    const orgs = await fetchJson(`${tenantPath}/organizations?pageNumber=1&pageSize=100`, { headers }, BRAND, fetchImpl);
    /** @type {any[]} */ const items = (Array.isArray(orgs?.items) ? orgs.items : []).filter((/** @type {any} */ o) => o.isActive !== false);
    if (items.length !== 1) throw new HttpError(400, `Flow Retail has ${items.length} active organizations. Enter the organization id to use.`);
    organizationUid = String(items[0].organizationUid ?? '');
  }
  const report = await fetchJson(`${tenantPath}/reports/accounting`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ fromDate: date, toDate: date, organizationUid }),
  }, BRAND, fetchImpl);

  // Each section holds postings of the same shape. Identical postings repeated across sections are counted once.
  const seen = new Set();
  /** @type {Array<{ account: string, signedMinor: number, text: string, vatCode: string }>} */ const posts = [];
  for (const section of SECTIONS) {
    for (const p of Array.isArray(report?.[section]) ? report[section] : []) {
      const key = JSON.stringify([p.account, p.debetAmount, p.creditAmount, p.text, p.vatCode, p.date]);
      if (seen.has(key)) continue;
      seen.add(key);
      const signedMinor = Math.round(num(p.debetAmount)) - Math.round(num(p.creditAmount));
      const account = String(p.account ?? '').trim();
      if (signedMinor !== 0 && /^[0-9]{4}$/.test(account)) posts.push({ account, signedMinor, text: String(p.text ?? '').trim() || 'Posting', vatCode: String(p.vatCode ?? '').trim() });
    }
  }
  if (posts.length === 0) throw new HttpError(400, `Flow Retail has no accounting postings for ${date}.`);
  // When Flow Retail posts VAT on its own 27xx line, the revenue lines exclude VAT and are kept with VAT code 0.
  // Otherwise revenue lines carry the sale including VAT and keep Flow Retail's VAT code, which ReAI splits.
  const separateVat = posts.some((p) => p.account.startsWith('27'));
  /** @type {Payment[]} */ const payments = [];
  /** @type {SalesRate[]} */ const sales = [];
  for (const p of posts) {
    const taxable = !separateVat && p.signedMinor < 0 && p.vatCode !== '' && p.vatCode !== '0' && /^3/.test(p.account);
    if (taxable) sales.push({ ratePct: 0, grossMinor: -p.signedMinor, account: p.account, label: p.text, vatCode: p.vatCode });
    else payments.push({ label: p.text, amountMinor: p.signedMinor, account: p.account });
  }
  const store = Array.isArray(report?.storeNames) && report.storeNames.length ? report.storeNames.join(', ') : String(report?.organizationName ?? organizationUid);
  return { date, ref: store.slice(0, 80), payments, sales, tipsMinor: 0 };
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
  return { date: s.date, ref: s.ref, lines, debitMinor, creditMinor };
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
 * Handles /app/flow-retail/* routes.
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
