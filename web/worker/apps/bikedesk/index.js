// @ts-check
import { pairVoucherRows } from '../../lib/voucher-rows.js';
import { fetchJson, isoDate, num, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/** @typedef {{ account: string, description: string, signedMinor: number, ratePct: number | null }} VoucherLine */
/** @typedef {{ date: string, ref: string, currency: string, lines: VoucherLine[], debitMinor: number, creditMinor: number, cashDiffMinor: number }} Voucher */
/** @typedef {{ code: string, rate: number, vatType: string, amountBasis: string, reverseCharge: boolean }} VatCode */

const SLUG = 'bikedesk';
const BRAND = 'Bikedesk';
const BASE_PATH = '/app/bikedesk';
const TITLE = 'Bikedesk Day Close Accounting';
const EYEBROW = 'RETAIL POS · BIKE SHOPS';
const LEAD = 'Turn the Bikedesk (Customers 1st) cash register balances for one day into a balanced ReAI review voucher: payments per payment type and sales per VAT rate.';
const API_HINT = 'Create an API user in Customers 1st under Settings → API → API users and copy its token. Leave the register empty to include every cash register.';
/** @type {import('../../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [
  { name: 'token', label: 'API token', type: 'password' },
  { name: 'cashRegisterId', label: 'Cash register id (optional)', required: false, placeholder: '2' },
  { name: 'date', label: 'Balance date', type: 'date', defaultValue: '$TODAY' },
];
const API = 'https://api.c1st.com/api';
const PAGE_LENGTH = 50;
const MAX_PAGES = 10;
const KNOWN_RATES = [25, 15, 12, 0];
/** @type {Record<string, string>} */
const REVENUE_ACCOUNTS = { 25: '3000', 15: '3010', 12: '3020', 0: '3100' };

/** @param {unknown} v */
function minor(v) {
  return Math.round(num(v) * 100);
}

/** @param {unknown} v @param {string} fallback */
function account(v, fallback) {
  const s = String(v ?? '').trim();
  return /^[0-9]{4}$/.test(s) ? s : fallback;
}

/**
 * Reads the Customers 1st POS balances (day closes) for one date and sums them into voucher lines.
 * Docs: https://api-docs.c1st.com/ (OpenAPI https://api-docs.c1st.com/spec.json, info.version 1.0.0): GET /posbalances with
 * fromDate/toDate ('YYYY-MM-DD HH:MM:SS'), cashRegisterId, paginationStart (offset, max 2500) and paginationPageLength;
 * response { content, count, hasMore }. POSBalance amounts are decimal major units; paymenttypes[] carry title, amount,
 * cash, accountno, currency and giftcardtype; totalvatbypercentage[] carry percentage, revenue_incl_vat and revenue_account_no.
 * Auth: Authorization: Bearer token from Settings → API → API users. Rate limit: bucket of 80, refills 8 per second.
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<Voucher>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.token ?? '').trim();
  if (!token) throw new HttpError(400, 'Enter the Customers 1st API token.');
  const register = (creds.cashRegisterId ?? '').trim();
  if (register && !/^[0-9]+$/.test(register)) throw new HttpError(400, 'The cash register id is a number.');
  const date = isoDate(creds.date);
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };

  /** @type {any[]} */ const balances = [];
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) throw new HttpError(400, `Customers 1st returned more than ${MAX_PAGES * PAGE_LENGTH} balances for ${date}.`);
    const query = new URLSearchParams({ fromDate: `${date} 00:00:00`, toDate: `${date} 23:59:59`, paginationStart: String(page * PAGE_LENGTH), paginationPageLength: String(PAGE_LENGTH), sortField: 'id', sortOrder: '1' });
    if (register) query.set('cashRegisterId', register);
    const data = await fetchJson(`${API}/posbalances?${query}`, { headers }, BRAND, fetchImpl);
    /** @type {any[]} */ const rows = Array.isArray(data?.content) ? data.content : [];
    balances.push(...rows);
    if (!data?.hasMore || rows.length === 0) break;
  }
  const onDay = balances.filter((b) => isoDate(b.date ?? b.enddate, '') === date);
  if (onDay.length === 0) throw new HttpError(400, `Customers 1st has no cash register balance dated ${date}.`);

  /** @type {Map<string, VoucherLine>} */ const byKey = new Map();
  /** @param {string} key @param {Omit<VoucherLine, 'signedMinor'>} base @param {number} amount */
  const add = (key, base, amount) => {
    const line = byKey.get(key) ?? { ...base, signedMinor: 0 };
    line.signedMinor += amount;
    byKey.set(key, line);
  };
  /** @type {Set<string>} */ const currencies = new Set();
  let cashDiffMinor = 0;
  for (const b of onDay) {
    for (const p of Array.isArray(b.paymenttypes) ? b.paymenttypes : []) {
      const amount = minor(p.amount);
      if (amount === 0) continue;
      if (p.currency) currencies.add(String(p.currency).toUpperCase());
      const title = String(p.title ?? 'Payment').trim();
      const fallback = p.cash === true ? '1900' : p.giftcardtype ? '2900' : '1580';
      const acc = account(p.accountno, fallback);
      add(`pay:${acc}:${title.toLowerCase()}`, { account: acc, description: title, ratePct: null }, amount);
    }
    for (const v of Array.isArray(b.totalvatbypercentage) ? b.totalvatbypercentage : []) {
      const gross = minor(v.revenue_incl_vat);
      if (gross === 0) continue;
      const pct = num(v.percentage);
      const rate = KNOWN_RATES.find((k) => Math.abs(k - pct) < 0.01);
      if (rate === undefined) throw new HttpError(400, `Balance ${String(b.balance_no ?? b.id)} has VAT rate ${pct}%, which is not a Norwegian rate.`);
      const acc = account(v.revenue_account_no, REVENUE_ACCOUNTS[String(rate)] ?? '3000');
      add(`rev:${acc}:${rate}`, { account: acc, description: `Sales ${rate}% VAT`, ratePct: rate }, -gross);
    }
    const issued = minor(b.giftcardissued);
    if (issued !== 0) add('giftcard-issued', { account: '2900', description: 'Gift cards issued', ratePct: null }, -Math.abs(issued));
    cashDiffMinor += minor(b.cashdifference);
  }
  if (currencies.size > 1) throw new HttpError(400, `The balances mix currencies (${[...currencies].join(', ')}).`);
  const currency = [...currencies][0] ?? 'NOK';

  let lines = [...byKey.values()].filter((l) => l.signedMinor !== 0);
  const residual = lines.reduce((t, l) => t + l.signedMinor, 0);
  // Cash rounding (øreavrunding) is the only difference posted automatically; anything larger blocks booking.
  if (residual !== 0 && Math.abs(residual) < 100) lines = [...lines, { account: '7990', description: 'Cash rounding', signedMinor: -residual, ratePct: null }];
  const ref = `Balance ${onDay.map((b) => String(b.balance_no ?? b.id)).join(', ')}`;
  const withPrefix = lines.map((l) => ({ ...l, description: `${BRAND} ${ref} · ${l.description}`.slice(0, 200) }));
  const debitMinor = withPrefix.filter((l) => l.signedMinor > 0).reduce((t, l) => t + l.signedMinor, 0);
  const creditMinor = withPrefix.filter((l) => l.signedMinor < 0).reduce((t, l) => t - l.signedMinor, 0);
  return { date, ref, currency, lines: withPrefix, debitMinor, creditMinor, cashDiffMinor };
}

