// @ts-check
import { fetchJson, num } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/**
 * @typedef {{ sku: string, name: string, barcode: string, salesPrice: number, costPrice: number, stock: number }} RackbeatProduct
 * @typedef {{ product: RackbeatProduct, exists: boolean }} ProductRow
 */

const BRAND = 'Rackbeat';
const TITLE = 'Rackbeat Product Sync';
const LEAD = 'Compare the Rackbeat product register with ReAI Products by SKU and create missing products with sales price, cost price and barcode.';
const BASE = '/app/rackbeat';
const RACKBEAT_API = 'https://app.rackbeat.com/api';
const PAGE_LIMIT = 100;
const MAX_PAGES = 50;

/**
 * Fetches all sellable, non barred Rackbeat products.
 * Docs:
 * - https://developer.rackbeat.com/reference/authentication-1 (Company settings > API, Authorization: Bearer)
 * - https://developer.rackbeat.com/reference/getproducts (GET https://app.rackbeat.com/api/products, is_barred filter, response `products[]`)
 * - https://developer.rackbeat.com/reference/pagination (page/limit, `pages`, HTTP 206 Partial Content)
 * - https://developer.rackbeat.com/reference/customizable-requests (`fields` selection)
 * @param {Record<string, string>} creds `apiToken`
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<RackbeatProduct[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  if (!token) throw new HttpError(400, 'Enter your Rackbeat API key.');
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json' };
  /** @type {RackbeatProduct[]} */
  const products = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await fetchJson(
      `${RACKBEAT_API}/products?fields=number,name,barcode,sales_price,cost_price,stock_quantity,is_barred&is_barred=false&page=${page}&limit=${PAGE_LIMIT}`,
      { headers },
      BRAND,
      fetchImpl,
    );
    const rows = Array.isArray(data?.products) ? data.products : [];
    for (const p of rows) {
      const sku = String(p?.number ?? '').trim();
      if (!sku || p.is_barred === true) continue;
      products.push({
        sku,
        name: String(p.name ?? sku).trim() || sku,
        barcode: String(p.barcode ?? '').trim(),
        salesPrice: num(p.sales_price),
        costPrice: num(p.cost_price),
        stock: num(p.stock_quantity),
      });
    }
    const pages = Number(data?.pages ?? 1);
    if (rows.length === 0 || page >= pages) break;
  }
  return products;
}

/**
 * @param {ProductRow[]} rows
 * @param {boolean} isSample
 */
