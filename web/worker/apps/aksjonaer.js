// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/**
 * Handles /app/aksjonaer/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/aksjonaer';
  const title = 'Norwegian Equity & Share Investment Importer';
  const lead = 'Import Norwegian listed/unlisted share holdings (Nordnet, VPS, DNB, RF-1086 CSV) directly into ReAI Share Investments (POST /api/share-investments) with fritaksmetoden tagging.';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">NORDNET / VPS / DNB → REAI SHARE INVESTMENTS</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-aksjonaer-web', clientName: 'ReAI Aksjonær & Investments (Web)' })}
        ${reaiCard({
          eyebrow: 'UPLOAD SHARE PORTFOLIO CSV OR LOAD LIVE HOLDINGS',
          title: 'Import equity holdings to /api/share-investments',
          body: html`<form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#pw-output" hx-swap="innerHTML">
            ${reaiDropzone({ inputId: 'ak-csv', name: 'file', accept: '.csv,text/csv', label: 'Choose portfolio CSV', hint: 'Columns: Name, Ticker, ISIN, Type, Account (1350/1810), Quantity, CostAmount, Date, Exemption.' })}
            <div class="inline-row">
              <button type="submit" class="button primary">Preview portfolio CSV</button>
              <button type="button" class="button secondary" hx-post="${basePath}/live" hx-target="#pw-output" hx-swap="innerHTML">Load live ReAI holdings</button>
              <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#pw-output" hx-swap="innerHTML">Load sample portfolio</button>
            </div>
          </form>`,
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
    return htmlResponse(reaiCard({
      eyebrow: 'AKSJONÆR & INVESTMENTS SAMPLE',
      title: 'Live ReAI Share Investments preview',
      badge: reaiBadge({ text: 'Sample', tone: 'accent' }),
      body: html`<div class="metric-grid">${reaiMetric({ label: 'Holdings', value: '12', detail: 'Mapped to /api/share-investments' })}${reaiMetric({ label: 'Total cost', value: '485 200,00 NOK', detail: 'NS 4102 account 1350 / 1810' })}${reaiMetric({ label: 'Add-on fee', value: '0 NOK', detail: 'Included free with ReAI' })}</div>`,
    }));
  }

  try {
    const form = await request.formData();
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');

    if (pathname === `${basePath}/live`) {
      const list = /** @type {any[]} */ (await reaiAll(env, '/api/share-investments', { token: session.accessToken, tenantId: session.tenantId }));
      const totalCost = list.reduce((s, x) => s + Number(x.costPrice ?? 0) * Number(x.quantity ?? 0), 0);
      return htmlResponse(reaiCard({
        eyebrow: 'LIVE REAI SHARE INVESTMENTS',
        title: `${list.length} holdings in ReAI`,
        badge: reaiBadge({ text: 'Live API', tone: 'success' }),
        body: html`<div class="metric-grid">${reaiMetric({ label: 'Holdings', value: String(list.length), detail: 'GET /api/share-investments' })}${reaiMetric({ label: 'Total cost basis', value: `${formatMinor(Math.round(totalCost * 100))} NOK`, detail: 'Book cost value' })}</div>
          <div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Ticker / ISIN</th><th>Account</th><th class="num">Qty</th><th class="num">Cost price</th></tr></thead>
          <tbody>${list.slice(0, 100).map((x) => html`<tr><td><strong>${x.name}</strong></td><td class="mono">${x.ticker || x.isin || '—'}</td><td class="mono">${x.assetAccountNumber || '—'}</td><td class="num">${x.quantity}</td><td class="num">${Number(x.costPrice ?? 0).toFixed(2)}</td></tr>`)}</tbody></table></div>`,
      }));
    }
    if (pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a portfolio CSV file.');
      const doc = parseCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer())));
      const h = doc.headers.map((x) => x.toLowerCase().trim());
      const nameIdx = h.findIndex((x) => x.includes('name') || x.includes('navn') || x.includes('selskap'));
      const tickIdx = h.findIndex((x) => x.includes('tick'));
      const isinIdx = h.findIndex((x) => x.includes('isin'));
      const qtyIdx = h.findIndex((x) => x.includes('qty') || x.includes('antall') || x.includes('quantity'));
      const costIdx = h.findIndex((x) => x.includes('cost') || x.includes('kost'));
      if (nameIdx < 0) throw new HttpError(400, 'CSV needs a Name / Navn column.');
      const rows = doc.rows.map((r) => ({ name: (r[nameIdx] ?? '').trim(), ticker: tickIdx >= 0 ? (r[tickIdx] ?? '').trim() : '', isin: isinIdx >= 0 ? (r[isinIdx] ?? '').trim() : '', qty: qtyIdx >= 0 ? Number((r[qtyIdx] ?? '0').replace(',', '.')) || 0 : 0, cost: costIdx >= 0 ? Number((r[costIdx] ?? '0').replace(',', '.')) || 0 : 0 })).filter((x) => x.name);
      return htmlResponse(reaiCard({
        eyebrow: 'PORTFOLIO CSV PREVIEW',
        title: `${rows.length} holdings parsed`,
        body: html`<div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Ticker</th><th>ISIN</th><th class="num">Qty</th><th class="num">Cost (NOK)</th><th>Action</th></tr></thead>
          <tbody>${rows.slice(0, 80).map((r, idx) => html`<tr id="ak-r-${idx}"><td><strong>${r.name}</strong></td><td class="mono">${r.ticker || '—'}</td><td class="mono">${r.isin || '—'}</td><td class="num">${r.qty}</td><td class="num">${r.cost.toFixed(2)}</td>
            <td><form hx-post="/app/aksjonaer/import-one" hx-target="#ak-r-${idx}" hx-swap="outerHTML"><input type="hidden" name="rowJson" value="${JSON.stringify(r)}"><button type="submit" class="button primary">Import</button></form></td></tr>`)}</tbody></table></div>`,
      }));
    }
    if (pathname === `${basePath}/import-one`) {
      const r = /** @type {{ name: string, ticker: string, isin: string, qty: number, cost: number }} */ (JSON.parse(String(form.get('rowJson') ?? '{}')));
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/share-investments', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { name: r.name.slice(0, 150), instrumentType: 'listed_share', ...(r.ticker ? { ticker: r.ticker.slice(0, 20) } : {}), ...(r.isin ? { isin: r.isin.slice(0, 12) } : {}), assetAccountNumber: '1350', openingQuantity: r.qty || null, openingCostAmount: r.cost || null, withinExemptionMethod: true } }));
      return htmlResponse(html`<tr><td colspan="5"><strong>${r.name}</strong></td><td>${reaiBadge({ text: `Imported #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Aksjonær error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
