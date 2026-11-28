// @ts-check
import { assertPublicHttpsUrl } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard } from '../lib/ui.js';

/**
 * @param {Array<{ sku: string, name: string, price: number, stock: number, exists: boolean }>} articles
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
                <input type="hidden" name="sku" value="${a.sku}"><input type="hidden" name="name" value="${a.name}"><input type="hidden" name="price" value="${a.price.toFixed(2)}">
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
  const lead = 'Sync Ongoing WMS 3PL warehouse articles into ReAI Products by SKU and verify stock & order fulfillment across Nordic warehouses.';

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
          body: html`<p class="muted-note">Connect your Ongoing WMS REST API credentials (used only for this request, never stored) to diff warehouse SKUs against ReAI Products.</p>
            <form class="stack" hx-post="/app/ongoing-wms/scan" hx-target="#vt-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="og-base">Ongoing WMS API URL</label><input id="og-base" name="baseUrl" type="url" required placeholder="https://api.ongoingsystems.se/warehouse/api/v1"></div>
                <div class="field"><label for="og-owner">Goods Owner ID</label><input id="og-owner" name="goodsOwnerId" type="number" min="1" required placeholder="42"></div>
                <div class="field"><label for="og-user">API Username</label><input id="og-user" name="username" type="text" required placeholder="WSI user"></div>
                <div class="field"><label for="og-pass">API Password</label><input id="og-pass" name="password" type="password" autocomplete="off" required placeholder="WSI password"></div>
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
      const parsed = assertPublicHttpsUrl(String(form.get('baseUrl') ?? ''));
      const goodsOwnerId = Number(form.get('goodsOwnerId') ?? '0');
      const auth = btoa(`${String(form.get('username') ?? '')}:${String(form.get('password') ?? '')}`);
      const url = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}/articles?goodsOwnerId=${goodsOwnerId}&maxArticlesToGet=50`;
      const [wRes, pRaw] = await Promise.all([
        fetch(url, { headers: { authorization: `Basic ${auth}`, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(20_000) }),
        reaiAll(env, '/api/products', { token: session.accessToken, tenantId: session.tenantId }),
      ]);
      if (!wRes.ok) throw new HttpError(400, `Ongoing WMS returned HTTP ${wRes.status}. Verify Goods Owner ID and credentials.`);
      const wItems = /** @type {Array<any>} */ (await wRes.json());
      const skus = new Set();
      for (const p of /** @type {Array<{ variants?: Array<{ sku?: string | null }> }>} */ (pRaw)) {
        for (const v of p.variants ?? []) if (v.sku) skus.add(v.sku.trim().toLowerCase());
      }
      const articles = (Array.isArray(wItems) ? wItems : []).map((a) => ({
        sku: String(a.articleNumber ?? a.articleSystemId ?? '').trim(),
        name: String(a.articleName ?? a.articleNumber ?? 'Article').trim(),
        price: Number(a.price ?? 0),
        stock: Number(a.inventoryInfo?.numberOfItems ?? 0),
        exists: Boolean(a.articleNumber && skus.has(String(a.articleNumber).trim().toLowerCase())),
      }));
      return htmlResponse(renderWms(articles, false));
    }

    if (pathname === `${basePath}/sync-article`) {
      const sku = String(form.get('sku') ?? '').trim();
      const name = String(form.get('name') ?? '').trim();
      const price = Number(form.get('price') ?? '0');
      const created = /** @type {{ id: number }} */ (
        await reaiRequest(env, '/api/products', {
          token: session.accessToken, tenantId: session.tenantId, method: 'POST',
          body: { title: name, stockItem: true, variants: [{ sku, sellingPrice: price >= 0 ? price : 0 }] },
        })
      );
      return htmlResponse(html`<tr><td class="mono">${sku}</td><td><strong>${name}</strong></td><td class="num">—</td><td class="num">${formatMinor(Math.round(price * 100))}</td><td>${reaiBadge({ text: `Created #${created.id}`, tone: 'success' })}</td><td><span class="muted-note">Synced</span></td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Ongoing WMS error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown Ongoing WMS route.', 404);
}
