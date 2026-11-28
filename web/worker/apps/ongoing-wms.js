// @ts-check
import { fetchJson } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard } from '../lib/ui.js';

/** @typedef {{ sku: string, name: string, price: number, cost: number, barcode: string, stock: number }} WmsArticle */

/**
 * Reads the goods owner's articles from the Ongoing WMS Goods Owner REST API.
 * Docs: https://developer.ongoingwarehouse.com/REST/v1/index.html (base https://api.ongoingsystems.se/{warehouse}/api/v1/,
 * HTTP Basic or an OAuth 2.0 bearer token from the goods owner API user, GET /articles with goodsOwnerId, articleSystemIdFrom and maxArticlesToGet;
 * response fields articleSystemId, articleNumber, articleName, isActive, customerPrice, purchasePrice,
 * barCodeInfo.barCode, inventoryInfo.numberOfItems) and https://docs.ongoingwarehouse.com/manuals/api-access (API user from the warehouse).
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<WmsArticle[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const warehouse = (creds.warehouse ?? '').trim();
  const goodsOwnerId = (creds.goodsOwnerId ?? '').trim();
  const username = (creds.username ?? '').trim();
  const password = creds.password ?? '';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(warehouse)) throw new HttpError(400, 'Enter the warehouse name from your Ongoing WMS login address.');
  if (!/^[0-9]+$/.test(goodsOwnerId) || !username || !password) throw new HttpError(400, 'Enter the goods owner ID and the API user credentials from your warehouse.');
  let authorization = `Basic ${btoa(`${username}:${password}`)}`;
  if (creds.authType === 'oauth') {
    const token = await fetchJson('https://login.ongoingwms.com/connect/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: username, client_secret: password, scope: 'goodsowner:articles:read' }).toString(),
    }, 'Ongoing WMS', fetchImpl);
    if (typeof token?.access_token !== 'string') throw new HttpError(400, 'Ongoing WMS did not return an access token. Check the client ID and secret.');
    authorization = `Bearer ${token.access_token}`;
  }
  const headers = { authorization, accept: 'application/json' };
  /** @type {WmsArticle[]} */
  const out = [];
  let from = 0;
  for (let page = 0; page < 10; page++) {
    const url = new URL(`https://api.ongoingsystems.se/${encodeURIComponent(warehouse)}/api/v1/articles`);
    url.searchParams.set('goodsOwnerId', goodsOwnerId);
    url.searchParams.set('articleSystemIdFrom', String(from));
    url.searchParams.set('maxArticlesToGet', '200');
    const data = await fetchJson(url.toString(), { headers }, 'Ongoing WMS', fetchImpl);
    /** @type {any[]} */ const items = Array.isArray(data) ? data : [];
    for (const a of items) {
      const sku = String(a.articleNumber ?? '').trim();
      if (!sku || a.isActive === false) continue;
      out.push({
        sku,
        name: String(a.articleName ?? sku).trim() || sku,
        price: Number(a.customerPrice ?? 0) || 0,
        cost: Number(a.purchasePrice ?? 0) || 0,
        barcode: String(a.barCodeInfo?.barCode ?? '').trim(),
        stock: Number(a.inventoryInfo?.numberOfItems ?? 0) || 0,
      });
    }
    if (items.length < 200) break;
    from = Math.max(...items.map((a) => Number(a.articleSystemId ?? 0))) + 1;
  }
  return out;
}

/**
 * @param {Array<{ sku: string, name: string, price: number, cost?: number, barcode?: string, stock: number, exists: boolean }>} articles
 * @param {boolean} isSample
 */
