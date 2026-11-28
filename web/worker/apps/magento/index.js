// @ts-check
import { fetchJson, isoDate, num } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/**
 * @typedef {{ sku: string, title: string, priceExVat: number, currency: string, stockItem: boolean }} StoreProduct
 * @typedef {{ id: string, number: string, date: string, customerName: string, customerEmail: string, totalExVat: number, currency: string, status: string }} StoreOrder
 * @typedef {{ id: number, title: string, variants?: Array<{ sku?: string | null }> }} ReAIProduct
 * @typedef {{ id: number, name: string, email?: string | null, invoiceEmail?: string | null }} ReAICustomer
 */

const CFG = {
  "brand": "Magento / Adobe Commerce",
  "title": "Magento / Adobe Commerce Sync",
  "lead": "Create missing products in ReAI by SKU and stage processing and complete Magento 2 or Adobe Commerce orders as ReAI orders.",
  "hint": "Create an integration under System \u2192 Extensions \u2192 Integrations with read access to Catalog and Sales, activate it and copy the Access Token. On Magento 2.4.4 or later, set Stores \u2192 Configuration \u2192 Services \u2192 OAuth \u2192 Consumer Settings \u2192 Allow OAuth Access Tokens to be used as standalone Bearer tokens to Yes.",
  "fields": [
    {
      "key": "storeUrl",
      "label": "Magento base URL",
      "placeholder": "https://shop.example.no"
    },
    {
      "key": "apiToken",
      "label": "Integration Bearer token",
      "secret": true,
      "placeholder": "Magento access token"
    }
  ]
};

/**
 * Validates that a user-supplied store base URL is public HTTPS (prevents SSRF).
 * @param {string} raw
 * @returns {string}
 */
function assertPublicHttpsBase(raw) {
  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new HttpError(400, 'Enter a valid https:// store URL.');
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:') {
    throw new HttpError(400, 'Store URL must use https://.');
  }
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2[0-9]|3[01])\.|\[::1\]|\[f[cd])/.test(host)
  ) {
    throw new HttpError(400, 'Store URL must point to a public hostname.');
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, '');
}

const PAGE_SIZE = 300;
const MAX_PAGES = 5;
const OSLO = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });

/**
 * Europe/Oslo calendar day of a Magento UTC timestamp ("YYYY-MM-DD HH:MM:SS").
 * @param {unknown} v
 * @param {string} fallback
 */
