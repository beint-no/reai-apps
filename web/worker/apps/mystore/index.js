// @ts-check
import { fetchJson, num } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/**
 * @typedef {{ sku: string, title: string, priceExVat: number }} StoreProduct
 * @typedef {{ name: string, quantity: number, unitPriceExVat: number, ratePct: number }} StoreLine
 * @typedef {{ id: string, date: string, status: string, credited: boolean, customerName: string, customerEmail: string, currency: string, lines: StoreLine[], netMinor: number, vatMinor: number, totalMinor: number | null }} StoreOrder
 * @typedef {{ id: number, variants?: Array<{ sku?: string | null }> }} ReAIProduct
 * @typedef {{ id: number, name: string | null, email?: string | null, invoiceEmail?: string | null }} ReAICustomer
 * @typedef {{ code: string, rate: number, vatType: string, reverseCharge: boolean }} ReAIVatCode
 */

const SLUG = 'mystore';
const BRAND = 'Mystore';
const BASE_PATH = '/app/mystore';
const TITLE = 'Mystore Product and Order Sync';
const LEAD = 'Create missing Mystore products in ReAI by SKU and stage Mystore orders from a chosen date as ReAI orders with one line per product and the VAT rate from Mystore.';
const API = 'https://api.mystore.no/shops';
const USER_AGENT = 'ReAI Apps (apps.reai.no)';
/** Order status names (shop configurable; defaults Kansellert and Returnert) that are never staged. */
const CANCELLED_STATUS = /kansell|cancel|annull|return|refus/i;

const PAGE_SIZE = 50;
const MAX_PRODUCT_PAGES = 8;
const MAX_ORDER_PAGES = 6;

/**
 * Last page number from a JSON:API `links.last` URL, or 0 when absent.
 * @param {any} links
 */
function lastPage(links) {
  try {
    return Number(new URL(String(links?.last ?? '')).searchParams.get('page[number]') ?? 0) || 0;
  } catch {
    return 0;
  }
}

/**
 * Reads one JSON:API listing page by page (page[size] max 50, 120 requests per minute per token).
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {number} maxPages
 * @param {string} what
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 */
async function listPages(url, headers, maxPages, what, fetchImpl) {
  /** @type {any[]} */ const data = [];
  /** @type {any[]} */ const included = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = url.includes('?') ? '&' : '?';
    const body = await fetchJson(`${url}${sep}page[number]=${page}&page[size]=${PAGE_SIZE}`, { headers }, BRAND, fetchImpl);
    const items = Array.isArray(body?.data) ? body.data : [];
    data.push(...items);
    if (Array.isArray(body?.included)) included.push(...body.included);
    const more = items.length === PAGE_SIZE && (Boolean(body?.links?.next) || lastPage(body?.links) > page);
    if (!more) return { data, included };
  }
  throw new HttpError(400, `${BRAND} has more than ${maxPages * PAGE_SIZE} ${what} for this request. Choose a later order date.`);
}

/** @param {unknown} v */
function minor(v) {
  return Math.round(num(v) * 100);
}

