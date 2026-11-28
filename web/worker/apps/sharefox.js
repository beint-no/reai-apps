// @ts-check
import { fetchJson, isoDate, num, pickList } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * @typedef {{ id: string, reference: string, bookingReference: string, date: string, status: string, paymentStatus: string, paymentMethod: string, grossMinor: number, netMinor: number, isChangeOrder: boolean }} SharefoxOrder
 * @typedef {{ rate: 25 | 15 | 12, grossMinor: number, netMinor: number, count: number }} VatBucket
 * @typedef {{ from: string, to: string, buckets: VatBucket[], included: number, excluded: Array<{ ref: string, reason: string, grossMinor: number }> }} RentalSummary
 * @typedef {{ code: string, rate: number, vatType: string, amountBasis: string, reverseCharge: boolean }} ReaiVatCode
 */

const BRAND = 'Sharefox';
const TITLE = 'Sharefox Rental Sales';
const LEAD = 'Summarise booked Sharefox rental orders for a period by VAT rate and create one balanced review voucher in ReAI against your payment clearing account.';
const BASE = '/app/sharefox';
const SHAREFOX_API = 'https://api.mysharefox.com/api-v2';
const RATES = /** @type {const} */ ([25, 15, 12]);
const STANDARD_OUTPUT_CODES = /** @type {Record<number, string>} */ ({ 25: '3', 15: '31', 12: '33' });

/** @param {string} raw */
function adminDomain(raw) {
  const host = raw.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(host)) {
    throw new HttpError(400, 'Enter your Sharefox admin domain, for example yourshop.admin.mysharefox.com.');
  }
  return host;
}

/**
 * Logs in as a Sharefox admin user and lists orders in a time range.
 * Docs:
 * - https://help.sharefox.no/article/426-sharefox-api (admin login returns a long lived Bearer token; only Booked and Closed orders are contracted)
 * - https://api.mysharefox.com/docs (server https://api.mysharefox.com/api-v2, POST /admin/login, GET /admin/orders/?start=&end=,
 *   x-sharefox-admin-domain header, order fields id, reference, bookingReference, bookTime, status, paymentStatus,
 *   paymentMethodName, price, totalPriceExclVat, isChangeOrder, isDeleted)
 * @param {Record<string, string>} creds `adminDomain`, `email`, `password`, `fromDate`, `toDate`
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<SharefoxOrder[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const domain = adminDomain(creds.adminDomain ?? '');
  const email = (creds.email ?? '').trim();
  const password = creds.password ?? '';
  if (!email || password.length < 8) throw new HttpError(400, 'Enter the email and password of a Sharefox admin user.');
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (from > to) throw new HttpError(400, 'The start date must be on or before the end date.');

  const login = await fetchJson(
    `${SHAREFOX_API}/admin/login`,
    { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'x-sharefox-admin-domain': domain, locale: 'en' }, body: JSON.stringify({ email, password }) },
    BRAND,
    fetchImpl,
  );
  const token = typeof login?.token === 'string' ? login.token : '';
  if (!token) throw new HttpError(400, 'Sharefox did not return an admin token. Check the admin domain and user.');

  const data = await fetchJson(
    `${SHAREFOX_API}/admin/orders/?start=${encodeURIComponent(from)}&end=${encodeURIComponent(to)}`,
    { headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'x-sharefox-admin-domain': domain, locale: 'en' } },
    BRAND,
    fetchImpl,
  );
  const list = Array.isArray(data) ? data : data && typeof data === 'object' && 'id' in data ? [data] : pickList(data, ['orders', 'items', 'data']);
  /** @type {SharefoxOrder[]} */
  const orders = [];
  for (const o of list) {
    if (!o || o.isDeleted === true) continue;
    orders.push({
      id: String(o.id ?? ''),
      reference: String(o.reference ?? o.id ?? ''),
      bookingReference: String(o.bookingReference ?? ''),
      date: isoDate(o.bookTime, to),
      status: String(o.status ?? ''),
      paymentStatus: String(o.paymentStatus ?? ''),
      paymentMethod: String(o.paymentMethodName ?? ''),
      grossMinor: Math.round(num(o.price) * 100),
      netMinor: Math.round(num(o.totalPriceExclVat) * 100),
      isChangeOrder: o.isChangeOrder === true,
    });
  }
  return orders;
}