export function osloDay(v, fallback) {
  const s = String(v ?? '').trim();
  const t = Date.parse(`${s.replace(' ', 'T')}${/[zZ]|[+-][0-9]{2}:?[0-9]{2}$/.test(s) ? '' : 'Z'}`);
  if (Number.isNaN(t)) return isoDate(s, fallback);
  const parts = Object.fromEntries(OSLO.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * UTC timestamp ("YYYY-MM-DD HH:MM:SS") of midnight Europe/Oslo on the given day.
 * @param {string} day
 */
export function osloMidnightUtc(day) {
  const [y, m, d] = day.split('-').map(Number);
  for (const offsetHours of [1, 2]) {
    const t = Date.UTC(Number(y), Number(m) - 1, Number(d)) - offsetHours * 3_600_000;
    const parts = Object.fromEntries(OSLO.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    if (`${parts.year}-${parts.month}-${parts.day}` === day && parts.hour === '00') return new Date(t).toISOString().slice(0, 19).replace('T', ' ');
  }
  return `${day} 00:00:00`;
}

/**
 * Reads a searchCriteria listing page by page until total_count is reached.
 * @param {string} url Listing URL with searchCriteria and fields parameters, without paging.
 * @param {Record<string, string>} headers
 * @param {string} what
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 * @returns {Promise<any[]>}
 */
async function listAll(url, headers, what, fetchImpl) {
  /** @type {any[]} */
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await fetchJson(`${url}&searchCriteria[pageSize]=${PAGE_SIZE}&searchCriteria[currentPage]=${page}`, { headers }, 'Magento', fetchImpl);
    const batch = Array.isArray(body?.items) ? body.items : [];
    items.push(...batch);
    const total = Number(body?.total_count ?? 0);
    // Magento returns the last page again for a currentPage past the end, so stop on total_count.
    if (batch.length < PAGE_SIZE || items.length >= total) return items;
  }
  throw new HttpError(400, `The Magento store has more than ${PAGE_SIZE * MAX_PAGES} ${what}. Choose a later order date or contact us about a larger catalog.`);
}

/**
 * Fetches products and processing or complete orders from the Magento 2 / Adobe Commerce REST API.
 * Docs: https://developer.adobe.com/commerce/webapi/rest/use-rest/performing-searches/ (searchCriteria filter_groups,
 * condition_type in/gteq, sortOrders, pageSize, currentPage),
 * https://developer.adobe.com/commerce/webapi/rest/use-rest/retrieve-filtered-responses/ (fields=items[...]),
 * https://developer.adobe.com/commerce/webapi/get-started/api-security (maximum page size 300 when input limits are on),
 * https://developer.adobe.com/commerce/webapi/rest/quick-reference/ (GET /rest/V1/products catalogProductRepositoryV1,
 * GET /rest/V1/orders salesOrderRepositoryV1) and
 * https://developer.adobe.com/commerce/webapi/get-started/authentication/gs-authentication-token/ (integration access
 * token sent as Bearer; since 2.4.4 this needs Stores > Configuration > Services > OAuth > Consumer Settings >
 * Allow OAuth Access Tokens to be used as standalone Bearer tokens = Yes).
 * @param {Record<string, string>} fields
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<{ products: StoreProduct[], orders: StoreOrder[], storeLabel: string }>}
 */
export async function fetchApi(fields, fetchImpl = fetch) {
  const base = assertPublicHttpsBase(fields.storeUrl ?? '');
  const token = (fields.apiToken ?? '').trim();
  if (!token) throw new HttpError(400, 'Enter the Magento integration access token.');
  const from = isoDate(fields.fromDate, `${new Date().toISOString().slice(0, 7)}-01`);
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const productQuery = new URLSearchParams({
    'searchCriteria[sortOrders][0][field]': 'entity_id',
    'searchCriteria[sortOrders][0][direction]': 'ASC',
    fields: 'items[sku,name,price,type_id],total_count',
  });
  const orderQuery = new URLSearchParams({
    'searchCriteria[filter_groups][0][filters][0][field]': 'state',
    'searchCriteria[filter_groups][0][filters][0][value]': 'processing,complete',
    'searchCriteria[filter_groups][0][filters][0][condition_type]': 'in',
    'searchCriteria[filter_groups][1][filters][0][field]': 'created_at',
    'searchCriteria[filter_groups][1][filters][0][value]': osloMidnightUtc(from),
    'searchCriteria[filter_groups][1][filters][0][condition_type]': 'gteq',
    'searchCriteria[sortOrders][0][field]': 'created_at',
    'searchCriteria[sortOrders][0][direction]': 'DESC',
    fields: 'items[entity_id,increment_id,created_at,customer_firstname,customer_lastname,customer_email,billing_address[firstname,lastname,company],grand_total,tax_amount,total_refunded,order_currency_code,status,state],total_count',
  });
  const [pItems, oItems] = await Promise.all([
    listAll(`${base}/rest/V1/products?${productQuery}`, headers, 'products', fetchImpl),
    listAll(`${base}/rest/V1/orders?${orderQuery}`, headers, 'orders', fetchImpl),
  ]);
  return {
    products: pItems.map((/** @type {any} */ p) => ({
      sku: String(p.sku ?? '').trim(),
      title: String(p.name ?? p.sku ?? 'Product').trim(),
      priceExVat: Number(num(p.price).toFixed(2)),
      currency: 'NOK',
      stockItem: p.type_id !== 'virtual' && p.type_id !== 'downloadable',
    })).filter((/** @type {StoreProduct} */ p) => p.sku),
    orders: oItems.map((/** @type {any} */ o) => ({
      id: String(o.entity_id ?? o.increment_id),
      number: String(o.increment_id ?? o.entity_id),
      date: osloDay(o.created_at, from),
      customerName: (String(o.billing_address?.company ?? '').trim() || `${o.customer_firstname ?? o.billing_address?.firstname ?? ''} ${o.customer_lastname ?? o.billing_address?.lastname ?? ''}`.trim()) || 'Magento customer',
      customerEmail: String(o.customer_email ?? '').trim().toLowerCase(),
      totalExVat: (Math.round(num(o.grand_total) * 100) - Math.round(num(o.tax_amount) * 100)) / 100,
      currency: String(o.order_currency_code ?? 'NOK').toUpperCase(),
      status: Math.round(num(o.total_refunded) * 100) > 0 ? 'refunded' : String(o.status ?? o.state ?? ''),
    })).filter((/** @type {StoreOrder} */ o) => o.totalExVat > 0),
    storeLabel: new URL(base).hostname,
  };
}

/** @param {{ products: Array<{ p: StoreProduct, exists: boolean }>, orders: Array<{ o: StoreOrder, customerId: number | null }>, storeLabel: string, isSample?: boolean }} state */
function renderStoreSync(state) {
  const newProds = state.products.filter((x) => !x.exists).length;
  return html`
    <div class="metric-grid">
      ${reaiMetric({ label: 'Store products', value: String(state.products.length), detail: `${newProds} new SKUs` })}
      ${reaiMetric({ label: 'Processing and complete orders', value: String(state.orders.length), detail: state.storeLabel })}
      ${reaiMetric({ label: 'Duplicate check', value: 'SKU and order', detail: 'Existing SKUs and orders are skipped' })}
    </div>
    ${reaiCard({
      eyebrow: `${CFG.brand.toUpperCase()} CATALOG → REAI PRODUCTS`,
      title: 'Products',
      badge: reaiBadge({ text: `${newProds} new`, tone: newProds > 0 ? 'accent' : 'success' }),
      body: html`<div class="table-wrap"><table class="data-table">
        <thead><tr><th>SKU</th><th>Product</th><th class="num">Magento price</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>${state.products.slice(0, 80).map(({ p, exists }, idx) => html`<tr id="ec-p-${idx}">
          <td class="mono">${p.sku || '—'}</td><td><strong>${p.title}</strong></td><td class="num">${formatMinor(Math.round(p.priceExVat * 100))} ${p.currency}</td>
          <td>${exists ? reaiBadge({ text: 'In ReAI', tone: 'neutral' }) : reaiBadge({ text: 'New SKU', tone: 'success' })}</td>
          <td>${exists || state.isSample
            ? html`<span class="muted-note">${state.isSample && !exists ? 'Demo only' : 'Synced'}</span>`
            : html`<form hx-post="/app/magento/sync-product" hx-target="#ec-p-${idx}" hx-swap="outerHTML">
                <input type="hidden" name="sku" value="${p.sku}"><input type="hidden" name="title" value="${p.title}"><input type="hidden" name="price" value="${p.priceExVat.toFixed(2)}"><input type="hidden" name="stockItem" value="${p.stockItem ? '1' : '0'}">
                <button type="submit" class="button primary">Create in ReAI</button>
              </form>`}</td>
        </tr>`)}</tbody>
      </table></div>`,
    })}
    ${reaiCard({
      eyebrow: `${CFG.brand.toUpperCase()} ORDERS → REAI DRAFT ORDERS`,
      title: 'Orders',
      body: html`<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th class="num">Total ex. VAT</th><th>Action</th></tr></thead>
        <tbody>${state.orders.slice(0, 80).map(({ o, customerId }, idx) => html`<tr id="ec-o-${idx}">
          <td class="mono">${o.number}</td><td class="mono">${o.date}</td><td><strong>${o.customerName}</strong></td><td class="num">${formatMinor(Math.round(o.totalExVat * 100))} ${o.currency}</td>
          <td>${state.isSample || !customerId || o.status === 'refunded'
            ? html`<span class="muted-note">${state.isSample ? 'Demo only' : o.status === 'refunded' ? 'Refunded in Magento, stage it manually' : 'No matching ReAI customer'}</span>`
            : html`<form hx-post="/app/magento/sync-order" hx-target="#ec-o-${idx}" hx-swap="outerHTML">
                <input type="hidden" name="orderId" value="${o.id}"><input type="hidden" name="number" value="${o.number}"><input type="hidden" name="date" value="${o.date}"><input type="hidden" name="total" value="${o.totalExVat.toFixed(2)}"><input type="hidden" name="currency" value="${o.currency}"><input type="hidden" name="customerId" value="${customerId}">
                <button type="submit" class="button primary">Stage order</button>
              </form>`}</td>
        </tr>`)}</tbody>
      </table></div>`,
    })}
  `;
}

/**
 * Handles /app/magento/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/magento';
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  }
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">ECOMMERCE · PRODUCT & SALES SYNC</p><h1>${CFG.title}</h1><p class="lead">${CFG.lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-magento-web', clientName: `ReAI ${CFG.brand} Sync (Web)` })}
        ${reaiCard({
          eyebrow: `CONNECT ${CFG.brand.toUpperCase()}`,
          title: `Scan ${CFG.brand} products & orders`,
          body: html`
            <p class="muted-note">${CFG.hint} Credentials are used only for this single HTTPS scan and never stored.</p>
            <form class="stack" hx-post="${basePath}/scan" hx-target="#ec-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                ${CFG.fields.map((f) => html`<div class="field"><label for="ec-${f.key}">${f.label}</label><input id="ec-${f.key}" name="${f.key}" type="${f.secret ? 'password' : 'text'}"${f.secret ? html` autocomplete="off"` : ''} required placeholder="${f.placeholder}"></div>`)}
                <div class="field"><label for="ec-from">Orders from</label><input id="ec-from" name="fromDate" type="date" value="${new Date().toISOString().slice(0, 7)}-01" required></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Scan ${CFG.brand}</button>
                <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#ec-output" hx-swap="innerHTML">Load sample store</button>
              </div>
            </form>
          `,
        })}
        <div id="ec-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: CFG.title, description: CFG.lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${basePath}/sample`) {
    return htmlResponse(renderStoreSync({
      isSample: true,
      storeLabel: `${CFG.brand} demo`,
      products: [
        { p: { sku: 'SKU-101', title: 'Nordic Wool Sweater', priceExVat: 959.2, currency: 'NOK', stockItem: true }, exists: true },
        { p: { sku: 'SKU-102', title: 'Fjord Insulated Bottle', priceExVat: 399.2, currency: 'NOK', stockItem: true }, exists: false },
      ],
      orders: [{ o: { id: '5001', number: '#5001', date: '2026-10-20', customerName: 'Nordic Retail AS', customerEmail: 'order@example.no', totalExVat: 1358.4, currency: 'NOK', status: 'paid' }, customerId: 1 }],
    }));
  }

  try {
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    const form = await request.formData();

    if (pathname === `${basePath}/scan`) {
      /** @type {Record<string, string>} */
      const fields = {};
      for (const f of CFG.fields) fields[f.key] = String(form.get(f.key) ?? '').trim();
      fields.fromDate = String(form.get('fromDate') ?? '').trim();
      const [store, pRaw, cRaw] = await Promise.all([
        fetchApi(fields),
        reaiAll(env, '/api/products', { token: session.accessToken, tenantId: session.tenantId }),
        reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId }),
      ]);
      const skus = new Set();
      for (const p of /** @type {ReAIProduct[]} */ (pRaw)) {
        for (const v of p.variants ?? []) if (v.sku) skus.add(v.sku.trim().toLowerCase());
      }
      const custs = /** @type {ReAICustomer[]} */ (cRaw);
      return htmlResponse(renderStoreSync({
        storeLabel: store.storeLabel,
        products: store.products.map((p) => ({ p, exists: Boolean(p.sku && skus.has(p.sku.trim().toLowerCase())) })),
        orders: store.orders.map((o) => ({
          o,
          customerId: custs.find((c) => (o.customerEmail && [c.email, c.invoiceEmail].some((e) => (e ?? '').trim().toLowerCase() === o.customerEmail)) || (c.name ?? '').trim().toLowerCase() === o.customerName.trim().toLowerCase())?.id ?? null,
        })),
      }));
    }

    if (pathname === `${basePath}/sync-product`) {
      const sku = String(form.get('sku') ?? '').trim();
      const title = String(form.get('title') ?? '').trim();
      const price = Number(form.get('price') ?? '0');
      if (!sku || !title || !Number.isFinite(price)) throw new HttpError(400, 'Product needs a SKU, a title and a price.');
      const found = /** @type {{ items?: ReAIProduct[] }} */ (await reaiRequest(env, '/api/products', { token: session.accessToken, tenantId: session.tenantId, query: { query: sku, pageSize: '50' } }));
      const same = (found.items ?? []).find((x) => (x.variants ?? []).some((v) => (v.sku ?? '').trim().toLowerCase() === sku.toLowerCase()));
      if (same) return htmlResponse(html`<tr><td class="mono">${sku}</td><td><strong>${title}</strong></td><td class="num">${formatMinor(Math.round(price * 100))}</td><td>${reaiBadge({ text: `In ReAI #${same.id}`, tone: 'neutral' })}</td><td><span class="muted-note">Synced</span></td></tr>`);
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/products', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { title, stockItem: form.get('stockItem') !== '0', variants: [{ sku, sellingPrice: Math.max(0, Number(price.toFixed(2))) }] } }));
      return htmlResponse(html`<tr><td class="mono">${sku}</td><td><strong>${title}</strong></td><td class="num">${formatMinor(Math.round(price * 100))}</td><td>${reaiBadge({ text: `Created #${created.id}`, tone: 'success' })}</td><td><span class="muted-note">Synced</span></td></tr>`);
    }

    if (pathname === `${basePath}/sync-order`) {
      const orderId = String(form.get('orderId') ?? '').trim();
      const number = String(form.get('number') ?? orderId).trim();
      const date = String(form.get('date') ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
      const total = Number(form.get('total') ?? '0');
      const customerId = Number(form.get('customerId') ?? '0');
      const currencyCode = /^[A-Z]{3}$/.test(String(form.get('currency') ?? '')) ? String(form.get('currency')) : 'NOK';
      if (!orderId || total <= 0 || customerId <= 0) throw new HttpError(400, 'Valid order, total and customer required.');
      const externalReference = `magento-${orderId}`.slice(0, 100);
      const existing = /** @type {{ items: Array<{ id: number }> }} */ (await reaiRequest(env, '/api/orders', { token: session.accessToken, tenantId: session.tenantId, query: { externalReference, status: 'all' } }));
      const dup = existing.items?.[0];
      if (dup) return htmlResponse(html`<tr><td class="mono">${number}</td><td class="mono">${date}</td><td>Customer #${customerId}</td><td class="num">${formatMinor(Math.round(total * 100))}</td><td><a href="${reaiOrigin(env)}/order/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Already staged ↗</a></td></tr>`);
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/orders', {
        token: session.accessToken,
        tenantId: session.tenantId,
        method: 'POST',
        body: { customerId, currencyCode, daysUntilDue: 14, issueDate: date, orderDate: date, externalReference, comment: `${CFG.brand} order ${number}`, orderLines: [{ itemName: `${CFG.brand} order ${number}`, quantity: 1, unitPrice: Number(total.toFixed(2)) }] },
      }));
      const url = `${reaiOrigin(env)}/order/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(html`<tr><td class="mono">${number}</td><td class="mono">${date}</td><td>Customer #${customerId}</td><td class="num">${formatMinor(Math.round(total * 100))}</td><td><a href="${url}" target="_blank" rel="noopener">Order #${created.id} ↗</a></td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${CFG.brand} error`, body: err instanceof Error ? err.message : 'Store sync failed.' }));
  }
  return errorResponse('Unknown store route.', 404);
}
