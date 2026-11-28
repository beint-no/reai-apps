// @ts-check
import { assertPublicHttpsUrl, fetchJson, isoDate, num, renderApiFetchCard } from '../../lib/api-http.js';
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

const SLUG = 'shopware';
const BRAND = 'Shopware';
const BASE_PATH = '/app/shopware';
const TITLE = 'Shopware 6 Orders to ReAI';
const EYEBROW = 'ECOMMERCE · ORDERS';
const LEAD = 'Stage paid Shopware 6 orders as ReAI orders with one line per item, shipping and the tax rate Shopware calculated.';
const API_HINT = 'In the Shopware Administration open Settings → System → Integrations, create an integration with read access to orders, and copy the access key ID and secret access key.';
/** @type {import('../../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [
  { name: 'storeUrl', label: 'Shop URL', type: 'url', placeholder: 'https://shop.example.no' },
  { name: 'clientId', label: 'Access key ID', placeholder: 'SWIA...' },
  { name: 'clientSecret', label: 'Secret access key', type: 'password' },
  { name: 'from', label: 'Paid orders from', type: 'date', defaultValue: '$MONTH_START' },
  { name: 'to', label: 'To', type: 'date', defaultValue: '$TODAY' },
];

/** @type {ShopOrder[]} */
const SAMPLE = [
  {
    id: 'sample-10021', number: '10021', date: '2026-10-20', currency: 'NOK', customerName: 'Kari Nordmann', customerEmail: 'post+shopware-sample@aiak.no', company: false,
    lines: [
      { name: 'Ullgenser', quantity: 1, unitPrice: 959.2, ratePct: 25 },
      { name: 'Kokebok', quantity: 2, unitPrice: 199, ratePct: 0 },
      { name: 'Shipping', quantity: 1, unitPrice: 79.2, ratePct: 25 },
    ],
  },
];

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
 * Converts a Shopware CalculatedPrice to an ex VAT total and a single tax rate.
 * @param {any} price CalculatedPrice { totalPrice, calculatedTaxes: [{ tax, taxRate, price }] }
 * @param {string} taxStatus order.taxStatus: gross, net or tax-free
 */
function exVat(price, taxStatus) {
  const raw = price?.calculatedTaxes;
  /** @type {any[]} */ const taxes = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.values(raw) : [];
  const total = num(price?.totalPrice);
  const tax = taxes.reduce((t, x) => t + num(x?.tax), 0);
  const rates = [...new Set(taxes.map((x) => num(x?.taxRate)))];
  return {
    total: taxStatus === 'gross' ? Math.round((total - tax) * 100) / 100 : total,
    pct: taxStatus === 'tax-free' ? 0 : rates.length === 1 ? /** @type {number} */ (rates[0]) : null,
  };
}

/**
 * Fetches paid Shopware 6 orders in a date range through the Admin API.
 * Docs: https://developer.shopware.com/docs/guides/development/integrations-api/ (integration under Settings → System →
 * Integrations, POST /api/oauth/token with grant_type client_credentials), https://developer.shopware.com/docs/guides/development/integrations-api/search-criteria.html
 * (POST /api/search/order with filter, associations and the transactions.stateMachineState.technicalName "paid" filter) and
 * the order, order_line_item and CalculatedPrice definitions in https://github.com/shopware/shopware/tree/trunk/src/Core/Checkout/Order.
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<ShopOrder[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const parsed = assertPublicHttpsUrl(creds.storeUrl ?? '');
  const base = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '').replace(/\/api$/, '')}`;
  const clientId = (creds.clientId ?? '').trim();
  const clientSecret = (creds.clientSecret ?? '').trim();
  if (!clientId || !clientSecret) throw new HttpError(400, 'Enter the Shopware access key ID and secret access key.');
  const from = isoDate(creds.from);
  const to = isoDate(creds.to);
  const tok = await fetchJson(`${base}/api/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
  }, BRAND, fetchImpl);
  if (typeof tok?.access_token !== 'string') throw new HttpError(400, 'Shopware did not return an access token.');
  const headers = { authorization: `Bearer ${tok.access_token}`, 'content-type': 'application/json', accept: 'application/json' };
  /** @type {ShopOrder[]} */
  const orders = [];
  for (let page = 1; page <= 10; page++) {
    const criteria = {
      page,
      limit: 100,
      associations: { lineItems: {}, currency: {}, orderCustomer: {}, transactions: { associations: { stateMachineState: {} } } },
      filter: [
        { type: 'range', field: 'orderDate', parameters: { gte: from, lte: to } },
        { type: 'equals', field: 'transactions.stateMachineState.technicalName', value: 'paid' },
      ],
      sort: [{ field: 'orderDateTime', order: 'ASC' }],
    };
    const data = await fetchJson(`${base}/api/search/order`, { method: 'POST', headers, body: JSON.stringify(criteria) }, BRAND, fetchImpl);
    /** @type {any[]} */ const rows = Array.isArray(data?.data) ? data.data : [];
    for (const o of rows) {
      const taxStatus = String(o.taxStatus ?? 'gross');
      /** @type {OrderLine[]} */ const lines = [];
      for (const li of /** @type {any[]} */ (Array.isArray(o.lineItems) ? o.lineItems : [])) {
        if (li.parentId) continue;
        const p = exVat(li.price ?? { totalPrice: li.totalPrice }, taxStatus);
        const sku = li.payload?.productNumber ? ` (${li.payload.productNumber})` : '';
        lines.push(line(`${String(li.label ?? 'Item')}${sku}`.slice(0, 200), num(li.quantity), p.total, p.pct));
      }
      const ship = exVat(o.shippingCosts, taxStatus);
      if (ship.total !== 0) lines.push(line('Shipping', 1, ship.total, ship.pct));
      const c = o.orderCustomer ?? {};
      const company = String(c.company ?? '').trim();
      orders.push({
        id: String(o.id ?? ''),
        number: String(o.orderNumber ?? o.id ?? ''),
        date: isoDate(o.orderDate ?? o.orderDateTime),
        currency: String(o.currency?.isoCode ?? 'NOK').toUpperCase(),
        customerName: company || `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || String(c.email ?? 'Shopware customer'),
        customerEmail: String(c.email ?? ''),
        company: Boolean(company),
        lines: lines.filter((l) => l.unitPrice !== 0),
      });
    }
    if (rows.length < 100) break;
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
    badge: isSample ? reaiBadge({ text: 'Sample', tone: 'accent' }) : reaiBadge({ text: 'Live from Shopware', tone: 'success' }),
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
      <p class="muted-note">Each order becomes a ReAI order for review before invoicing. The customer is matched by email or name, or created as a new customer. Orders already staged are skipped by their Shopware order id.</p>
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
 * Handles /app/shopware/* routes.
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
      const externalReference = `shopware-${o.id}`.slice(0, 100);
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