/**
 * Fetches products and the orders from a date with the Mystore API.
 * Docs: https://api-docs.mystore.no/ (OpenAPI at https://api-docs.mystore.no/mystore_api_docs.json):
 * GET /shops/{shop}/products?filter[sku]... (non-empty SKU) and
 * GET /shops/{shop}/orders?include=order-products,order-totals,order-status&filter[created_at]...between&sort=-created_at,
 * Bearer personal access token from https://auth.mystore.no/login with scopes products:read and orders:read,
 * Accept application/vnd.api+json, a User-Agent naming the integration, JSON:API pagination page[number] and
 * page[size] (max 50). Order product final_price is the net unit price and tax_rate its VAT rate; order totals of
 * type "line" (shipping, fees, discounts) carry value_without_tax and tax_rate; ot_total holds the order total incl. VAT.
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<{ products: StoreProduct[], orders: StoreOrder[], storeLabel: string }>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const shop = (creds.shopName ?? '').trim().toLowerCase();
  const token = (creds.apiToken ?? '').trim();
  if (!/^[a-z0-9._-]+$/.test(shop) || !token) throw new HttpError(400, 'Enter your Mystore store name and personal access token.');
  const today = new Date().toISOString().slice(0, 10);
  const from = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(creds.fromDate ?? '') ? String(creds.fromDate) : `${today.slice(0, 7)}-01`;
  const headers = { authorization: `Bearer ${token}`, accept: 'application/vnd.api+json', 'user-agent': USER_AGENT };
  const base = `${API}/${encodeURIComponent(shop)}`;
  const productQuery = new URLSearchParams({ 'filter[sku][path]': 'sku', 'filter[sku][value]': '(empty)', 'filter[sku][operator]': '<>', sort: 'sku' });
  const orderQuery = new URLSearchParams({
    include: 'order-products,order-totals,order-status',
    'filter[created_at][path]': 'created_at',
    'filter[created_at][value]': `${from} 00:00:00...${today} 23:59:59`,
    'filter[created_at][operator]': 'between',
    sort: '-created_at',
  });
  const [pRes, oRes] = await Promise.all([
    listPages(`${base}/products?${productQuery}`, headers, MAX_PRODUCT_PAGES, 'products with SKU', fetchImpl),
    listPages(`${base}/orders?${orderQuery}`, headers, MAX_ORDER_PAGES, 'orders', fetchImpl),
  ]);

  /** @type {StoreProduct[]} */
  const products = pRes.data.map((/** @type {any} */ item) => {
    const a = item?.attributes ?? {};
    const name = a.name && typeof a.name === 'object' ? (a.name.no ?? Object.values(a.name).find((x) => typeof x === 'string' && x.trim())) : a.name;
    return { sku: String(a.sku ?? '').trim(), title: String(name ?? `Product ${item?.id}`).trim(), priceExVat: num(a.price) };
  }).filter((p) => p.sku);

  /** @type {Map<string, string>} */ const statusNames = new Map();
  for (const inc of oRes.included) {
    if (inc?.type !== 'order-status') continue;
    const n = inc.attributes?.name;
    statusNames.set(String(inc.id), String((n && typeof n === 'object' ? (n.no ?? Object.values(n).find((x) => typeof x === 'string')) : n) ?? '').trim());
  }
  /** @type {Map<string, any[]>} */ const linesByOrder = new Map();
  /** @type {Map<string, any[]>} */ const totalsByOrder = new Map();
  for (const inc of oRes.included) {
    const orderId = String(inc?.relationships?.order?.data?.id ?? '');
    if (!orderId) continue;
    const target = inc.type === 'order-products' ? linesByOrder : inc.type === 'order-totals' ? totalsByOrder : null;
    if (!target) continue;
    target.set(orderId, [...(target.get(orderId) ?? []), inc]);
  }

  /** @type {StoreOrder[]} */
  const orders = oRes.data.map((/** @type {any} */ item) => {
    const id = String(item?.id ?? '');
    const a = item?.attributes ?? {};
    /** @type {StoreLine[]} */ const lines = [];
    for (const op of linesByOrder.get(id) ?? []) {
      const o = op.attributes ?? {};
      const quantity = num(o.quantity);
      if (quantity === 0) continue;
      lines.push({ name: `${String(o.name ?? 'Product').trim()}${o.sku ? ` (${String(o.sku).trim()})` : ''}`, quantity, unitPriceExVat: num(o.final_price), ratePct: num(o.tax_rate) });
    }
    let totalMinor = /** @type {number | null} */ (null);
    for (const t of totalsByOrder.get(id) ?? []) {
      const o = t.attributes ?? {};
      if (o.class === 'ot_total') totalMinor = minor(o.value);
      else if (o.order_total_type === 'line' && minor(o.value_without_tax) !== 0) {
        lines.push({ name: String(o.title ?? 'Order total line').replace(/:\s*$/, '').trim(), quantity: 1, unitPriceExVat: num(o.value_without_tax), ratePct: num(o.tax_rate) });
      }
    }
    const netMinor = lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPriceExVat * 100), 0);
    const vatMinor = lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPriceExVat * l.ratePct), 0);
    const statusName = statusNames.get(String(item?.relationships?.['order-status']?.data?.id ?? '')) ?? '';
    return {
      id,
      date: String(a.created_at ?? '').slice(0, 10),
      status: statusName,
      credited: Boolean(a.credit_note),
      customerName: String(a.customer_address_company || a.customer_address_name || a.billing_address_name || 'Webshop customer').trim(),
      customerEmail: String(a.customer_address_email || a.billing_address_email || '').trim().toLowerCase(),
      currency: String(a.currency ?? 'NOK').toUpperCase(),
      lines,
      netMinor,
      vatMinor,
      totalMinor,
    };
  }).filter((o) => o.id && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(o.date));
  return { products, orders, storeLabel: shop };
}

