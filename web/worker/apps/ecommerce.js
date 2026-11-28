// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * @typedef {'mystore' | '24nettbutikk' | 'magento' | 'prestashop' | 'shopware' | 'wix'} EcommerceSlug
 * @typedef {{ key: string, label: string, secret?: boolean, placeholder: string }} StoreField
 * @typedef {{ slug: EcommerceSlug, brand: string, title: string, lead: string, clientId: string, clientName: string, fields: StoreField[], hint: string }} StoreConfig
 * @typedef {{ sku: string, title: string, priceExVat: number, currency: string, stockItem: boolean }} StoreProduct
 * @typedef {{ id: string, number: string, date: string, customerName: string, customerEmail: string, totalExVat: number, currency: string, status: string }} StoreOrder
 * @typedef {{ id: number, title: string, archived?: boolean, stockItem?: boolean, vatCode?: string | null, variants?: Array<{ sku?: string | null }> }} ReAIProduct
 * @typedef {{ id: number, name: string, email?: string | null, invoiceEmail?: string | null, archived?: boolean }} ReAICustomer
 */

/** @type {Record<EcommerceSlug, StoreConfig>} */
const STORES = {
  mystore: {
    slug: 'mystore',
    brand: 'Mystore.no',
    title: 'Mystore.no Product & Sales Sync',
    lead: 'Sync products and paid orders from Mystore.no (JSON:API) directly into ReAI without monthly middleware fees.',
    clientId: 'reai-mystore-web',
    clientName: 'ReAI Mystore Sync (Web)',
    hint: 'Generate a Personal Access Token in Mystore Kontrollpanel with products:read and orders:read scopes.',
    fields: [
      { key: 'shopName', label: 'Mystore shop slug', placeholder: 'minbutikk' },
      { key: 'apiToken', label: 'Mystore Bearer token', secret: true, placeholder: 'eyJ0eXAiOiJKV1Qi…' },
    ],
  },
  '24nettbutikk': {
    slug: '24nettbutikk',
    brand: '24Nettbutikk',
    title: '24Nettbutikk Product & Sales Sync',
    lead: 'Sync products and paid orders from 24Nettbutikk into ReAI with SKU deduplication and idempotent order import.',
    clientId: 'reai-24nettbutikk-web',
    clientName: 'ReAI 24Nettbutikk Sync (Web)',
    hint: 'Enter your 24Nettbutikk store domain (https://butikk.no) and API Bearer token from 24Nettbutikk Kontrollpanel.',
    fields: [
      { key: 'storeUrl', label: 'Store URL', placeholder: 'https://minbutikk.no' },
      { key: 'apiToken', label: 'API Bearer token', secret: true, placeholder: 'API token from 24Nettbutikk' },
    ],
  },
  magento: {
    slug: 'magento',
    brand: 'Magento / Adobe Commerce',
    title: 'Magento / Adobe Commerce Sync',
    lead: 'Sync products (/rest/V1/products) and paid orders (/rest/V1/orders) from Magento 2 or Adobe Commerce into ReAI.',
    clientId: 'reai-magento-web',
    clientName: 'ReAI Magento Sync (Web)',
    hint: 'Create a Magento Integration token under System → Extensions → Integrations with Catalog and Sales read access.',
    fields: [
      { key: 'storeUrl', label: 'Magento base URL', placeholder: 'https://shop.example.no' },
      { key: 'apiToken', label: 'Integration Bearer token', secret: true, placeholder: 'Magento access token' },
    ],
  },
  prestashop: {
    slug: 'prestashop',
    brand: 'PrestaShop',
    title: 'PrestaShop Product & Sales Sync',
    lead: 'Sync PrestaShop catalog products and paid orders into ReAI via the PrestaShop Webservice API.',
    clientId: 'reai-prestashop-web',
    clientName: 'ReAI PrestaShop Sync (Web)',
    hint: 'Enable Webservice in PrestaShop Advanced Parameters → Webservice and grant GET access to products and orders.',
    fields: [
      { key: 'storeUrl', label: 'PrestaShop store URL', placeholder: 'https://shop.example.no' },
      { key: 'apiKey', label: 'Webservice API key', secret: true, placeholder: '32-character PrestaShop key' },
    ],
  },
  shopware: {
    slug: 'shopware',
    brand: 'Shopware 6',
    title: 'Shopware 6 Product & Sales Sync',
    lead: 'Sync Shopware 6 products and paid orders into ReAI using OAuth client credentials with zero middleware.',
    clientId: 'reai-shopware-web',
    clientName: 'ReAI Shopware 6 Sync (Web)',
    hint: 'Create an Integration under Settings → System → Integrations with read access to Products and Orders.',
    fields: [
      { key: 'storeUrl', label: 'Shopware 6 URL', placeholder: 'https://shop.example.no' },
      { key: 'clientId', label: 'Access Key ID', placeholder: 'SWIA…' },
      { key: 'clientSecret', label: 'Secret Access Key', secret: true, placeholder: 'Shopware integration secret' },
    ],
  },
  wix: {
    slug: 'wix',
    brand: 'Wix Stores',
    title: 'Wix Stores Product & Sales Sync',
    lead: 'Sync Wix Stores catalog products and paid eCommerce orders directly into ReAI.',
    clientId: 'reai-wix-web',
    clientName: 'ReAI Wix Stores Sync (Web)',
    hint: 'Create a Wix API Key with Wix Stores and Wix eCommerce read permissions and copy your Site ID.',
    fields: [
      { key: 'siteId', label: 'Wix Site ID', placeholder: '12345678-abcd-…' },
      { key: 'apiKey', label: 'Wix API key', secret: true, placeholder: 'IST.eyJ…' },
    ],
  },
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
 * @param {EcommerceSlug} slug
 * @param {Record<string, string>} fields
 * @returns {Promise<{ products: StoreProduct[], orders: StoreOrder[], storeLabel: string }>}
 */
async function fetchStoreCatalogAndOrders(slug, fields) {
  if (slug === 'mystore') {
    const shop = (fields.shopName ?? '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!shop) {
      throw new HttpError(400, 'Enter your Mystore shop slug.');
    }
    const headers = {
      authorization: `Bearer ${fields.apiToken ?? ''}`,
      accept: 'application/vnd.api+json',
    };
    const [pBody, oBody] = await Promise.all([
      storeJson(`https://api.mystore.no/${encodeURIComponent(shop)}/products?page[limit]=50`, { headers }, 'Mystore'),
      storeJson(`https://api.mystore.no/${encodeURIComponent(shop)}/orders?page[limit]=50`, { headers }, 'Mystore'),
    ]);
    const products = (Array.isArray(pBody.data) ? pBody.data : []).map((/** @type {any} */ item) => ({
      sku: String(item.attributes?.sku ?? item.id ?? '').trim(),
      title: String(item.attributes?.title ?? item.attributes?.name ?? `Product ${item.id}`).trim(),
      priceExVat: Number(item.attributes?.price ?? 0),
      currency: 'NOK',
      stockItem: true,
    }));
    const orders = (Array.isArray(oBody.data) ? oBody.data : []).map((/** @type {any} */ item) => ({
      id: String(item.id),
      number: String(item.attributes?.order_number ?? item.id),
      date: String(item.attributes?.created_at ?? new Date().toISOString()).slice(0, 10),
      customerName: String(item.attributes?.customer_name ?? 'Webshop Customer'),
      customerEmail: String(item.attributes?.customer_email ?? ''),
      totalExVat: Number(item.attributes?.subtotal ?? item.attributes?.total ?? 0),
      currency: String(item.attributes?.currency ?? 'NOK').toUpperCase(),
      status: String(item.attributes?.status ?? 'paid'),
    }));
    return { products, orders, storeLabel: `mystore:${shop}` };
  }

  if (slug === '24nettbutikk') {
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

  if (slug === 'magento') {
    const base = assertPublicHttpsBase(fields.storeUrl ?? '');
    const headers = { authorization: `Bearer ${fields.apiToken ?? ''}`, accept: 'application/json' };
    const [pBody, oBody] = await Promise.all([
      storeJson(`${base}/rest/V1/products?searchCriteria[pageSize]=50`, { headers }, 'Magento'),
      storeJson(`${base}/rest/V1/orders?searchCriteria[pageSize]=50`, { headers }, 'Magento'),
    ]);
    return {
      products: (Array.isArray(pBody.items) ? pBody.items : []).map((/** @type {any} */ p) => ({
        sku: String(p.sku ?? p.id ?? '').trim(),
        title: String(p.name ?? p.sku ?? 'Product').trim(),
        priceExVat: Number(p.price ?? 0),
        currency: 'NOK',
        stockItem: p.type_id !== 'virtual' && p.type_id !== 'downloadable',
      })),
      orders: (Array.isArray(oBody.items) ? oBody.items : []).map((/** @type {any} */ o) => ({
        id: String(o.entity_id ?? o.increment_id),
        number: String(o.increment_id ?? o.entity_id),
        date: String(o.created_at ?? new Date().toISOString()).slice(0, 10),
        customerName: `${o.customer_firstname ?? ''} ${o.customer_lastname ?? ''}`.trim() || 'Magento Customer',
        customerEmail: String(o.customer_email ?? ''),
        totalExVat: Number(o.subtotal ?? o.grand_total ?? 0),
        currency: String(o.order_currency_code ?? 'NOK').toUpperCase(),
        status: String(o.status ?? 'complete'),
      })),
      storeLabel: new URL(base).hostname,
    };
  }

  if (slug === 'prestashop') {
    const base = assertPublicHttpsBase(fields.storeUrl ?? '');
    const basic = btoa(`${fields.apiKey ?? ''}:`);
    const headers = { authorization: `Basic ${basic}`, accept: 'application/json' };
    const [pBody, oBody] = await Promise.all([
      storeJson(`${base}/api/products?output_format=JSON&display=[id,reference,name,price]&limit=50`, { headers }, 'PrestaShop'),
      storeJson(`${base}/api/orders?output_format=JSON&display=[id,reference,date_add,total_paid_tax_excl,current_state]&limit=50`, { headers }, 'PrestaShop'),
    ]);
    return {
      products: (Array.isArray(pBody.products) ? pBody.products : []).map((/** @type {any} */ p) => ({
        sku: String(p.reference || `PS-${p.id}`).trim(),
        title: String(typeof p.name === 'string' ? p.name : p.name?.[0]?.value ?? `Product ${p.id}`).trim(),
        priceExVat: Number(p.price ?? 0),
        currency: 'NOK',
        stockItem: true,
      })),
      orders: (Array.isArray(oBody.orders) ? oBody.orders : []).map((/** @type {any} */ o) => ({
        id: String(o.id),
        number: String(o.reference ?? o.id),
        date: String(o.date_add ?? new Date().toISOString()).slice(0, 10),
        customerName: `PrestaShop #${o.reference ?? o.id}`,
        customerEmail: '',
        totalExVat: Number(o.total_paid_tax_excl ?? 0),
        currency: 'NOK',
        status: String(o.current_state ?? 'paid'),
      })),
      storeLabel: new URL(base).hostname,
    };
  }

  if (slug === 'shopware') {
    const base = assertPublicHttpsBase(fields.storeUrl ?? '');
    const tok = await storeJson(
      `${base}/api/oauth/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: fields.clientId ?? '',
          client_secret: fields.clientSecret ?? '',
        }),
      },
      'Shopware 6',
    );
    const headers = {
      authorization: `Bearer ${tok.access_token ?? ''}`,
      'content-type': 'application/json',
      accept: 'application/json',
    };
    const [pBody, oBody] = await Promise.all([
      storeJson(`${base}/api/search/product`, { method: 'POST', headers, body: JSON.stringify({ limit: 50 }) }, 'Shopware 6'),
      storeJson(`${base}/api/search/order`, { method: 'POST', headers, body: JSON.stringify({ limit: 50 }) }, 'Shopware 6'),
    ]);
    return {
      products: (Array.isArray(pBody.data) ? pBody.data : []).map((/** @type {any} */ p) => ({
        sku: String(p.productNumber ?? p.id ?? '').trim(),
        title: String(p.name ?? p.translated?.name ?? `Product ${p.productNumber}`).trim(),
        priceExVat: Number(p.price?.[0]?.net ?? 0),
        currency: 'NOK',
        stockItem: true,
      })),
      orders: (Array.isArray(oBody.data) ? oBody.data : []).map((/** @type {any} */ o) => ({
        id: String(o.id),
        number: String(o.orderNumber ?? o.id),
        date: String(o.orderDateTime ?? new Date().toISOString()).slice(0, 10),
        customerName: `${o.orderCustomer?.firstName ?? ''} ${o.orderCustomer?.lastName ?? ''}`.trim() || 'Shopware Customer',
        customerEmail: String(o.orderCustomer?.email ?? ''),
        totalExVat: Number(o.amountNet ?? o.amountTotal ?? 0),
        currency: 'NOK',
        status: String(o.stateMachineState?.technicalName ?? 'completed'),
      })),
      storeLabel: new URL(base).hostname,
    };
  }

  // Wix Stores
  const headers = {
    authorization: fields.apiKey ?? '',
    'wix-site-id': fields.siteId ?? '',
    'content-type': 'application/json',
    accept: 'application/json',
  };
  const [pBody, oBody] = await Promise.all([
    storeJson('https://www.wixapis.com/stores/v1/products/query', { method: 'POST', headers, body: JSON.stringify({ query: { paging: { limit: 50 } } }) }, 'Wix Stores'),
    storeJson('https://www.wixapis.com/ecom/v1/orders/search', { method: 'POST', headers, body: JSON.stringify({ search: { cursorPaging: { limit: 50 } } }) }, 'Wix eCommerce'),
  ]);
  return {
    products: (Array.isArray(pBody.products) ? pBody.products : []).map((/** @type {any} */ p) => ({
      sku: String(p.sku || `WIX-${String(p.id).slice(0, 8)}`).trim(),
      title: String(p.name ?? 'Wix Product').trim(),
      priceExVat: Number(p.priceData?.price ?? p.price?.price ?? 0),
      currency: String(p.priceData?.currency ?? 'NOK').toUpperCase(),
      stockItem: p.productType !== 'digital',
    })),
    orders: (Array.isArray(oBody.orders) ? oBody.orders : []).map((/** @type {any} */ o) => ({
      id: String(o.id),
      number: String(o.number ?? o.id),
      date: String(o.createdDate ?? new Date().toISOString()).slice(0, 10),
      customerName: `${o.billingInfo?.contactDetails?.firstName ?? ''} ${o.billingInfo?.contactDetails?.lastName ?? ''}`.trim() || 'Wix Customer',
      customerEmail: String(o.buyerInfo?.email ?? ''),
      totalExVat: Number(o.priceSummary?.subtotal?.amount ?? o.priceSummary?.total?.amount ?? 0),
      currency: String(o.currency ?? 'NOK').toUpperCase(),
      status: String(o.paymentStatus ?? 'PAID'),
    })),
    storeLabel: `wix:${(fields.siteId ?? '').slice(0, 12)}`,
  };
}

/**
 * @param {StoreConfig} cfg
 * @param {{ storeLabel: string, products: Array<{ item: StoreProduct, exists: boolean }>, orders: Array<{ order: StoreOrder, customerId: number | null, customerLabel: string }>, defaultCustomerId: number, defaultProductId: number, isSample?: boolean }} state
 */
function renderStoreSync(cfg, state) {
  const newProducts = state.products.filter((p) => !p.exists).length;
  const readyOrders = state.orders.filter((o) => o.order.totalExVat > 0 && (o.customerId || state.defaultCustomerId > 0) && state.defaultProductId > 0).length;

  return html`
    <div class="metric-grid">
      ${reaiMetric({ label: 'Store', value: state.storeLabel, detail: state.isSample ? 'Synthetic sample' : `${cfg.brand} API` })}
      ${reaiMetric({ label: 'New products to sync', value: `${newProducts} / ${state.products.length}`, detail: 'Matched by SKU against ReAI' })}
      ${reaiMetric({ label: 'Paid orders scanned', value: `${readyOrders} / ${state.orders.length}`, detail: 'Idempotent import (accounting=none)' })}
    </div>

    ${reaiCard({
      eyebrow: 'PRODUCT SYNC',
      title: `${cfg.brand} products → ReAI`,
      badge: reaiBadge({ text: `${newProducts} new`, tone: newProducts > 0 ? 'success' : 'neutral' }),
      body: html`
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Product title</th>
                <th class="num">Price (ex. VAT)</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${state.products.map(
                ({ item, exists }, idx) => html`<tr id="ec-p-${idx}">
                  <td class="mono">${item.sku || '—'}</td>
                  <td><strong>${item.title}</strong></td>
                  <td class="num">${formatMinor(Math.round(item.priceExVat * 100))} ${item.currency}</td>
                  <td>${exists ? reaiBadge({ text: 'In ReAI', tone: 'neutral' }) : reaiBadge({ text: 'New SKU', tone: 'success' })}</td>
                  <td>
                    ${exists || state.isSample
                      ? html`<span class="muted-note">${state.isSample && !exists ? 'Demo only' : 'Synced'}</span>`
                      : html`<form hx-post="/app/${cfg.slug}/sync-product" hx-target="#ec-p-${idx}" hx-swap="outerHTML">
                          <input type="hidden" name="sku" value="${item.sku}">
                          <input type="hidden" name="title" value="${item.title}">
                          <input type="hidden" name="priceExVat" value="${item.priceExVat.toFixed(2)}">
                          <input type="hidden" name="stockItem" value="${item.stockItem ? '1' : '0'}">
                          <button type="submit" class="button primary">Create in ReAI</button>
                        </form>`}
                  </td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>
      `,
    })}

    ${reaiCard({
      eyebrow: 'SALES SYNC',
      title: `${cfg.brand} paid orders → ReAI`,
      badge: reaiBadge({ text: `${state.orders.length} orders`, tone: 'accent' }),
      body: html`
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Order #</th>
                <th>Date</th>
                <th>Customer</th>
                <th class="num">Total (ex. VAT)</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${state.orders.map(({ order, customerId, customerLabel }, idx) => {
                const targetCustomer = customerId ?? state.defaultCustomerId;
                const canImport = order.totalExVat > 0 && targetCustomer > 0 && state.defaultProductId > 0;
                return html`<tr id="ec-o-${idx}">
                  <td class="mono">${order.number}</td>
                  <td class="mono">${order.date}</td>
                  <td>${customerLabel}</td>
                  <td class="num">${formatMinor(Math.round(order.totalExVat * 100))} ${order.currency}</td>
                  <td>${reaiBadge({ text: order.status, tone: canImport ? 'success' : 'warn' })}</td>
                  <td>
                    ${state.isSample || !canImport
                      ? html`<span class="muted-note">${state.isSample ? 'Demo only' : 'Select fallback customer & product above'}</span>`
                      : html`<form hx-post="/app/${cfg.slug}/sync-order" hx-target="#ec-o-${idx}" hx-swap="outerHTML">
                          <input type="hidden" name="storeLabel" value="${state.storeLabel}">
                          <input type="hidden" name="orderId" value="${order.id}">
                          <input type="hidden" name="orderNumber" value="${order.number}">
                          <input type="hidden" name="orderDate" value="${order.date}">
                          <input type="hidden" name="amount" value="${order.totalExVat.toFixed(2)}">
                          <input type="hidden" name="customerId" value="${targetCustomer}">
                          <input type="hidden" name="productId" value="${state.defaultProductId}">
                          <button type="submit" class="button primary">Import order</button>
                        </form>`}
                  </td>
                </tr>`;
              })}
            </tbody>
          </table>
        </div>
      `,
    })}
  `;
}

/**
 * Handles /app/{mystore,24nettbutikk,magento,prestashop,shopware,wix}/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @param {EcommerceSlug} slug
 * @returns {Promise<Response>}
 */
export async function handleEcommerce(request, env, slug) {
  const cfg = STORES[slug];
  const { pathname } = new URL(request.url);
  const basePath = `/app/${slug}`;

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  }

  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    /** @type {ReAICustomer[]} */
    let customers = [];
    /** @type {ReAIProduct[]} */
    let products = [];
    if (session && session.tenantId > 0) {
      try {
        const [c, p] = await Promise.all([
          reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId, query: { archived: 'false' } }),
          reaiAll(env, '/api/products', { token: session.accessToken, tenantId: session.tenantId }),
        ]);
        customers = /** @type {ReAICustomer[]} */ (c);
        products = /** @type {ReAIProduct[]} */ (p).filter((x) => !x.archived);
      } catch {
        customers = [];
        products = [];
      }
    }

    const body = html`
      <section class="app-intro">
        <p class="eyebrow">ECOMMERCE · PRODUCT & SALES SYNC</p>
        <h1>${cfg.title}</h1>
        <p class="lead">${cfg.lead}</p>
      </section>

      <div class="stack">
        ${renderConnectPanel(session, { clientId: cfg.clientId, clientName: cfg.clientName })}

        ${reaiCard({
          eyebrow: 'CONNECT STORE',
          title: `Scan ${cfg.brand} products & orders`,
          body: html`
            <p class="muted-note">${cfg.hint} Credentials are used only for this request and never stored.</p>
            <form class="stack" hx-post="${basePath}/scan" hx-target="#ec-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                ${cfg.fields.map(
                  (f) => html`<div class="field">
                    <label for="ec-${f.key}">${f.label}</label>
                    <input id="ec-${f.key}" name="${f.key}" type="${f.secret ? 'password' : 'text'}" autocomplete="off" required placeholder="${f.placeholder}">
                  </div>`,
                )}
                <div class="field">
                  <label for="ec-cust">Default webshop customer in ReAI</label>
                  <select id="ec-cust" name="defaultCustomerId">
                    <option value="0">${customers.length > 0 ? 'Choose fallback customer…' : 'Connect to ReAI first'}</option>
                    ${customers.slice(0, 200).map((c) => html`<option value="${c.id}">${c.name}</option>`)}
                  </select>
                </div>
                <div class="field">
                  <label for="ec-prod">Default sales line product in ReAI</label>
                  <select id="ec-prod" name="defaultProductId">
                    <option value="0">${products.length > 0 ? 'Choose product…' : 'Connect to ReAI first'}</option>
                    ${products.slice(0, 200).map((p) => html`<option value="${p.id}">${p.title}</option>`)}
                  </select>
                </div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Scan ${cfg.brand} catalog & orders</button>
                <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#ec-output" hx-swap="innerHTML">Load sample sync</button>
              </div>
            </form>
          `,
        })}

        <div id="ec-output" class="stack"></div>
      </div>
    `;

    return htmlResponse(
      appShell({
        title: cfg.title,
        description: cfg.lead,
        activePath: `${basePath}/`,
        body,
      }),
    );
  }

  if (request.method !== 'POST') {
    return errorResponse('Method not allowed.', 405);
  }
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  if (pathname === `${basePath}/sample`) {
    const prefix = slug.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    return htmlResponse(
      renderStoreSync(cfg, {
        storeLabel: `demo.${slug}.no`,
        defaultCustomerId: 1,
        defaultProductId: 10,
        isSample: true,
        products: [
          { item: { sku: `${prefix}-1001`, title: 'Merino Wool Base Layer', priceExVat: 792, currency: 'NOK', stockItem: true }, exists: true },
          { item: { sku: `${prefix}-1002`, title: 'Nordic Rain Shell Jacket', priceExVat: 1992, currency: 'NOK', stockItem: true }, exists: false },
          { item: { sku: `${prefix}-1003`, title: 'Insulated Travel Bottle 750ml', priceExVat: 312, currency: 'NOK', stockItem: true }, exists: false },
        ],
        orders: [
          { order: { id: '9001', number: `${prefix}-2026-410`, date: '2026-10-14', customerName: 'Kari Nordmann', customerEmail: 'kari@example.no', totalExVat: 1992, currency: 'NOK', status: 'paid' }, customerId: 1, customerLabel: 'Kari Nordmann (matched)' },
          { order: { id: '9002', number: `${prefix}-2026-411`, date: '2026-10-15', customerName: 'Ola Hansen', customerEmail: 'ola@example.no', totalExVat: 1104, currency: 'NOK', status: 'paid' }, customerId: null, customerLabel: 'Ola Hansen (default webshop customer)' },
        ],
      }),
    );
  }

  try {
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) {
      throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    }
    const company = session.tenants.find((t) => t.id === session.tenantId);
    if (!company) {
      throw new HttpError(400, 'Select a valid ReAI company.');
    }
    const form = await request.formData();

    if (pathname === `${basePath}/scan`) {
      /** @type {Record<string, string>} */
      const fields = {};
      for (const f of cfg.fields) {
        const v = String(form.get(f.key) ?? '').trim();
        if (!v) {
          throw new HttpError(400, `Enter ${f.label}.`);
        }
        fields[f.key] = v;
      }
      const defaultCustomerId = Number(form.get('defaultCustomerId') ?? '0');
      const defaultProductId = Number(form.get('defaultProductId') ?? '0');

      const [storeData, reaiProducts, reaiCustomers] = await Promise.all([
        fetchStoreCatalogAndOrders(slug, fields),
        reaiAll(env, '/api/products', { token: session.accessToken, tenantId: company.id }),
        reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: company.id, query: { archived: 'false' } }),
      ]);

      const existingSkus = new Set();
      for (const p of /** @type {ReAIProduct[]} */ (reaiProducts)) {
        for (const v of p.variants ?? []) {
          if (v.sku) {
            existingSkus.add(v.sku.trim().toLowerCase());
          }
        }
      }
      const custs = /** @type {ReAICustomer[]} */ (reaiCustomers);

      return htmlResponse(
        renderStoreSync(cfg, {
          storeLabel: storeData.storeLabel,
          defaultCustomerId,
          defaultProductId,
          products: storeData.products.map((item) => ({
            item,
            exists: Boolean(item.sku && existingSkus.has(item.sku.trim().toLowerCase())),
          })),
          orders: storeData.orders.map((order) => {
            const email = order.customerEmail.trim().toLowerCase();
            const match = email
              ? custs.find((c) => (c.email ?? '').trim().toLowerCase() === email || (c.invoiceEmail ?? '').trim().toLowerCase() === email)
              : undefined;
            return {
              order,
              customerId: match?.id ?? null,
              customerLabel: match ? `${match.name} (matched)` : order.customerName,
            };
          }),
        }),
      );
    }

    if (pathname === `${basePath}/sync-product`) {
      const sku = String(form.get('sku') ?? '').trim();
      const title = String(form.get('title') ?? '').trim();
      const priceExVat = Number(form.get('priceExVat') ?? '0');
      const stockItem = form.get('stockItem') !== '0';
      if (!sku || !title) {
        throw new HttpError(400, 'SKU and title are required.');
      }
      const created = /** @type {{ id: number }} */ (
        await reaiRequest(env, '/api/products', {
          token: session.accessToken,
          tenantId: company.id,
          method: 'POST',
          body: {
            title,
            stockItem,
            variants: [{ sku, sellingPrice: Number.isFinite(priceExVat) && priceExVat >= 0 ? priceExVat : 0 }],
          },
        })
      );
      return htmlResponse(html`<tr>
        <td class="mono">${sku}</td>
        <td><strong>${title}</strong></td>
        <td class="num">${formatMinor(Math.round(priceExVat * 100))} ${company.currencyCode}</td>
        <td>${reaiBadge({ text: `Created #${created.id}`, tone: 'success' })}</td>
        <td><span class="muted-note">Synced</span></td>
      </tr>`);
    }

    if (pathname === `${basePath}/sync-order`) {
      const storeLabel = String(form.get('storeLabel') ?? slug).slice(0, 80);
      const orderId = String(form.get('orderId') ?? '').trim();
      const orderNumber = String(form.get('orderNumber') ?? orderId).trim();
      const orderDate = String(form.get('orderDate') ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
      const amount = Number(form.get('amount') ?? '0');
      const customerId = Number(form.get('customerId') ?? '0');
      const productId = Number(form.get('productId') ?? '0');
      if (!orderId || amount <= 0 || customerId <= 0 || productId <= 0) {
        throw new HttpError(400, 'Order ID, positive amount, customer and product are required.');
      }
      const imported = /** @type {{ id: number }} */ (
        await reaiRequest(env, '/api/invoices/import', {
          token: session.accessToken,
          tenantId: company.id,
          method: 'POST',
          body: {
            source: slug,
            sourceInstance: storeLabel,
            externalId: orderId,
            number: `${slug.toUpperCase()}-${orderNumber}`,
            issueDate: orderDate,
            dueDate: orderDate,
            accounting: 'none',
            automaticRemindersEnabled: false,
            customerId,
            comment: `Imported from ${cfg.brand} (${storeLabel}) order #${orderNumber}.`,
            orderItems: [{ productId, quantity: 1, price: Number(amount.toFixed(2)), currencyCode: company.currencyCode }],
            payments: [{ date: orderDate, paidAmount: Number(amount.toFixed(2)), receivedAmount: Number(amount.toFixed(2)) }],
          },
        })
      );
      const url = `${reaiOrigin(env)}/invoice/${imported.id}?tenantId=${company.id}`;
      return htmlResponse(html`<tr>
        <td class="mono">${orderNumber}</td>
        <td class="mono">${orderDate}</td>
        <td>Customer #${customerId}</td>
        <td class="num">${formatMinor(Math.round(amount * 100))} ${company.currencyCode}</td>
        <td>${reaiBadge({ text: `Imported #${imported.id}`, tone: 'success' })}</td>
        <td><a href="${url}" target="_blank" rel="noopener">Open in ReAI ↗</a></td>
      </tr>`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : `${cfg.brand} sync failed.`;
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${cfg.brand} error`, body: msg }));
  }

  return errorResponse(`Unknown ${cfg.brand} route.`, 404);
}
