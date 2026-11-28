// @ts-check
import { fetchJson, isoDate, num, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/**
 * @typedef {{ name: string, quantity: number, unitPrice: number, ratePct: number | null }} OrderLine
 * @typedef {{ id: string, number: string, date: string, currency: string, customerName: string, customerEmail: string, company: boolean, lines: OrderLine[] }} ShopOrder
 * @typedef {{ code: string, rate: number, vatType: string }} VatCode
 */

const SLUG = 'wix';
const BRAND = 'Wix';
const BASE_PATH = '/app/wix';
const TITLE = 'Wix eCommerce Orders to ReAI';
const EYEBROW = 'ECOMMERCE · ORDERS';
const LEAD = 'Stage paid Wix orders as ReAI orders with one line per item, shipping and the VAT rate Wix charged.';
const API_HINT = 'Create an API key in the Wix API Keys Manager with the Wix eCommerce read orders permission, and copy the site ID from the dashboard URL of the site.';
/** @type {import('../../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [
  { name: 'siteId', label: 'Site ID', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
  { name: 'apiKey', label: 'API key', type: 'password', placeholder: 'IST.eyJ...' },
  { name: 'from', label: 'Paid orders from', type: 'date', defaultValue: '$MONTH_START' },
  { name: 'to', label: 'To', type: 'date', defaultValue: '$TODAY' },
];
const API = 'https://www.wixapis.com/ecom/v1/orders/search';

/** @type {ShopOrder[]} */
const SAMPLE = [
  {
    id: 'sample-10004', number: '10004', date: '2026-10-20', currency: 'NOK', customerName: 'Kari Nordmann', customerEmail: 'post+wix-sample@aiak.no', company: false,
    lines: [
      { name: 'Ullgenser', quantity: 1, unitPrice: 959.2, ratePct: 25 },
      { name: 'Kokebok', quantity: 2, unitPrice: 199, ratePct: 0 },
      { name: 'Shipping', quantity: 1, unitPrice: 79.2, ratePct: 25 },
    ],
  },
];

/** @param {unknown} rate Wix decimal string such as "0.25" */
function ratePct(rate) {
  if (rate === undefined || rate === null || rate === '') return null;
  return Math.round(num(rate) * 10000) / 100;
}

/**
 * Splits an ex VAT line total into quantity and a unit price with two decimals.
 * @param {string} name @param {number} quantity @param {number} total @param {number | null} pct
 * @returns {OrderLine}
 */
function line(name, quantity, total, pct) {
  const q = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
  const unit = Math.round((total * 100) / q) / 100;
  if (Math.round(unit * q * 100) === Math.round(total * 100)) return { name, quantity: q, unitPrice: unit, ratePct: pct };
  return { name: `${quantity} x ${name}`, quantity: 1, unitPrice: Math.round(total * 100) / 100, ratePct: pct };
}

/**
 * Fetches paid Wix eCommerce orders created in a date range.
 * Docs: https://dev.wix.com/docs/api-reference/articles/authentication/api-keys/make-api-calls-with-an-api-key (Authorization: API key, wix-site-id header)
 * and https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/search-orders
 * (POST /ecom/v1/orders/search, filter createdDate $gte/$lt and paymentStatus, cursorPaging limit 100, metadata.cursors.next;
 * lineItems[].totalPriceBeforeTax, lineItems[].taxInfo.taxRate, shippingInfo.cost.totalPriceBeforeTax).
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<ShopOrder[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const siteId = (creds.siteId ?? '').trim();
  const apiKey = (creds.apiKey ?? '').trim();
  if (!siteId || !apiKey) throw new HttpError(400, 'Enter the Wix site ID and API key.');
  const from = isoDate(creds.from);
  const to = isoDate(creds.to);
  const end = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString();
  const headers = { authorization: apiKey, 'wix-site-id': siteId, 'content-type': 'application/json', accept: 'application/json' };
  /** @type {ShopOrder[]} */
  const orders = [];
  /** @type {string | undefined} */
  let cursor;
  for (let page = 0; page < 10; page++) {
    const search = cursor
      ? { cursorPaging: { limit: 100, cursor } }
      : { filter: { paymentStatus: { $eq: 'PAID' }, createdDate: { $gte: `${from}T00:00:00Z`, $lt: end } }, cursorPaging: { limit: 100 } };
    const data = await fetchJson(API, { method: 'POST', headers, body: JSON.stringify({ search }) }, BRAND, fetchImpl);
    for (const o of /** @type {any[]} */ (Array.isArray(data?.orders) ? data.orders : [])) {
      /** @type {OrderLine[]} */
      const lines = (Array.isArray(o.lineItems) ? o.lineItems : []).map((/** @type {any} */ li) =>
        line(String(li.productName?.original ?? 'Item').slice(0, 200), num(li.quantity), num(li.totalPriceBeforeTax?.amount), ratePct(li.taxInfo?.taxRate)));
      const ship = num(o.shippingInfo?.cost?.totalPriceBeforeTax?.amount);
      if (ship !== 0) lines.push(line('Shipping', 1, ship, ratePct(o.shippingInfo?.cost?.taxInfo?.taxRate)));
      const contact = o.billingInfo?.contactDetails ?? {};
      const company = String(contact.company ?? '').trim();
      orders.push({
        id: String(o.id ?? ''),
        number: String(o.number ?? o.id ?? ''),
        date: isoDate(o.createdDate),
        currency: String(o.currency ?? 'NOK').toUpperCase(),
        customerName: company || `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || String(o.buyerInfo?.email ?? 'Wix customer'),
        customerEmail: String(o.buyerInfo?.email ?? ''),
        company: Boolean(company),
        lines: lines.filter((l) => l.unitPrice !== 0),
      });
    }
    const next = data?.metadata?.cursors?.next;
    if (!data?.metadata?.hasNext || typeof next !== 'string' || !next) break;
    cursor = next;
  }
  return orders.filter((o) => o.id && o.lines.length > 0);
}

/** @param {ShopOrder} o */
function orderTotal(o) {
  return o.lines.reduce((t, l) => t + Math.round(l.unitPrice * 100) * l.quantity, 0);
}

/** @param {ShopOrder[]} orders @param {boolean} isSample */
function renderOrders(orders, isSample) {
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} PAID ORDERS → REAI ORDERS`,
    title: `${orders.length} paid orders`,
    badge: isSample ? reaiBadge({ text: 'Sample', tone: 'accent' }) : reaiBadge({ text: 'Live from Wix', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Orders', value: String(orders.length) })}
        ${reaiMetric({ label: 'Total excl. VAT', value: formatMinor(orders.reduce((t, o) => t + orderTotal(o), 0)) })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Lines</th><th class="num">Excl. VAT</th><th>Action</th></tr></thead>
        <tbody>${orders.slice(0, 200).map((o, idx) => html`<tr id="${SLUG}-o-${idx}">
          <td class="mono">${o.number}</td><td class="mono">${o.date}</td><td>${o.customerName}</td>
          <td>${o.lines.map((l) => html`<div>${l.quantity} x ${l.name} (${l.ratePct === null ? 'default VAT' : `${l.ratePct}% VAT`})</div>`)}</td>
          <td class="num">${formatMinor(orderTotal(o))} ${o.currency}</td>
          <td>${isSample
            ? html`<span class="muted-note">Sample only</span>`
            : html`<form hx-post="${BASE_PATH}/stage" hx-target="#${SLUG}-o-${idx}" hx-swap="outerHTML">
                <input type="hidden" name="orderJson" value="${JSON.stringify(o)}">
                <button type="submit" class="button primary">Stage in ReAI</button>
              </form>`}</td>
        </tr>`)}</tbody>
      </table></div>
      <p class="muted-note">Each order becomes a ReAI order for review before invoicing. The customer is matched by email or name, or created as a new customer. Orders already staged are skipped by their Wix order id.</p>
    `,
  });
}

/**
 * Maps a VAT percentage to a ReAI customer invoice VAT code.
 * @param {VatCode[]} codes @param {number | null} pct
 */
function vatCodeFor(codes, pct) {
  if (pct === null) return undefined;
  const same = codes.filter((c) => Math.abs(c.rate - pct) < 0.001);
  const match = same.find((c) => c.vatType === 'output_vat') ?? (pct === 0 ? (same.find((c) => c.vatType === 'exempt') ?? same.find((c) => c.vatType === 'outside_scope')) : undefined);
  if (!match) throw new HttpError(400, `ReAI has no invoice VAT code for ${pct}% in this company.`);
  return match.code;
}

/**
 * Finds the ReAI customer by email or name, or creates one.
 * @param {import('../../lib/types.d.ts').Env} env @param {{ token: string, tenantId: number }} auth @param {ShopOrder} o
 */
async function customerFor(env, auth, o) {
  /** @param {Record<string, string>} query */
  const find = async (query) => /** @type {{ items: Array<{ id: number, archived: boolean }> }} */ (await reaiRequest(env, '/api/customers', { ...auth, query: { ...query, pageSize: '5' } })).items.find((c) => !c.archived)?.id;
  const hit = (o.customerEmail ? await find({ email: o.customerEmail }) : undefined) ?? (await find({ name: o.customerName }));
  if (hit) return hit;
  const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/customers', { ...auth, method: 'POST', body: { name: o.customerName.slice(0, 200), email: o.customerEmail || null, privateContact: !o.company } }));
  return created.id;
}

/**
 * Handles /app/wix/* routes.
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
  if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderOrders(SAMPLE, true));
  try {
    const form = await request.formData();
    if (pathname === `${BASE_PATH}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderOrders(await fetchApi(creds), false));
    }
    if (pathname === `${BASE_PATH}/stage`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const o = /** @type {ShopOrder} */ (JSON.parse(String(form.get('orderJson') ?? '{}')));
      if (!o.id || !Array.isArray(o.lines) || o.lines.length === 0 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(o.date)) || !/^[A-Z]{3}$/.test(String(o.currency))) throw new HttpError(400, 'The order is incomplete.');
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const externalReference = `wix-${o.id}`.slice(0, 100);
      const existing = /** @type {{ items: Array<{ id: number, number: string }> }} */ (await reaiRequest(env, '/api/orders', { ...auth, query: { externalReference } }));
      const dup = existing.items[0];
      const cells = html`<td class="mono">${o.number}</td><td class="mono">${o.date}</td><td>${o.customerName}</td><td></td><td class="num">${formatMinor(orderTotal(o))} ${o.currency}</td>`;
      if (dup) return htmlResponse(html`<tr>${cells}<td><a href="${reaiOrigin(env)}/order/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Already staged (${dup.number}) ↗</a></td></tr>`);
      const codes = /** @type {VatCode[]} */ (await reaiRequest(env, '/api/vat-codes', { ...auth, query: { usage: 'customer_invoice' } }));
      const customerId = await customerFor(env, auth, o);
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/orders', {
        ...auth,
        method: 'POST',
        body: {
          customerId, currencyCode: o.currency, daysUntilDue: 14, issueDate: o.date, orderDate: o.date, externalReference,
          comment: `${BRAND} order ${o.number}`.slice(0, 200),
          orderLines: o.lines.map((l) => {
            const vatCode = vatCodeFor(codes, l.ratePct);
            return { itemName: String(l.name).slice(0, 200), quantity: Number(l.quantity), unitPrice: Number(Number(l.unitPrice).toFixed(2)), ...(vatCode ? { vatCode } : {}) };
          }),
        },
      }));
      return htmlResponse(html`<tr>${cells}<td><a href="${reaiOrigin(env)}/order/${created.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Order ${created.number} ↗</a></td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