/**
 * Groups contracted (Booked/Closed), non invoice orders by VAT rate.
 * @param {SharefoxOrder[]} orders
 * @param {string} from
 * @param {string} to
 * @returns {RentalSummary}
 */
export function summarise(orders, from, to) {
  /** @type {Map<number, VatBucket>} */
  const buckets = new Map();
  /** @type {RentalSummary['excluded']} */
  const excluded = [];
  let included = 0;
  for (const o of orders) {
    const ref = o.reference || o.id;
    if (!/^(booked|closed)$/i.test(o.status.trim())) { excluded.push({ ref, reason: `Status ${o.status || 'unknown'}`, grossMinor: o.grossMinor }); continue; }
    if (/faktura|invoice/i.test(o.paymentMethod)) { excluded.push({ ref, reason: 'Invoice order, book it with the invoice', grossMinor: o.grossMinor }); continue; }
    if (o.grossMinor === 0 && o.netMinor === 0) continue;
    const pct = o.netMinor !== 0 ? ((o.grossMinor - o.netMinor) / o.netMinor) * 100 : NaN;
    const rate = RATES.find((r) => Math.abs(r - pct) <= 0.6);
    if (!rate) { excluded.push({ ref, reason: Number.isFinite(pct) && Math.abs(pct) < 0.6 ? 'No VAT, book manually' : 'Mixed VAT rates, book manually', grossMinor: o.grossMinor }); continue; }
    const b = buckets.get(rate) ?? { rate, grossMinor: 0, netMinor: 0, count: 0 };
    b.grossMinor += o.grossMinor;
    b.netMinor += o.netMinor;
    b.count += 1;
    buckets.set(rate, b);
    included += 1;
  }
  return { from, to, buckets: RATES.flatMap((r) => { const b = buckets.get(r); return b && b.grossMinor !== 0 ? [b] : []; }), included, excluded };
}

/** @param {RentalSummary} s @param {boolean} isSample */
function renderSummary(s, isSample) {
  const gross = s.buckets.reduce((t, b) => t + b.grossMinor, 0);
  const net = s.buckets.reduce((t, b) => t + b.netMinor, 0);
  return reaiCard({
    eyebrow: 'SHAREFOX ORDERS → REAI REVIEW VOUCHER',
    title: `${s.from} to ${s.to}`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${s.included} orders`, tone: s.included > 0 ? 'success' : 'warn' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Rental sales incl. VAT', value: formatMinor(gross), detail: `${s.included} booked or closed orders` })}
        ${reaiMetric({ label: 'Sales excl. VAT', value: formatMinor(net), detail: `Output VAT ${formatMinor(gross - net)}` })}
        ${reaiMetric({ label: 'Excluded', value: String(s.excluded.length), detail: 'Listed below for manual handling' })}
      </div>
      ${s.buckets.length === 0
        ? reaiCallout({ tone: 'info', body: 'No booked or closed Sharefox orders with a single VAT rate in this period.' })
        : html`<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Row</th><th>Account</th><th>Posting</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
          <tbody>${s.buckets.map((b, i) => html`
            <tr><td class="mono">${i + 1}</td><td class="mono">Clearing</td><td>Sharefox payments, ${b.rate}% VAT sales (${b.count} orders)</td><td class="num">${b.grossMinor > 0 ? formatMinor(b.grossMinor) : ''}</td><td class="num">${b.grossMinor < 0 ? formatMinor(-b.grossMinor) : ''}</td></tr>
            <tr><td class="mono">${i + 1}</td><td class="mono">Revenue</td><td>Rental revenue ${b.rate}% VAT incl. (net ${formatMinor(b.netMinor)})</td><td class="num">${b.grossMinor < 0 ? formatMinor(-b.grossMinor) : ''}</td><td class="num">${b.grossMinor > 0 ? formatMinor(b.grossMinor) : ''}</td></tr>`)}
          </tbody>
        </table></div>`}
      ${s.excluded.length > 0
        ? html`<details><summary>${s.excluded.length} excluded orders</summary><div class="table-wrap"><table class="data-table">
            <thead><tr><th>Order</th><th>Reason</th><th class="num">Amount incl. VAT</th></tr></thead>
            <tbody>${s.excluded.slice(0, 200).map((x) => html`<tr><td class="mono">${x.ref}</td><td>${x.reason}</td><td class="num">${formatMinor(x.grossMinor)}</td></tr>`)}</tbody>
          </table></div></details>`
        : ''}
      ${!isSample && s.buckets.length > 0
        ? html`<form class="stack-sm confirm-box" hx-post="${BASE}/book" hx-target="#sf-book" hx-swap="innerHTML">
            <input type="hidden" name="summaryJson" value="${JSON.stringify(s)}">
            <div class="inline-row">
              <div class="field"><label for="sf-clearing">Payment clearing account</label><input id="sf-clearing" name="clearingAccount" type="text" pattern="[0-9]{4}" value="1580" required></div>
              <div class="field"><label for="sf-revenue">Rental revenue account</label><input id="sf-revenue" name="revenueAccount" type="text" pattern="[0-9]{4}" value="3000" required></div>
            </div>
            <label class="check-row"><input type="checkbox" name="c_sf" required> I checked these totals against the Sharefox report for the period and confirm these orders are not already booked in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="sf-book" class="stack-sm"></div>`
        : isSample ? reaiCallout({ tone: 'info', body: 'Synthetic Sharefox orders loaded. Connect to ReAI and fetch your own period to create a review voucher.' }) : ''}
    `,
  });
}