/** @param {StoreOrder} o */
function orderProblem(o) {
  if (o.credited) return 'Order has a credit note in Mystore.';
  if (CANCELLED_STATUS.test(o.status ?? '')) return `Order status is ${o.status}.`;
  if (o.currency !== 'NOK') return `Currency ${o.currency} is not supported.`;
  if (o.lines.length === 0) return 'Order has no lines.';
  if (o.totalMinor === null) return 'Order has no total.';
  if (Math.abs(o.netMinor + o.vatMinor - o.totalMinor) > 100) return `Lines (${formatMinor(o.netMinor + o.vatMinor)}) do not match the order total (${formatMinor(o.totalMinor)}). Check gift cards or discounts in Mystore.`;
  return null;
}

/** @param {{ products: Array<{ p: StoreProduct, exists: boolean }>, orders: Array<{ o: StoreOrder, customerId: number | null }>, storeLabel: string, isSample?: boolean }} state */
function renderStoreSync(state) {
  const newProds = state.products.filter((x) => !x.exists).length;
  return html`
    <div class="metric-grid">
      ${reaiMetric({ label: 'Products with SKU', value: String(state.products.length), detail: `${newProds} not in ReAI` })}
      ${reaiMetric({ label: 'Orders in period', value: String(state.orders.length), detail: state.storeLabel })}
      ${reaiMetric({ label: 'Duplicate check', value: 'SKU and order id', detail: 'Checked in ReAI before creating' })}
    </div>
    ${reaiCard({
      eyebrow: `${BRAND.toUpperCase()} PRODUCTS → REAI PRODUCTS`,
      title: 'Products',
      badge: reaiBadge({ text: `${newProds} new`, tone: newProds > 0 ? 'accent' : 'success' }),
      body: html`<div class="table-wrap"><table class="data-table">
        <thead><tr><th>SKU</th><th>Product</th><th class="num">Price ex. VAT</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>${state.products.slice(0, 200).map(({ p, exists }, idx) => html`<tr id="ec-p-${idx}">
          <td class="mono">${p.sku}</td><td><strong>${p.title}</strong></td><td class="num">${formatMinor(Math.round(p.priceExVat * 100))} NOK</td>
          <td>${exists ? reaiBadge({ text: 'In ReAI', tone: 'neutral' }) : reaiBadge({ text: 'New SKU', tone: 'success' })}</td>
          <td>${exists || state.isSample
            ? html`<span class="muted-note">${state.isSample && !exists ? 'Demo only' : 'Synced'}</span>`
            : html`<form hx-post="${BASE_PATH}/sync-product" hx-target="#ec-p-${idx}" hx-swap="outerHTML">
                <input type="hidden" name="sku" value="${p.sku}"><input type="hidden" name="title" value="${p.title}"><input type="hidden" name="price" value="${p.priceExVat.toFixed(2)}">
                <button type="submit" class="button primary">Create in ReAI</button>
              </form>`}</td>
        </tr>`)}</tbody>
      </table></div>`,
    })}
    ${reaiCard({
      eyebrow: `${BRAND.toUpperCase()} ORDERS → REAI ORDERS`,
      title: 'Orders',
      body: html`<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th class="num">Net</th><th class="num">VAT</th><th>Action</th></tr></thead>
        <tbody>${state.orders.map(({ o, customerId }, idx) => {
          const problem = orderProblem(o);
          return html`<tr id="ec-o-${idx}">
            <td class="mono">${o.id}</td><td class="mono">${o.date}</td><td><strong>${o.customerName}</strong>${o.customerEmail ? html`<br><span class="muted-note">${o.customerEmail}</span>` : ''}</td>
            <td class="num">${formatMinor(o.netMinor)}</td><td class="num">${formatMinor(o.vatMinor)}</td>
            <td>${state.isSample
              ? html`<span class="muted-note">Demo only</span>`
              : problem
                ? html`<span class="muted-note">${problem}</span>`
                : !customerId
                  ? html`<span class="muted-note">No ReAI customer with this email or name</span>`
                  : html`<form hx-post="${BASE_PATH}/sync-order" hx-target="#ec-o-${idx}" hx-swap="outerHTML">
                      <input type="hidden" name="orderJson" value="${JSON.stringify(o)}"><input type="hidden" name="customerId" value="${customerId}">
                      <button type="submit" class="button primary">Create order in ReAI</button>
                    </form>`}</td>
          </tr>`;
        })}</tbody>
      </table></div>
      <p class="muted-note">Each order becomes a ReAI order with one line per product, shipping or fee, priced excluding VAT with the ReAI output VAT code for the Mystore VAT rate. Orders are only offered when the lines add up to the Mystore order total.</p>`,
    })}
  `;
}