/** @type {Voucher} */
const SAMPLE = {
  date: '2026-10-24',
  ref: 'Balance 412',
  currency: 'NOK',
  cashDiffMinor: 0,
  debitMinor: 4859000,
  creditMinor: 4859000,
  lines: [
    { account: '1900', description: 'Bikedesk Balance 412 · Kontant', signedMinor: 129000, ratePct: null },
    { account: '1580', description: 'Bikedesk Balance 412 · Bankterminal', signedMinor: 3980000, ratePct: null },
    { account: '1580', description: 'Bikedesk Balance 412 · Vipps', signedMinor: 750000, ratePct: null },
    { account: '3000', description: 'Bikedesk Balance 412 · Sales 25% VAT', signedMinor: -4859000, ratePct: 25 },
  ],
};

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
        ${reaiMetric({ label: 'Payments (debit)', value: `${formatMinor(v.debitMinor)} ${v.currency}` })}
        ${reaiMetric({ label: 'Sales incl. VAT (credit)', value: `${formatMinor(v.creditMinor)} ${v.currency}` })}
        ${reaiMetric({ label: 'Cash difference', value: `${formatMinor(v.cashDiffMinor)} ${v.currency}`, detail: 'Counted against expected; not booked here' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Posting</th><th>VAT</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${v.lines.map((l) => html`<tr><td class="mono">${l.account}</td><td>${l.description}</td><td>${l.ratePct === null ? 'None' : `Output ${l.ratePct}%`}</td><td class="num">${l.signedMinor > 0 ? formatMinor(l.signedMinor) : ''}</td><td class="num">${l.signedMinor < 0 ? formatMinor(-l.signedMinor) : ''}</td></tr>`)}</tbody>
      </table></div>
      <p class="muted-note">Accounts set on payment types and VAT rates in Customers 1st are kept. Sales are posted including VAT with the matching ReAI output VAT code, so ReAI separates base and VAT. Card and Vipps payments stay on clearing account 1580 until they are matched against the bank.</p>
      ${balanced && !isSample
        ? html`<form class="stack-sm confirm-box" hx-post="${BASE_PATH}/book" hx-target="#${SLUG}-book" hx-swap="innerHTML">
            <input type="hidden" name="voucherJson" value="${JSON.stringify(v)}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I verified these figures against the ${BRAND} balance report and will attach it in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="${SLUG}-book" class="stack-sm"></div>`
        : isSample
          ? reaiCallout({ tone: 'info', body: `Sample ${BRAND} day loaded. Connect to ReAI and fetch a real day above to book it.` })
          : reaiCallout({ tone: 'warn', body: 'Payments and sales do not balance for this day, for example because of customer payments on account or invoice sales. Book this day manually from the balance report.' })}
    `,
  });
}

/**
 * Picks the ReAI output VAT code for a VAT-inclusive sales rate.
 * @param {VatCode[]} codes @param {number} ratePct
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
 * Handles /app/bikedesk/* routes.
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
  if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderPreview(SAMPLE, true));
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
      if (form.get('confirm') !== 'on') throw new HttpError(400, 'Confirm the verification checkbox first.');
      const v = /** @type {Voucher} */ (JSON.parse(String(form.get('voucherJson') ?? '{}')));
      if (!Array.isArray(v.lines) || !v.lines.length || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(v.date)) || !/^[A-Z]{3}$/.test(String(v.currency))) throw new HttpError(400, 'Voucher is empty.');
      const company = session.tenants.find((t) => t.id === session.tenantId);
      if (company && company.currencyCode !== v.currency) throw new HttpError(400, `The balance is in ${v.currency}, but the ReAI company uses ${company.currencyCode}.`);
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
          reviewReason: `${BRAND} day close imported via apps.reai.no. Check against the ${BRAND} balance report.`,
          postings: pairVoucherRows(v.lines.map((l) => ({
            accountNumber: String(l.account),
            postingDate: v.date,
            currencyCode: v.currency,
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