/**
 * @param {ReaiVatCode[]} codes
 * @param {number} pct
 * @returns {string}
 */
function outputVatCode(codes, pct) {
  const candidates = codes.filter((c) => c.vatType === 'output_vat' && !c.reverseCharge && c.amountBasis === 'vat_inclusive' && (Math.abs(c.rate - pct) < 0.01 || Math.abs(c.rate * 100 - pct) < 0.01));
  const preferred = candidates.find((c) => String(c.code) === STANDARD_OUTPUT_CODES[pct]) ?? candidates[0];
  if (!preferred) throw new HttpError(400, `ReAI has no VAT inclusive output VAT code for ${pct}%. Book this period manually.`);
  return String(preferred.code);
}

/**
 * Handles /app/sharefox/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE}/`, request.url), 301);
  if (pathname === `${BASE}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro"><p class="eyebrow">RENTAL & BOOKING</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-sharefox-web', clientName: 'ReAI Sharefox Rental Sales (Web)' })}
        ${reaiCard({
          eyebrow: 'SHAREFOX API',
          title: 'Fetch Sharefox orders',
          body: html`
            <p class="muted-note">Sign in with a Sharefox admin user. Sharefox asks customers to confirm with Sharefox Support that API use is part of their subscription. The password is used only to request a token for this fetch and is never stored.</p>
            <form class="stack" hx-post="${BASE}/fetch-api" hx-target="#sf-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="sf-domain">Admin domain</label><input id="sf-domain" name="adminDomain" type="text" autocomplete="off" required placeholder="yourshop.admin.mysharefox.com"></div>
                <div class="field"><label for="sf-email">Admin email</label><input id="sf-email" name="email" type="email" autocomplete="off" required></div>
                <div class="field"><label for="sf-password">Admin password</label><input id="sf-password" name="password" type="password" autocomplete="off" minlength="8" required></div>
                <div class="field"><label for="sf-from">From date</label><input id="sf-from" name="fromDate" type="date" value="${today.slice(0, 8)}01" required></div>
                <div class="field"><label for="sf-to">To date</label><input id="sf-to" name="toDate" type="date" value="${today}" required></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Fetch Sharefox orders</button>
                <button type="button" class="button secondary" hx-post="${BASE}/sample" hx-target="#sf-output" hx-swap="innerHTML">Load sample orders</button>
              </div>
            </form>
          `,
        })}
        <div id="sf-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${BASE}/sample`) {
    /** @type {SharefoxOrder[]} */
    const orders = [
      { id: '1', reference: 'SF-10421', bookingReference: 'B-10421', date: '2026-10-03', status: 'Booked', paymentStatus: 'Paid', paymentMethod: 'Nets', grossMinor: 125000, netMinor: 100000, isChangeOrder: false },
      { id: '2', reference: 'SF-10422', bookingReference: 'B-10422', date: '2026-10-04', status: 'Closed', paymentStatus: 'Paid', paymentMethod: 'Stripe', grossMinor: 312500, netMinor: 250000, isChangeOrder: false },
      { id: '3', reference: 'SF-10423', bookingReference: 'B-10421', date: '2026-10-05', status: 'Booked', paymentStatus: 'Paid', paymentMethod: 'Nets', grossMinor: 12500, netMinor: 10000, isChangeOrder: true },
      { id: '4', reference: 'SF-10424', bookingReference: 'B-10424', date: '2026-10-06', status: 'Booked', paymentStatus: 'Unpaid', paymentMethod: 'Faktura', grossMinor: 450000, netMinor: 360000, isChangeOrder: false },
      { id: '5', reference: 'SF-10425', bookingReference: 'B-10425', date: '2026-10-07', status: 'Cancelled', paymentStatus: 'Refunded', paymentMethod: 'Nets', grossMinor: 87500, netMinor: 70000, isChangeOrder: false },
    ];
    return htmlResponse(renderSummary(summarise(orders, '2026-10-01', '2026-10-31'), true));
  }

  try {
    const form = await request.formData();
    if (pathname === `${BASE}/fetch-api`) {
      /** @type {Record<string, string>} */
      const creds = {};
      for (const k of ['adminDomain', 'email', 'password', 'fromDate', 'toDate']) creds[k] = String(form.get(k) ?? '');
      const from = isoDate(creds.fromDate);
      const to = isoDate(creds.toDate);
      return htmlResponse(renderSummary(summarise(await fetchApi(creds), from, to), false));
    }

    if (pathname === `${BASE}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const company = session.tenants.find((t) => t.id === session.tenantId);
      if (!company) throw new HttpError(400, 'Select a valid ReAI company.');
      if (form.get('c_sf') !== 'on') throw new HttpError(400, 'Confirm the verification checkbox first.');
      const clearing = String(form.get('clearingAccount') ?? '').trim();
      const revenue = String(form.get('revenueAccount') ?? '').trim();
      if (!/^[0-9]{4}$/.test(clearing) || !/^[0-9]{4}$/.test(revenue)) throw new HttpError(400, 'Enter four digit account numbers.');
      const s = /** @type {RentalSummary} */ (JSON.parse(String(form.get('summaryJson') ?? '{}')));
      const from = isoDate(s.from);
      const to = isoDate(s.to);
      const buckets = (Array.isArray(s.buckets) ? s.buckets : []).filter((b) => RATES.includes(/** @type {25 | 15 | 12} */ (b.rate)) && Number.isInteger(b.grossMinor) && b.grossMinor !== 0);
      if (buckets.length === 0) throw new HttpError(400, 'Nothing to book.');

      const marker = `Sharefox rentals ${from} to ${to}`;
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (
        await reaiAll(env, '/api/vouchers', { token: session.accessToken, tenantId: session.tenantId, query: { startDate: to, endDate: to, includeReversed: 'true' } })
      );
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: `A voucher for ${from} to ${to} already exists. Nothing was created.` }));

      const codes = /** @type {ReaiVatCode[]} */ (await reaiRequest(env, '/api/vat-codes', { token: session.accessToken, tenantId: session.tenantId }));
      /** @type {Array<Record<string, unknown>>} */
      const postings = [];
      buckets.forEach((b, rowNumber) => {
        const amount = Number((b.grossMinor / 100).toFixed(2));
        const description = `Sharefox rental sales ${b.rate}% VAT ${from} to ${to}`;
        postings.push({ accountNumber: clearing, postingDate: to, currencyCode: company.currencyCode, amount, vatCode: '0', rowNumber, description });
        postings.push({ accountNumber: revenue, postingDate: to, currencyCode: company.currencyCode, amount: -amount, vatCode: outputVatCode(codes, b.rate), rowNumber, description });
      });
      const created = /** @type {{ id: number, number: string, webUrl: string }} */ (
        await reaiRequest(env, '/api/manual-vouchers', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { date: to, description: marker, reviewReason: 'Sharefox rental sales imported via apps.reai.no. Check against the Sharefox report.', postings } })
      );
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`<a href="${created.webUrl}" target="_blank" rel="noopener">Open voucher ${created.number} in ReAI</a>` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Sharefox import failed.' }));
  }
  return errorResponse('Unknown Sharefox route.', 404);
}