/**
 * Picks the ReAI invoice VAT code for a Mystore VAT rate.
 * @param {ReAIVatCode[]} codes
 * @param {number} ratePct
 */
function invoiceVatCode(codes, ratePct) {
  const usable = codes.filter((c) => !c.reverseCharge && Math.abs(c.rate - ratePct) < 0.001);
  const match = usable.find((c) => c.vatType === 'output_vat') ?? (ratePct === 0 ? (usable.find((c) => c.vatType === 'exempt') ?? usable.find((c) => c.vatType === 'outside_scope')) : undefined);
  if (!match) throw new HttpError(400, `ReAI has no invoice VAT code for ${ratePct}% in this company.`);
  return match.code;
}

/** @type {StoreOrder} */
const SAMPLE_ORDER = {
  id: '5001',
  date: '2026-10-20',
  status: 'Sendt',
  credited: false,
  customerName: 'Nordic Retail AS',
  customerEmail: 'post+mystore@aiak.no',
  currency: 'NOK',
  lines: [
    { name: 'Nordic Wool Sweater (SKU-101)', quantity: 1, unitPriceExVat: 959.2, ratePct: 25 },
    { name: 'Posten Brevpost', quantity: 1, unitPriceExVat: 79.2, ratePct: 25 },
  ],
  netMinor: 103840,
  vatMinor: 25960,
  totalMinor: 129800,
};

