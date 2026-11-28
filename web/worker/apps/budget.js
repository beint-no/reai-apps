// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiRequest } from '../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/**
 * Handles /app/budget/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/budget';
  const title = '12-Month Budget Importer & Inspector';
  const lead = 'Upload a 12-month NS 4102 account budget CSV straight into ReAI (PUT /api/company-budgets/{year}) and inspect your active budget lines live.';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const year = new Date().getUTCFullYear();
    const body = html`
      <section class="app-intro"><p class="eyebrow">NS 4102 MONTHLY BUDGET → REAI</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-budget-web', clientName: 'ReAI Company Budget (Web)' })}
        ${reaiCard({
          eyebrow: 'COMPANY BUDGET → PUT /api/company-budgets/{year}',
          title: 'Upload 12-month NS 4102 budget CSV or load active budget',
          body: html`<form class="stack" hx-post="${basePath}/upload" hx-encoding="multipart/form-data" hx-target="#pw-output" hx-swap="innerHTML">
            <div class="field"><label for="bg-y">Fiscal year</label><input id="bg-y" name="year" type="number" min="2020" max="2035" value="${year}" required></div>
            ${reaiDropzone({ inputId: 'bg-csv', name: 'file', accept: '.csv,text/csv', label: 'Choose 12-month budget CSV', hint: 'Columns: Account, Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec.' })}
            <div class="inline-row">
              <button type="submit" class="button primary">Upload & save to ReAI</button>
              <button type="button" class="button secondary" hx-post="${basePath}/live" hx-include="#bg-y" hx-target="#pw-output" hx-swap="innerHTML">Load live ReAI budget</button>
              <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#pw-output" hx-swap="innerHTML">Load sample budget</button>
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
    return htmlResponse(reaiCard({ eyebrow: 'COMPANY BUDGET SAMPLE', title: 'Live ReAI Budget preview', badge: reaiBadge({ text: 'Sample', tone: 'accent' }), body: html`<div class="metric-grid">${reaiMetric({ label: 'Accounts', value: '12', detail: 'NS 4102 monthly lines' })}${reaiMetric({ label: 'Annual budget', value: '4 850 000,00 NOK', detail: '12-month grid' })}${reaiMetric({ label: 'Add-on fee', value: '0 NOK', detail: 'Included free with ReAI' })}</div>` }));
  }

  try {
    const form = await request.formData();
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    if (pathname === `${basePath}/live`) {
      const year = String(form.get('year') ?? new Date().getUTCFullYear()).replace(/[^0-9]/g, '');
      const b = /** @type {{ year: number, accounts?: Array<{ accountNumber: string, amounts: number[] }> }} */ (await reaiRequest(env, `/api/company-budgets/${year}`, { token: session.accessToken, tenantId: session.tenantId }));
      const accts = b.accounts ?? [];
      return htmlResponse(reaiCard({
        eyebrow: `REAI BUDGET ${b.year}`, title: `${accts.length} budgeted NS 4102 accounts`, badge: reaiBadge({ text: 'Live API', tone: 'success' }),
        body: html`<div class="table-wrap"><table class="data-table"><thead><tr><th>Account</th><th class="num">Q1</th><th class="num">Q2</th><th class="num">Q3</th><th class="num">Q4</th><th class="num">Full year</th></tr></thead>
          <tbody>${accts.slice(0, 100).map((a) => {
            const m = a.amounts ?? [];
            const sum = (/** @type {number} */ s, /** @type {number} */ e) => m.slice(s, e).reduce((acc, v) => acc + Number(v || 0), 0);
            return html`<tr><td class="mono">${a.accountNumber}</td><td class="num">${sum(0, 3).toFixed(0)}</td><td class="num">${sum(3, 6).toFixed(0)}</td><td class="num">${sum(6, 9).toFixed(0)}</td><td class="num">${sum(9, 12).toFixed(0)}</td><td class="num"><strong>${sum(0, 12).toFixed(0)}</strong></td></tr>`;
          })}</tbody></table></div>`,
      }));
    }
    if (pathname === `${basePath}/upload`) {
      const year = String(form.get('year') ?? new Date().getUTCFullYear()).replace(/[^0-9]/g, '');
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a 12-month budget CSV.');
      const doc = parseCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer())));
      const accounts = doc.rows.map((r) => ({ accountNumber: (r[0] ?? '').trim(), amounts: Array.from({ length: 12 }, (_, i) => Number((r[i + 1] ?? '0').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0) })).filter((a) => /^[0-9]{4}$/.test(a.accountNumber));
      if (accounts.length === 0) throw new HttpError(400, 'No 4-digit NS 4102 accounts found in first column.');
      let version = null;
      try { const cur = /** @type {{ version?: number | null }} */ (await reaiRequest(env, `/api/company-budgets/${year}`, { token: session.accessToken, tenantId: session.tenantId })); version = cur.version ?? null; } catch { version = null; }
      await reaiRequest(env, `/api/company-budgets/${year}`, { token: session.accessToken, tenantId: session.tenantId, method: 'PUT', body: { version, accounts } });
      return htmlResponse(reaiCallout({ tone: 'success', title: `Saved ${year} budget (${accounts.length} accounts)`, body: `Uploaded ${accounts.length} monthly NS 4102 budget lines straight to ReAI PUT /api/company-budgets/${year}.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Company Budget error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