function renderScan(rows, isSample) {
  const missing = rows.filter((r) => !r.exists).length;
  return html`
    <div class="metric-grid">
      ${reaiMetric({ label: 'Rackbeat products', value: String(rows.length), detail: 'Sellable, not barred' })}
      ${reaiMetric({ label: 'Missing in ReAI', value: String(missing), detail: 'Matched on SKU (Rackbeat number)' })}
      ${reaiMetric({ label: 'Already in ReAI', value: String(rows.length - missing), detail: 'Left unchanged' })}
    </div>
    ${reaiCard({
      eyebrow: 'RACKBEAT PRODUCTS → REAI PRODUCTS',
      title: 'Product register',
      badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${missing} missing`, tone: missing > 0 ? 'warn' : 'success' }),
      body: rows.length === 0
        ? reaiCallout({ tone: 'info', body: 'No sellable Rackbeat products were returned for this API key.' })
        : html`<div class="table-wrap"><table class="data-table">
          <thead><tr><th>SKU</th><th>Name</th><th class="num">Sales price</th><th class="num">Cost price</th><th class="num">Rackbeat stock</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>${rows.slice(0, 500).map(({ product: p, exists }, idx) => html`<tr id="rb-row-${idx}">
            <td class="mono">${p.sku}</td><td><strong>${p.name}</strong></td>
            <td class="num">${formatMinor(Math.round(p.salesPrice * 100))}</td><td class="num">${formatMinor(Math.round(p.costPrice * 100))}</td><td class="num">${p.stock}</td>
            <td>${exists ? reaiBadge({ text: 'In ReAI', tone: 'neutral' }) : reaiBadge({ text: 'Missing', tone: 'warn' })}</td>
            <td>${exists || isSample
              ? html`<span class="muted-note">${isSample && !exists ? 'Demo only' : 'No action'}</span>`
              : html`<form hx-post="${BASE}/sync-product" hx-target="#rb-row-${idx}" hx-swap="outerHTML">
                  <input type="hidden" name="productJson" value="${JSON.stringify(p)}">
                  <button type="submit" class="button primary">Create in ReAI</button>
                </form>`}</td>
          </tr>`)}</tbody>
        </table></div>
        ${rows.length > 500 ? html`<p class="muted-note">Showing the first 500 of ${rows.length} products.</p>` : ''}
        <p class="muted-note">ReAI products are created as stock items with SKU, sales price, cost price and barcode. Stock quantities are shown for reference only and are not posted to ReAI.</p>`,
    })}
  `;
}

/**
 * Handles /app/rackbeat/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE}/`, request.url), 301);
  if (pathname === `${BASE}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">INVENTORY & WAREHOUSE</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-rackbeat-web', clientName: 'ReAI Rackbeat Product Sync (Web)' })}
        ${reaiCard({
          eyebrow: 'RACKBEAT REST API',
          title: 'Scan Rackbeat products',
          body: html`
            <p class="muted-note">Create a key in Rackbeat under Company settings, API. Read access to items and products is enough. The key is used only for this request and is never stored.</p>
            <form class="stack" hx-post="${BASE}/scan" hx-target="#rb-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="rb-token">Rackbeat API key</label><input id="rb-token" name="apiToken" type="password" autocomplete="off" required placeholder="Bearer token"></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Scan Rackbeat products</button>
                <button type="button" class="button secondary" hx-post="${BASE}/sample" hx-target="#rb-output" hx-swap="innerHTML">Load sample products</button>
              </div>
            </form>
          `,
        })}
        <div id="rb-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${BASE}/sample`) {
    return htmlResponse(renderScan([
      { product: { sku: '1001', name: 'Galvanised shelf bracket 300 mm', barcode: '7090000000011', salesPrice: 149, costPrice: 62.5, stock: 420 }, exists: true },
      { product: { sku: '1002', name: 'Steel shelf 1200 x 400 mm', barcode: '7090000000028', salesPrice: 690, costPrice: 312, stock: 85 }, exists: false },
      { product: { sku: '1003', name: 'Pallet rack beam 2700 mm', barcode: '', salesPrice: 1290, costPrice: 640, stock: 12 }, exists: false },
    ], true));
  }

  try {
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    const form = await request.formData();

    if (pathname === `${BASE}/scan`) {
      const [products, reaiProducts] = await Promise.all([
        fetchApi({ apiToken: String(form.get('apiToken') ?? '') }),
        /** @type {Promise<Array<{ variants?: Array<{ sku?: string | null }> }>>} */ (reaiAll(env, '/api/products', { token: session.accessToken, tenantId: session.tenantId })),
      ]);
      const skus = new Set();
      for (const p of reaiProducts) for (const v of p.variants ?? []) if (v.sku) skus.add(v.sku.trim().toLowerCase());
      return htmlResponse(renderScan(products.map((product) => ({ product, exists: skus.has(product.sku.toLowerCase()) })), false));
    }

    if (pathname === `${BASE}/sync-product`) {
      const p = /** @type {RackbeatProduct} */ (JSON.parse(String(form.get('productJson') ?? '{}')));
      const sku = String(p.sku ?? '').trim();
      const name = String(p.name ?? '').trim().slice(0, 250) || sku;
      if (!sku) throw new HttpError(400, 'Missing SKU.');
      const existing = /** @type {Array<{ id: number, webUrl: string, variants?: Array<{ sku?: string | null }> }>} */ (
        await reaiAll(env, '/api/products', { token: session.accessToken, tenantId: session.tenantId, query: { query: sku } })
      );
      const dup = existing.find((x) => (x.variants ?? []).some((v) => (v.sku ?? '').trim().toLowerCase() === sku.toLowerCase()));
      if (dup) {
        return htmlResponse(html`<tr><td class="mono">${sku}</td><td><strong>${name}</strong></td><td class="num"></td><td class="num"></td><td class="num"></td><td>${reaiBadge({ text: 'Already in ReAI', tone: 'neutral' })}</td><td><a href="${dup.webUrl}" target="_blank" rel="noopener">Product #${dup.id}</a></td></tr>`);
      }
      const variant = /** @type {Record<string, unknown>} */ ({ sku, sellingPrice: Math.max(0, num(p.salesPrice)), costPrice: Math.max(0, num(p.costPrice)) });
      if (p.barcode) variant.barcode = String(p.barcode);
      const created = /** @type {{ id: number, webUrl: string }} */ (await reaiRequest(env, '/api/products', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { title: name, stockItem: true, variants: [variant] } }));
      return htmlResponse(html`<tr><td class="mono">${sku}</td><td><strong>${name}</strong></td><td class="num">${formatMinor(Math.round(num(p.salesPrice) * 100))}</td><td class="num">${formatMinor(Math.round(num(p.costPrice) * 100))}</td><td class="num">${num(p.stock)}</td><td>${reaiBadge({ text: `Created #${created.id}`, tone: 'success' })}</td><td><a href="${created.webUrl}" target="_blank" rel="noopener">Open in ReAI</a></td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Rackbeat sync failed.' }));
  }
  return errorResponse('Unknown Rackbeat route.', 404);
}
