// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * Handles /app/stock-count/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/stock-count';
  const title = 'Warehouse Inventory & Stocktake Console';
  const lead = 'Inspect live stock-on-hand, SKU cost value and retail value across every ReAI warehouse (GET /api/warehouses & GET /api/warehouses/inventory) on desktop or mobile.';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">REAI WAREHOUSES & INVENTORY VALUATION</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-stock-count-web', clientName: 'ReAI Warehouse Stock Count (Web)' })}
        ${reaiCard({
          eyebrow: 'LIVE REAI DATA · WAREHOUSE STOCK COUNT',
          title: 'Fetch live inventory valuation from your connected ReAI company',
          body: html`<div class="inline-row">
            <button type="button" class="button primary" hx-post="${basePath}/live" hx-target="#pw-output" hx-swap="innerHTML">Load live from ReAI</button>
            <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#pw-output" hx-swap="innerHTML">Load sample dashboard</button>
          </div>`,
        })}
        <div id="pw-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${basePath}/sample`) {
    return htmlResponse(reaiCard({ eyebrow: 'WAREHOUSE STOCK COUNT SAMPLE', title: 'Live ReAI Inventory preview', badge: reaiBadge({ text: 'Sample', tone: 'accent' }), body: html`<div class="metric-grid">${reaiMetric({ label: 'SKUs tracked', value: '42', detail: 'GET /api/warehouses/inventory' })}${reaiMetric({ label: 'Stock cost value', value: '485 200,00 NOK', detail: 'NS 4102 account 1460' })}${reaiMetric({ label: 'Add-on fee', value: '0 NOK', detail: 'Included free with ReAI' })}</div>` }));
  }

  try {
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    if (pathname === `${basePath}/live`) {
      const inv = /** @type {{ rows?: any[], totalStockValue?: number, totalRetailValue?: number }} */ (await reaiRequest(env, '/api/warehouses/inventory', { token: session.accessToken, tenantId: session.tenantId }));
      const rows = inv.rows ?? [];
      return htmlResponse(reaiCard({
        eyebrow: 'LIVE WAREHOUSE STOCK VALUATION', title: `${rows.length} stocked SKUs`, badge: reaiBadge({ text: 'Live API', tone: 'success' }),
        body: html`<div class="metric-grid">${reaiMetric({ label: 'Total stock value (cost)', value: `${formatMinor(Math.round(Number(inv.totalStockValue ?? 0) * 100))} NOK`, detail: 'NS 4102 account 1460' })}${reaiMetric({ label: 'Total retail value', value: `${formatMinor(Math.round(Number(inv.totalRetailValue ?? 0) * 100))} NOK`, detail: 'Ex. VAT' })}${reaiMetric({ label: 'SKUs tracked', value: String(rows.length), detail: 'GET /api/warehouses/inventory' })}</div>
          <div class="table-wrap"><table class="data-table"><thead><tr><th>SKU</th><th>Product</th><th class="num">Qty on hand</th><th class="num">Unit cost</th><th class="num">Stock value</th></tr></thead>
          <tbody>${rows.slice(0, 150).map((r) => html`<tr><td class="mono">${r.sku || '—'}</td><td><strong>${r.productTitle}</strong></td><td class="num">${r.quantityOnHand}</td><td class="num">${Number(r.stockUnitCost ?? 0).toFixed(2)}</td><td class="num"><strong>${Number(r.stockValue ?? 0).toFixed(2)}</strong></td></tr>`)}</tbody></table></div>`,
      }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Warehouse Stock Count error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