/**
 * Handles /app/mystore/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE_PATH && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL(`${BASE_PATH}/`, request.url), 301);
  }
  if (pathname === `${BASE_PATH}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">ECOMMERCE · PRODUCTS AND ORDERS</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${SLUG}-web`, clientName: `ReAI ${BRAND} Sync (Web)` })}
        ${reaiCard({
          eyebrow: `CONNECT ${BRAND.toUpperCase()}`,
          title: `Scan ${BRAND} products and orders`,
          body: html`
            <p class="muted-note">Log in at auth.mystore.no with your store name and admin user, open Personal Access Tokens and create a token with products:read and orders:read. The token is used only for this scan and is never stored.</p>
            <form class="stack" hx-post="${BASE_PATH}/scan" hx-target="#ec-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="ec-shopName">Store name</label><input id="ec-shopName" name="shopName" type="text" required placeholder="minbutikk"></div>
                <div class="field"><label for="ec-apiToken">Personal access token</label><input id="ec-apiToken" name="apiToken" type="password" autocomplete="off" required placeholder="Token"></div>
                <div class="field"><label for="ec-from">Orders from</label><input id="ec-from" name="fromDate" type="date" value="${new Date().toISOString().slice(0, 7)}-01" required></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Scan ${BRAND}</button>
                <button type="button" class="button secondary" hx-post="${BASE_PATH}/sample" hx-target="#ec-output" hx-swap="innerHTML">Load sample store</button>
              </div>
            </form>
          `,
        })}
        <div id="ec-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${BASE_PATH}/sample`) {
    return htmlResponse(renderStoreSync({
      isSample: true,
      storeLabel: `${BRAND} demo`,
      products: [
        { p: { sku: 'SKU-101', title: 'Nordic Wool Sweater', priceExVat: 959.2 }, exists: true },
        { p: { sku: 'SKU-102', title: 'Fjord Insulated Bottle', priceExVat: 399.2 }, exists: false },
      ],
      orders: [{ o: SAMPLE_ORDER, customerId: 1 }],
    }));
  }

  try {
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    const auth = { token: session.accessToken, tenantId: session.tenantId };
    const form = await request.formData();

    if (pathname === `${BASE_PATH}/scan`) {
      const [store, pRaw, cRaw] = await Promise.all([
        fetchApi({ shopName: String(form.get('shopName') ?? ''), apiToken: String(form.get('apiToken') ?? ''), fromDate: String(form.get('fromDate') ?? '') }),
        reaiAll(env, '/api/products', auth),
        reaiAll(env, '/api/customers', auth),
      ]);
      const skus = new Set();
      for (const p of /** @type {ReAIProduct[]} */ (pRaw)) {
        for (const v of p.variants ?? []) if (v.sku) skus.add(v.sku.trim().toLowerCase());
      }
      const custs = /** @type {ReAICustomer[]} */ (cRaw);
      return htmlResponse(renderStoreSync({
        storeLabel: store.storeLabel,
        products: store.products.map((p) => ({ p, exists: skus.has(p.sku.toLowerCase()) })),
        orders: store.orders.map((o) => ({
          o,
          customerId: custs.find((c) => (o.customerEmail && [c.email, c.invoiceEmail].some((e) => (e ?? '').trim().toLowerCase() === o.customerEmail)) || (c.name ?? '').trim().toLowerCase() === o.customerName.toLowerCase())?.id ?? null,
        })),
      }));
    }

    if (pathname === `${BASE_PATH}/sync-product`) {
      const sku = String(form.get('sku') ?? '').trim().slice(0, 100);
      const title = String(form.get('title') ?? '').trim().slice(0, 200);
      const price = Number(form.get('price') ?? '0');
      if (!sku || !title || !Number.isFinite(price)) throw new HttpError(400, 'Product needs a SKU, a title and a price.');
      const found = /** @type {{ items?: ReAIProduct[] }} */ (await reaiRequest(env, '/api/products', { ...auth, query: { query: sku, pageSize: '50' } }));
      const same = (found.items ?? []).find((x) => (x.variants ?? []).some((v) => (v.sku ?? '').trim().toLowerCase() === sku.toLowerCase()));
      if (same) return htmlResponse(html`<tr><td class="mono">${sku}</td><td><strong>${title}</strong></td><td class="num">${formatMinor(Math.round(price * 100))} NOK</td><td>${reaiBadge({ text: `In ReAI #${same.id}`, tone: 'neutral' })}</td><td><span class="muted-note">Synced</span></td></tr>`);
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/products', { ...auth, method: 'POST', body: { title, stockItem: true, variants: [{ sku, sellingPrice: Math.max(0, Number(price.toFixed(2))) }] } }));
      return htmlResponse(html`<tr><td class="mono">${sku}</td><td><strong>${title}</strong></td><td class="num">${formatMinor(Math.round(price * 100))} NOK</td><td>${reaiBadge({ text: `Created #${created.id}`, tone: 'success' })}</td><td><span class="muted-note">Synced</span></td></tr>`);
    }

    if (pathname === `${BASE_PATH}/sync-order`) {
      const o = /** @type {StoreOrder} */ (JSON.parse(String(form.get('orderJson') ?? '{}')));
      const customerId = Number(form.get('customerId') ?? '0');
      if (!o || !Array.isArray(o.lines) || !/^[0-9]+$/.test(String(o.id)) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(o.date)) || customerId <= 0) throw new HttpError(400, 'Order data is incomplete.');
      const problem = orderProblem(o);
      if (problem) throw new HttpError(400, problem);
      const externalReference = `mystore-${o.id}`;
      const existing = /** @type {{ items?: Array<{ id: number | null }> }} */ (await reaiRequest(env, '/api/orders', { ...auth, query: { externalReference, status: 'all', pageSize: '1' } }));
      const dup = existing.items?.find((x) => x.id);
      if (dup) return htmlResponse(html`<tr><td class="mono">${o.id}</td><td class="mono">${o.date}</td><td>${o.customerName}</td><td class="num">${formatMinor(o.netMinor)}</td><td class="num">${formatMinor(o.vatMinor)}</td><td><a href="${reaiOrigin(env)}/order/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Already in ReAI ↗</a></td></tr>`);
      const vatCodes = /** @type {ReAIVatCode[]} */ (await reaiRequest(env, '/api/vat-codes', { ...auth, query: { usage: 'customer_invoice' } }));
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/orders', {
        ...auth,
        method: 'POST',
        body: {
          customerId,
          currencyCode: 'NOK',
          daysUntilDue: 14,
          issueDate: o.date,
          orderDate: o.date,
          externalReference,
          comment: `${BRAND} order ${o.id}`,
          orderLines: o.lines.map((l) => ({ itemName: String(l.name).slice(0, 200), quantity: Number(l.quantity), unitPrice: Number(Number(l.unitPriceExVat).toFixed(2)), vatCode: invoiceVatCode(vatCodes, Number(l.ratePct)) })),
        },
      }));
      const url = `${reaiOrigin(env)}/order/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(html`<tr><td class="mono">${o.id}</td><td class="mono">${o.date}</td><td>${o.customerName}</td><td class="num">${formatMinor(o.netMinor)}</td><td class="num">${formatMinor(o.vatMinor)}</td><td><a href="${url}" target="_blank" rel="noopener">Order #${created.id} ↗</a></td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Store sync failed.' }));
  }
  return errorResponse('Unknown store route.', 404);
}
