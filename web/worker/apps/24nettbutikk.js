// @ts-check
import { fetchJson, num, pickList } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { currentMonthIso, formatMinor, monthBounds } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * @typedef {{ sku: string, title: string, price: number, vatRate: number }} StoreProduct
 * @typedef {{ name: string, quantity: number, netMinor: number, vatRate: number }} StoreLine
 * @typedef {{ orderNo: string, date: string, customerId: string, customerName: string, customerEmail: string, organisationNo: string, currency: string, grossMinor: number, lines: StoreLine[], note: string }} StoreOrder
 * @typedef {{ id: number, title: string, variants?: Array<{ sku?: string | null }> }} ReAIProduct
 * @typedef {{ id: number, name?: string | null, email?: string | null, invoiceEmail?: string | null, organizationNumber?: string | null }} ReAICustomer
 * @typedef {{ code: string, rate: number, vatType: string, reverseCharge: boolean }} VatCode
 */

const SLUG = '24nettbutikk';
const BRAND = '24Nettbutikk';
const BASE_PATH = '/app/24nettbutikk';
const TITLE = '24Nettbutikk Product & Order Sync';
const LEAD = 'Fetch products and paid orders for one month from the 24Nettbutikk API, create missing products in ReAI and stage paid orders as ReAI orders with the VAT rates from the shop.';
const PAGE = 100;
const MAX_PAGES = 10;
const MAX_CUSTOMERS = 40;

/**
 * Validates that a user-supplied store base URL is public HTTPS (prevents SSRF).
 * @param {string} raw
 * @returns {string}
 */
function storeBase(raw) {
  let parsed;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new HttpError(400, 'Enter the https:// address of your 24Nettbutikk shop.');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'https:' ||
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2[0-9]|3[01])\.|\[::1\]|\[f[cd])/.test(host)
  ) {
    throw new HttpError(400, 'The shop address must be a public https:// address.');
  }
  return parsed.origin;
}

/** @param {unknown} v */
function minor(v) {
  return Math.round(num(v) * 100);
}

/** @param {any} c */
function customerName(c) {
  const company = String(c?.company_name ?? '').trim();
  if (String(c?.customer_type ?? '') === 'company' && company) return company;
  return [c?.first_name, c?.last_name].map((s) => String(s ?? '').trim()).filter(Boolean).join(' ') || company;
}

/**
 * Reads every page of one 24Nettbutikk collection with offset paging (limit/offset/since as URI segments).
 * @param {string} base
 * @param {string} model
 * @param {number | null} since
 * @param {Record<string, string>} headers
 * @param {import('../lib/api-http.js').FetchLike} fetchImpl
 * @returns {Promise<any[]>}
 */