function renderWms(articles, isSample) {
  return reaiCard({
    eyebrow: 'ONGOING WMS → REAI PRODUCTS',
    title: `${articles.length} warehouse articles scanned`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${articles.filter((a) => !a.exists).length} new SKUs`, tone: 'success' }),
    body: html`<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Article / SKU</th><th>Name</th><th class="num">3PL Stock</th><th class="num">Price (NOK)</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>${articles.map(
        (a, idx) => html`<tr id="og-row-${idx}">
          <td class="mono">${a.sku}</td><td><strong>${a.name}</strong></td><td class="num">${a.stock}</td><td class="num">${formatMinor(Math.round(a.price * 100))}</td>
          <td>${a.exists ? reaiBadge({ text: 'In ReAI', tone: 'neutral' }) : reaiBadge({ text: 'New SKU', tone: 'success' })}</td>
          <td>${a.exists || isSample
            ? html`<span class="muted-note">${isSample && !a.exists ? 'Demo only' : 'Synced'}</span>`
            : html`<form hx-post="/app/ongoing-wms/sync-article" hx-target="#og-row-${idx}" hx-swap="outerHTML">
                <input type="hidden" name="sku" value="${a.sku}"><input type="hidden" name="name" value="${a.name}"><input type="hidden" name="price" value="${a.price.toFixed(2)}"><input type="hidden" name="cost" value="${(a.cost ?? 0).toFixed(2)}"><input type="hidden" name="barcode" value="${a.barcode ?? ''}">
                <button type="submit" class="button primary">Create in ReAI</button>
              </form>`}</td>
        </tr>`,
      )}</tbody>
    </table></div>`,
  });
}

/**
 * Handles /app/ongoing-wms/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/ongoing-wms';
  const title = 'Ongoing WMS Warehouse Sync';
  const lead = 'Read the articles your warehouse keeps for you in Ongoing WMS and create the missing ones as ReAI products by article number.';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">3PL WAREHOUSE & LOGISTICS (WMS)</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-ongoing-wms-web', clientName: `ReAI ${title} (Web)` })}
        ${reaiCard({
          eyebrow: 'ONGOING WMS REST API',
          title: 'Scan Ongoing WMS warehouse articles',
          body: html`<p class="muted-note">Ask your warehouse for the goods owner ID and a goods owner API user. Credentials are used only for this request and are never stored.</p>
            <form class="stack" hx-post="/app/ongoing-wms/scan" hx-target="#vt-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="og-wh">Warehouse name</label><input id="og-wh" name="warehouse" type="text" required pattern="[A-Za-z0-9_-]+" placeholder="From https://{warehouse}.ongoingsystems.se/{warehouse}"></div>
                <div class="field"><label for="og-owner">Goods Owner ID</label><input id="og-owner" name="goodsOwnerId" type="number" min="1" required placeholder="42"></div>
                <div class="field"><label for="og-auth">API user type</label><select id="og-auth" name="authType"><option value="oauth">OAuth (client ID and secret)</option><option value="basic">Basic (user name and password)</option></select></div>
                <div class="field"><label for="og-user">Client ID or user name</label><input id="og-user" name="username" type="text" required placeholder="From the API user"></div>
                <div class="field"><label for="og-pass">Client secret or password</label><input id="og-pass" name="password" type="password" autocomplete="off" required placeholder="From the API user"></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Scan Ongoing WMS SKUs</button>
                <button type="button" class="button secondary" hx-post="/app/ongoing-wms/sample" hx-target="#vt-output" hx-swap="innerHTML">Load sample warehouse</button>
              </div>
            </form>`,
        })}
        <div id="vt-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${basePath}/sample`) {
    return htmlResponse(renderWms([
      { sku: 'OG-1001', name: 'Nordic Wool Beanie (Black)', price: 399, stock: 148, exists: true },
      { sku: 'OG-1002', name: 'Alpine Insulated Flask 1L', price: 549, stock: 64, exists: false },
      { sku: 'OG-1003', name: 'Waterproof Trail Pack 28L', price: 1490, stock: 22, exists: false },
    ], true));
  }

  try {
    const form = await request.formData();
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');

    if (pathname === `${basePath}/scan`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const k of ['warehouse', 'goodsOwnerId', 'authType', 'username', 'password']) creds[k] = String(form.get(k) ?? '');
      const [wItems, pRaw] = await Promise.all([
        fetchApi(creds),
        reaiAll(env, '/api/products', { token: session.accessToken, tenantId: session.tenantId }),
      ]);
      const skus = new Set();
      for (const p of /** @type {Array<{ variants?: Array<{ sku?: string | null }> }>} */ (pRaw)) {
        for (const v of p.variants ?? []) if (v.sku) skus.add(v.sku.trim().toLowerCase());
      }
      const articles = wItems.map((a) => ({ ...a, exists: skus.has(a.sku.toLowerCase()) }));
      return htmlResponse(renderWms(articles, false));
    }

    if (pathname === `${basePath}/sync-article`) {
      const sku = String(form.get('sku') ?? '').trim();
      const name = String(form.get('name') ?? '').trim();
      const price = Number(form.get('price') ?? '0');
      const cost = Number(form.get('cost') ?? '0');
      const barcode = String(form.get('barcode') ?? '').trim();
      if (!sku || !name) throw new HttpError(400, 'The article needs an article number and a name.');
      const created = /** @type {{ id: number }} */ (
        await reaiRequest(env, '/api/products', {
          token: session.accessToken, tenantId: session.tenantId, method: 'POST',
          body: { title: name, stockItem: true, variants: [{ sku, sellingPrice: price >= 0 ? price : 0, ...(cost > 0 ? { costPrice: cost } : {}), ...(barcode ? { barcode } : {}) }] },
        })
      );
      return htmlResponse(html`<tr><td class="mono">${sku}</td><td><strong>${name}</strong></td><td class="num">—</td><td class="num">${formatMinor(Math.round(price * 100))}</td><td>${reaiBadge({ text: `Created #${created.id}`, tone: 'success' })}</td><td><span class="muted-note">Synced</span></td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Ongoing WMS error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown Ongoing WMS route.', 404);
}
