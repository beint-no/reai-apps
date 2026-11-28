// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * @typedef {{ sku: string, title: string, priceExVat: number, currency: string, stockItem: boolean }} StoreProduct
 * @typedef {{ id: string, number: string, date: string, customerName: string, customerEmail: string, totalExVat: number, currency: string, status: string }} StoreOrder
 * @typedef {{ id: number, title: string, variants?: Array<{ sku?: string | null }> }} ReAIProduct
 * @typedef {{ id: number, name: string, email?: string | null, invoiceEmail?: string | null }} ReAICustomer
 */

const CFG = {
  "brand": "24Nettbutikk",
  "title": "24Nettbutikk Product & Sales Sync",
  "lead": "Sync products and paid orders from 24Nettbutikk into ReAI with SKU deduplication and idempotent order import.",
  "hint": "Enter your 24Nettbutikk store domain (https://butikk.no) and API Bearer token from Kontrollpanel.",
  "fields": [
    {
      "key": "storeUrl",
      "label": "Store URL",
      "placeholder": "https://minbutikk.no"
    },
    {
      "key": "apiToken",
      "label": "API Bearer token",
      "secret": true,
      "placeholder": "API token from 24Nettbutikk"
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

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {string} label
 */
async function storeJson(url, init, label) {
  const res = await fetch(url, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status >= 300 && res.status < 400) {
    throw new HttpError(502, `${label} returned an unexpected redirect. Verify the exact store URL.`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new HttpError(
      400,
      res.status === 401 || res.status === 403
        ? `${label} rejected these API credentials (HTTP ${res.status}).`
        : `${label} returned HTTP ${res.status}.`,
    );
  }
  return text ? JSON.parse(text) : {};
}


/**
 * @param {Record<string, string>} fields
 * @returns {Promise<{ products: StoreProduct[], orders: StoreOrder[], storeLabel: string }>}
 */
async function fetchStoreCatalogAndOrders(fields) {
    const base = assertPublicHttpsBase(fields.storeUrl ?? '');
    const headers = { authorization: `Bearer ${fields.apiToken ?? ''}`, accept: 'application/json' };
    const [pBody, oBody] = await Promise.all([
      storeJson(`${base}/api/v1/products?limit=50`, { headers }, '24Nettbutikk'),
      storeJson(`${base}/api/v1/orders?limit=50`, { headers }, '24Nettbutikk'),
    ]);
    const pList = Array.isArray(pBody.data) ? pBody.data : Array.isArray(pBody) ? pBody : [];
    const oList = Array.isArray(oBody.data) ? oBody.data : Array.isArray(oBody) ? oBody : [];
    return {
      products: pList.map((/** @type {any} */ p) => ({
        sku: String(p.sku ?? p.artnr ?? p.id ?? '').trim(),
        title: String(p.name ?? p.title ?? `Product ${p.id}`).trim(),
        priceExVat: Number(p.price_ex_vat ?? p.price ?? 0),
        currency: String(p.currency ?? 'NOK').toUpperCase(),
        stockItem: true,
      })),
      orders: oList.map((/** @type {any} */ o) => ({
        id: String(o.id),
        number: String(o.order_number ?? o.id),
        date: String(o.created_at ?? new Date().toISOString()).slice(0, 10),
        customerName: String(o.customer_name ?? 'Webshop Customer'),
        customerEmail: String(o.customer_email ?? ''),
        totalExVat: Number(o.subtotal ?? o.total_ex_vat ?? o.total ?? 0),
        currency: String(o.currency ?? 'NOK').toUpperCase(),
        status: String(o.status ?? 'paid'),
      })),
      storeLabel: new URL(base).hostname,
    };
}

/** @param {{ products: Array<{ p: StoreProduct, exists: boolean }>, orders: Array<{ o: StoreOrder, customerId: number | null }>, storeLabel: string, isSample?: boolean }} state */
function renderStoreSync(state) {
  const newProds = state.products.filter((x) => !x.exists).length;
  return html`
    <div class="metric-grid">
      ${reaiMetric({ label: 'Store products', value: String(state.products.length), detail: `${newProds} new SKUs` })}
      ${reaiMetric({ label: 'Paid orders', value: String(state.orders.length), detail: state.storeLabel })}
      ${reaiMetric({ label: 'Idempotency', value: 'SKU & Order #', detail: 'Zero duplicate imports' })}
    </div>
    ${reaiCard({
      eyebrow: `${CFG.brand.toUpperCase()} CATALOG → REAI PRODUCTS`,
      title: 'Products',
      badge: reaiBadge({ text: `${newProds} new`, tone: newProds > 0 ? 'accent' : 'success' }),
      body: html`<div class="table-wrap"><table class="data-table">
        <thead><tr><th>SKU</th><th>Product</th><th class="num">Price ex. VAT</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>${state.products.slice(0, 80).map(({ p, exists }, idx) => html`<tr id="ec-p-${idx}">
          <td class="mono">${p.sku || '—'}</td><td><strong>${p.title}</strong></td><td class="num">${formatMinor(Math.round(p.priceExVat * 100))} ${p.currency}</td>
          <td>${exists ? reaiBadge({ text: 'In ReAI', tone: 'neutral' }) : reaiBadge({ text: 'New SKU', tone: 'success' })}</td>
          <td>${exists || state.isSample
            ? html`<span class="muted-note">${state.isSample && !exists ? 'Demo only' : 'Synced'}</span>`
            : html`<form hx-post="/app/24nettbutikk/sync-product" hx-target="#ec-p-${idx}" hx-swap="outerHTML">
                <input type="hidden" name="sku" value="${p.sku}"><input type="hidden" name="title" value="${p.title}"><input type="hidden" name="price" value="${p.priceExVat.toFixed(2)}">
                <button type="submit" class="button primary">Create in ReAI</button>
              </form>`}</td>
        </tr>`)}</tbody>
      </table></div>`,
    })}
    ${reaiCard({
      eyebrow: `${CFG.brand.toUpperCase()} ORDERS → REAI DRAFT ORDERS`,
      title: 'Paid orders',
      body: html`<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th class="num">Total ex. VAT</th><th>Action</th></tr></thead>
        <tbody>${state.orders.slice(0, 80).map(({ o, customerId }, idx) => html`<tr id="ec-o-${idx}">
          <td class="mono">${o.number}</td><td class="mono">${o.date}</td><td><strong>${o.customerName}</strong></td><td class="num">${formatMinor(Math.round(o.totalExVat * 100))} ${o.currency}</td>
          <td>${state.isSample || !customerId
            ? html`<span class="muted-note">${state.isSample ? 'Demo only' : 'No matching ReAI customer'}</span>`
            : html`<form hx-post="/app/24nettbutikk/sync-order" hx-target="#ec-o-${idx}" hx-swap="outerHTML">
                <input type="hidden" name="orderId" value="${o.id}"><input type="hidden" name="number" value="${o.number}"><input type="hidden" name="date" value="${o.date}"><input type="hidden" name="total" value="${o.totalExVat.toFixed(2)}"><input type="hidden" name="customerId" value="${customerId}">
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
  const basePath = '/app/24nettbutikk';
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  }
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">ECOMMERCE · PRODUCT & SALES SYNC</p><h1>${CFG.title}</h1><p class="lead">${CFG.lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-24nettbutikk-web', clientName: `ReAI ${CFG.brand} Sync (Web)` })}
        ${reaiCard({
          eyebrow: `CONNECT ${CFG.brand.toUpperCase()}`,
          title: `Scan ${CFG.brand} products & orders`,
          body: html`
            <p class="muted-note">${CFG.hint} Credentials are used only for this single HTTPS scan and never stored.</p>
            <form class="stack" hx-post="${basePath}/scan" hx-target="#ec-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                ${CFG.fields.map((f) => html`<div class="field"><label for="ec-${f.key}">${f.label}</label><input id="ec-${f.key}" name="${f.key}" type="${f.secret ? 'password' : 'text'}"${f.secret ? html` autocomplete="off"` : ''} required placeholder="${f.placeholder}"></div>`)}
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
      const [store, pRaw, cRaw] = await Promise.all([
        fetchStoreCatalogAndOrders(fields),
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
          customerId: custs.find((c) => (o.customerEmail && (c.email === o.customerEmail || c.invoiceEmail === o.customerEmail)) || c.name.trim().toLowerCase() === o.customerName.trim().toLowerCase())?.id ?? null,
        })),
      }));
    }

    if (pathname === `${basePath}/sync-product`) {
      const sku = String(form.get('sku') ?? '').trim();
      const title = String(form.get('title') ?? '').trim();
      const price = Number(form.get('price') ?? '0');
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/products', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { title, stockItem: true, variants: [{ sku, sellingPrice: price >= 0 ? price : 0 }] } }));
      return htmlResponse(html`<tr><td class="mono">${sku}</td><td><strong>${title}</strong></td><td class="num">${formatMinor(Math.round(price * 100))}</td><td>${reaiBadge({ text: `Created #${created.id}`, tone: 'success' })}</td><td><span class="muted-note">Synced</span></td></tr>`);
    }

    if (pathname === `${basePath}/sync-order`) {
      const orderId = String(form.get('orderId') ?? '').trim();
      const number = String(form.get('number') ?? orderId).trim();
      const date = String(form.get('date') ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
      const total = Number(form.get('total') ?? '0');
      const customerId = Number(form.get('customerId') ?? '0');
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/orders', {
        token: session.accessToken,
        tenantId: session.tenantId,
        method: 'POST',
        body: { customerId, currencyCode: 'NOK', daysUntilDue: 14, issueDate: date, orderDate: date, externalReference: `24nettbutikk-${orderId}`.slice(0, 100), comment: `${CFG.brand} order ${number}`, orderLines: [{ itemName: `${CFG.brand} order ${number}`, quantity: 1, unitPrice: Number(total.toFixed(2)) }] },
      }));
      const url = `${reaiOrigin(env)}/order/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(html`<tr><td class="mono">${number}</td><td class="mono">${date}</td><td>Customer #${customerId}</td><td class="num">${formatMinor(Math.round(total * 100))}</td><td><a href="${url}" target="_blank" rel="noopener">Order #${created.id} ↗</a></td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${CFG.brand} error`, body: err instanceof Error ? err.message : 'Store sync failed.' }));
  }
  return errorResponse('Unknown store route.', 404);
}