async function listAll(base, model, since, headers, fetchImpl) {
  /** @type {any[]} */
  const all = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${base}/api/v1/${model}/${PAGE}/${page * PAGE}${since === null ? '' : `/${since}`}`;
    const rows = pickList(await fetchJson(url, { headers }, BRAND, fetchImpl), ['data']);
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

/**
 * Fetches products and the month's paid orders from the 24Nettbutikk webshop API.
 * Docs (published by Sincos Software AS, the company behind 24Nettbutikk):
 * https://github.com/SincosSoftware/webshop_api/wiki/API-Documentation (Basic auth with token:x-oauth-basic,
 * limit/offset/since URI segments, { data } envelope),
 * https://github.com/SincosSoftware/webshop_api/wiki/products (GET /api/v1/products),
 * https://github.com/SincosSoftware/webshop_api/wiki/orders (GET /api/v1/orders, order and order line resources),
 * https://github.com/SincosSoftware/webshop_api/wiki/customers (GET /api/v1/customers/<customer_id>).
 * API key: https://support.24nettbutikk.no/knowledge/slik-genererer-du-api-n%C3%B8kler
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<{ products: StoreProduct[], orders: StoreOrder[], storeLabel: string, month: string }>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const base = storeBase(creds.storeUrl ?? '');
  const token = (creds.apiToken ?? '').trim();
  if (!token) throw new HttpError(400, 'Enter your 24Nettbutikk API key.');
  const bounds = monthBounds((creds.month ?? currentMonthIso()).trim());
  const headers = { authorization: `Basic ${btoa(`${token}:x-oauth-basic`)}`, accept: 'application/json' };
  const since = Math.floor(Date.parse(`${bounds.start}T00:00:00Z`) / 1000) - 86_400;

  const [rawProducts, rawOrders] = await Promise.all([
    listAll(base, 'products', null, headers, fetchImpl),
    listAll(base, 'orders', since, headers, fetchImpl),
  ]);

  /** @type {StoreProduct[]} */
  const products = rawProducts
    .filter((p) => p && p.active !== false)
    .map((p) => ({
      sku: String(p.article_no ?? '').trim() || `24NB-${p.id}`,
      title: String(p.name ?? `Product ${p.id}`).trim(),
      price: num(p.price),
      vatRate: num(p.vat),
    }));

  const paid = rawOrders.filter((o) => {
    const date = String(o?.order_date ?? '');
    const status = String(o?.status ?? '');
    return o?.paid === true && o?.deleted !== true && status !== 'cancelled' && status !== 'rejected' && date >= bounds.start && date < bounds.end;
  });

  const ids = [...new Set(paid.map((o) => String(o.customer_id ?? '')).filter((id) => /^[0-9]+$/.test(id) && id !== '0'))].slice(0, MAX_CUSTOMERS);
  /** @type {Map<string, any>} */
  const customers = new Map();
  await Promise.all(ids.map(async (id) => {
    const body = await fetchJson(`${base}/api/v1/customers/${id}`, { headers }, BRAND, fetchImpl);
    const c = pickList(body, ['data'])[0];
    if (c) customers.set(id, c);
  }));

  /** @type {StoreOrder[]} */
  const orders = paid.map((o) => {
    const c = customers.get(String(o.customer_id ?? ''));
    const grossMinor = minor(o.total_amount_gross);
    const orderNetMinor = grossMinor - minor(o.total_vat);
    /** @type {StoreLine[]} */
    const lines = (Array.isArray(o.order_lines) ? o.order_lines : [])
      .filter((/** @type {any} */ l) => l && l.blocked !== true)
      .map((/** @type {any} */ l) => ({
        name: String(l.product_name ?? 'Item').trim(),
        quantity: num(l.quantity),
        netMinor: minor(l.total_amount_gross) - minor(l.total_vat),
        vatRate: num(l.vat),
      }))
      .filter((/** @type {StoreLine} */ l) => l.netMinor !== 0);
    const restMinor = orderNetMinor - lines.reduce((s, l) => s + l.netMinor, 0);
    let note = '';
    if (restMinor > 0) lines.push({ name: String(o.shipping_method_text ?? '').trim() || 'Shipping and charges', quantity: 1, netMinor: restMinor, vatRate: num(o.vat) });
    if (restMinor < 0 || (Array.isArray(o.used_gift_cards) && o.used_gift_cards.length > 0)) note = 'Paid partly with a gift card. Book it in ReAI by hand.';
    if (!c) note = note || 'Customer details were not loaded.';
    return {
      orderNo: String(o.order_no ?? ''),
      date: String(o.order_date).slice(0, 10),
      customerId: String(o.customer_id ?? ''),
      customerName: c ? customerName(c) : `Customer ${o.customer_id ?? ''}`.trim(),
      customerEmail: String(c?.e_mail ?? '').trim(),
      organisationNo: String(c?.organisation_no ?? '').replace(/\s+/g, ''),
      currency: String(o.currency ?? 'NOK').toUpperCase(),
      grossMinor,
      lines,
      note,
    };
  });
  return { products, orders, storeLabel: new URL(base).hostname, month: bounds.month };
}

/**
 * Picks the ReAI invoice VAT code for a 24Nettbutikk VAT percentage.
 * @param {VatCode[]} codes
 * @param {number} rate
 */
function invoiceVatCode(codes, rate) {
  const usable = codes.filter((c) => !c.reverseCharge && Math.abs(c.rate - rate) < 0.001);
  const match = usable.find((c) => c.vatType === 'output_vat') ?? (rate === 0 ? usable.find((c) => c.vatType === 'exempt') ?? usable.find((c) => c.vatType === 'outside_scope') : undefined);
  if (!match) throw new HttpError(400, `ReAI has no invoice VAT code for ${rate}% in this company.`);
  return match.code;
}

/** @param {{ products: Array<{ p: StoreProduct, exists: boolean }>, orders: Array<{ o: StoreOrder, customerId: number | null }>, storeLabel: string, month: string, isSample?: boolean }} state */
function renderStoreSync(state) {
  const newProds = state.products.filter((x) => !x.exists).length;
  return html`
    <div class="metric-grid">
      ${reaiMetric({ label: 'Shop products', value: String(state.products.length), detail: `${newProds} not in ReAI` })}
      ${reaiMetric({ label: 'Paid orders', value: String(state.orders.length), detail: `${state.storeLabel} · ${state.month}` })}
      ${reaiMetric({ label: 'Duplicates', value: 'Blocked', detail: 'SKU and order number checks' })}
    </div>
    ${reaiCard({
      eyebrow: `${BRAND.toUpperCase()} PRODUCTS → REAI PRODUCTS`,
      title: 'Products',
      badge: reaiBadge({ text: `${newProds} new`, tone: newProds > 0 ? 'accent' : 'success' }),
      body: html`<p class="muted-note">The price is copied as it is stored in 24Nettbutikk. Check whether your shop stores prices with or without VAT before creating products.</p>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>SKU</th><th>Product</th><th class="num">Price</th><th>VAT</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>${state.products.slice(0, 200).map(({ p, exists }, idx) => html`<tr id="ec-p-${idx}">
          <td class="mono">${p.sku}</td><td><strong>${p.title}</strong></td><td class="num">${formatMinor(Math.round(p.price * 100))}</td><td>${p.vatRate}%</td>
          <td>${exists ? reaiBadge({ text: 'In ReAI', tone: 'neutral' }) : reaiBadge({ text: 'New SKU', tone: 'success' })}</td>
          <td>${exists || state.isSample
            ? html`<span class="muted-note">${state.isSample && !exists ? 'Demo only' : 'Synced'}</span>`
            : html`<form hx-post="${BASE_PATH}/sync-product" hx-target="#ec-p-${idx}" hx-swap="outerHTML">
                <input type="hidden" name="productJson" value="${JSON.stringify(p)}">
                <button type="submit" class="button primary">Create in ReAI</button>
              </form>`}</td>
        </tr>`)}</tbody>
      </table></div>`,
    })}
    ${reaiCard({
      eyebrow: `${BRAND.toUpperCase()} ORDERS → REAI ORDERS`,
      title: 'Paid orders',
      body: html`<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th>Lines</th><th class="num">Total incl. VAT</th><th>Action</th></tr></thead>
        <tbody>${state.orders.slice(0, 200).map(({ o, customerId }, idx) => html`<tr id="ec-o-${idx}">
          <td class="mono">${o.orderNo}</td><td class="mono">${o.date}</td><td><strong>${o.customerName}</strong>${o.customerEmail ? html`<br><span class="muted-note">${o.customerEmail}</span>` : ''}</td>
          <td>${o.lines.map((l) => html`<div>${l.quantity} × ${l.name} (${formatMinor(l.netMinor)} + ${l.vatRate}%)</div>`)}</td>
          <td class="num">${formatMinor(o.grossMinor)} ${o.currency}</td>
          <td>${state.isSample
            ? html`<span class="muted-note">Demo only</span>`
            : o.note
              ? html`<span class="muted-note">${o.note}</span>`
              : !customerId
                ? html`<span class="muted-note">No matching ReAI customer</span>`
                : html`<form hx-post="${BASE_PATH}/sync-order" hx-target="#ec-o-${idx}" hx-swap="outerHTML">
                    <input type="hidden" name="orderJson" value="${JSON.stringify(o)}"><input type="hidden" name="customerId" value="${customerId}">
                    <button type="submit" class="button primary">Stage order</button>
                  </form>`}</td>
        </tr>`)}</tbody>
      </table></div>`,
    })}
  `;
}

/**
 * Handles /app/24nettbutikk/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
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
      <section class="app-intro"><p class="eyebrow">ECOMMERCE · PRODUCT & ORDER SYNC</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${SLUG}-web`, clientName: `ReAI ${BRAND} Sync (Web)` })}
        ${reaiCard({
          eyebrow: `CONNECT ${BRAND.toUpperCase()}`,
          title: `Scan ${BRAND} products and orders`,
          body: html`
            <p class="muted-note">Generate an API key in 24Nettbutikk: click your name, choose API Nøkler and click Generer tilfeldig kode. The key is used only for this request and is never stored.</p>
            <form class="stack" hx-post="${BASE_PATH}/scan" hx-target="#ec-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="ec-url">Shop address</label><input id="ec-url" name="storeUrl" type="url" required placeholder="https://minbutikk.no"></div>
                <div class="field"><label for="ec-key">API key</label><input id="ec-key" name="apiToken" type="password" autocomplete="off" required></div>
                <div class="field"><label for="ec-month">Order month</label><input id="ec-month" name="month" type="text" pattern="[0-9]{4}-[0-9]{2}" value="${currentMonthIso()}" required></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Scan ${BRAND}</button>
                <button type="button" class="button secondary" hx-post="${BASE_PATH}/sample" hx-target="#ec-output" hx-swap="innerHTML">Load sample shop</button>
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
      month: '2026-10',
      products: [
        { p: { sku: 'SKU-101', title: 'Ullgenser', price: 1199, vatRate: 25 }, exists: true },
        { p: { sku: 'SKU-102', title: 'Termoflaske', price: 499, vatRate: 25 }, exists: false },
      ],
      orders: [{
        o: { orderNo: '5001', date: '2026-10-20', customerId: '77', customerName: 'Nordisk Handel AS', customerEmail: 'post+24nb@aiak.no', organisationNo: '', currency: 'NOK', grossMinor: 198800, lines: [{ name: 'Ullgenser', quantity: 1, netMinor: 95920, vatRate: 25 }, { name: 'Termoflaske', quantity: 1, netMinor: 39920, vatRate: 25 }, { name: 'Bring Pakke til hentested', quantity: 1, netMinor: 23200, vatRate: 25 }], note: '' },
        customerId: 1,
      }],
    }));
  }

  try {
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    const auth = { token: session.accessToken, tenantId: session.tenantId };
    const form = await request.formData();

    if (pathname === `${BASE_PATH}/scan`) {
      /** @type {Record<string, string>} */
      const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      const [store, pRaw, cRaw] = await Promise.all([
        fetchApi(creds),
        reaiAll(env, '/api/products', auth),
        reaiAll(env, '/api/customers', auth),
      ]);
      const skus = new Set();
      for (const p of /** @type {ReAIProduct[]} */ (pRaw)) {
        for (const v of p.variants ?? []) if (v.sku) skus.add(v.sku.trim().toLowerCase());
      }
      const custs = /** @type {ReAICustomer[]} */ (cRaw);
      /** @param {StoreOrder} o */
      const matchCustomer = (o) => {
        const email = o.customerEmail.toLowerCase();
        return custs.find((c) => (o.organisationNo && c.organizationNumber === o.organisationNo)
          || (email && ((c.email ?? '').toLowerCase() === email || (c.invoiceEmail ?? '').toLowerCase() === email)))?.id ?? null;
      };
      return htmlResponse(renderStoreSync({
        storeLabel: store.storeLabel,
        month: store.month,
        products: store.products.map((p) => ({ p, exists: skus.has(p.sku.trim().toLowerCase()) })),
        orders: store.orders.map((o) => ({ o, customerId: matchCustomer(o) })),
      }));
    }

    if (pathname === `${BASE_PATH}/sync-product`) {
      const p = /** @type {StoreProduct} */ (JSON.parse(String(form.get('productJson') ?? '{}')));
      if (!p.sku || !p.title) throw new HttpError(400, 'The product has no SKU or name.');
      const codes = /** @type {VatCode[]} */ (await reaiRequest(env, '/api/vat-codes', { ...auth, query: { usage: 'customer_invoice' } }));
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/products', {
        ...auth,
        method: 'POST',
        body: { title: p.title.slice(0, 255), stockItem: true, vatCode: invoiceVatCode(codes, Number(p.vatRate)), variants: [{ sku: p.sku.slice(0, 100), sellingPrice: Math.max(0, Number(Number(p.price).toFixed(2))) }] },
      }));
      return htmlResponse(html`<tr><td class="mono">${p.sku}</td><td><strong>${p.title}</strong></td><td class="num">${formatMinor(Math.round(Number(p.price) * 100))}</td><td>${p.vatRate}%</td><td>${reaiBadge({ text: `Created #${created.id}`, tone: 'success' })}</td><td><span class="muted-note">Synced</span></td></tr>`);
    }

    if (pathname === `${BASE_PATH}/sync-order`) {
      const o = /** @type {StoreOrder} */ (JSON.parse(String(form.get('orderJson') ?? '{}')));
      const customerId = Number(form.get('customerId') ?? '0');
      if (!o.orderNo || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(o.date)) || !Array.isArray(o.lines) || o.lines.length === 0 || customerId <= 0) throw new HttpError(400, 'The order is incomplete.');
      const company = session.tenants.find((t) => t.id === session.tenantId);
      if (company && o.currency !== company.currencyCode) throw new HttpError(400, `The order is in ${o.currency}, but the ReAI company uses ${company.currencyCode}.`);
      const codes = /** @type {VatCode[]} */ (await reaiRequest(env, '/api/vat-codes', { ...auth, query: { usage: 'customer_invoice' } }));
      const created = /** @type {{ id: number, number?: string }} */ (await reaiRequest(env, '/api/orders', {
        ...auth,
        method: 'POST',
        body: {
          customerId,
          currencyCode: o.currency,
          daysUntilDue: 14,
          issueDate: o.date,
          orderDate: o.date,
          externalReference: `24nettbutikk-${o.orderNo}`.slice(0, 100),
          comment: `${BRAND} order ${o.orderNo}`,
          orderLines: o.lines.map((l) => ({
            itemName: `${l.quantity} × ${l.name}`.slice(0, 255),
            quantity: 1,
            unitPrice: Number((Math.round(Number(l.netMinor)) / 100).toFixed(2)),
            vatCode: invoiceVatCode(codes, Number(l.vatRate)),
          })),
        },
      }));
      const url = `${reaiOrigin(env)}/order/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(html`<tr><td class="mono">${o.orderNo}</td><td class="mono">${o.date}</td><td>${o.customerName}</td><td></td><td class="num">${formatMinor(o.grossMinor)} ${o.currency}</td><td><a href="${url}" target="_blank" rel="noopener">Order ${created.number ?? `#${created.id}`} ↗</a></td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Shop sync failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
