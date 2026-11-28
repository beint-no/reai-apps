// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiRequest } from '../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * Handles /app/assets/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/assets';
  const title = 'Fixed Asset Register Importer';
  const lead = 'Import Norwegian fixed assets (saldogruppe a–j, account 1200–1299) straight into ReAI Fixed Assets (POST /api/assets) and audit existing assets.';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro"><p class="eyebrow">ANLEGGSMIDLER & SALDOAVSKRIVNING</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-assets-web', clientName: 'ReAI Fixed Assets (Web)' })}
        ${reaiCard({
          eyebrow: 'FIXED ASSETS → POST /api/assets',
          title: 'Register or inspect Norwegian fixed assets',
          body: html`<form class="stack" hx-post="${basePath}/create" hx-target="#pw-output" hx-swap="innerHTML">
            <div class="mapping-grid">
              <div class="field"><label for="as-n">Asset name</label><input id="as-n" name="name" type="text" required placeholder="MacBook Pro M4 / Firmabil"></div>
              <div class="field"><label for="as-a">Account (1xxx)</label><input id="as-a" name="accountNumber" type="text" required value="1280"></div>
              <div class="field"><label for="as-d">Acquisition date</label><input id="as-d" name="acquisitionDate" type="date" value="${today}" required></div>
              <div class="field"><label for="as-c">Cost (NOK)</label><input id="as-c" name="acquisitionCost" type="number" step="0.01" min="0" required value="34900"></div>
              <div class="field"><label for="as-m">Useful life (months)</label><input id="as-m" name="usefulLifeInMonths" type="number" min="1" value="36" required></div>
            </div>
            <div class="inline-row">
              <button type="submit" class="button primary">Create fixed asset in ReAI</button>
              <button type="button" class="button secondary" hx-post="${basePath}/live" hx-target="#pw-output" hx-swap="innerHTML">Load live ReAI assets</button>
              <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#pw-output" hx-swap="innerHTML">Load sample register</button>
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
    return htmlResponse(reaiCard({ eyebrow: 'FIXED ASSETS SAMPLE', title: 'Live ReAI Fixed Assets preview', badge: reaiBadge({ text: 'Sample', tone: 'accent' }), body: html`<div class="metric-grid">${reaiMetric({ label: 'Assets', value: '12', detail: 'Mapped to /api/assets' })}${reaiMetric({ label: 'Total cost', value: '485 200,00 NOK', detail: 'NS 4102 1200–1299' })}${reaiMetric({ label: 'Add-on fee', value: '0 NOK', detail: 'Included free with ReAI' })}</div>` }));
  }

  try {
    const form = await request.formData();
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    if (pathname === `${basePath}/create`) {
      const created = /** @type {{ id: number, name: string }} */ (await reaiRequest(env, '/api/assets', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { name: String(form.get('name') ?? '').trim().slice(0, 255), accountNumber: String(form.get('accountNumber') ?? '1280').trim(), acquisitionDate: String(form.get('acquisitionDate') ?? '').trim(), acquisitionCost: Number(form.get('acquisitionCost') ?? 0), usefulLifeInMonths: Math.max(1, Number(form.get('usefulLifeInMonths') ?? 36)), depreciationMethod: 'linear', currencyCode: 'NOK' } }));
      return htmlResponse(reaiCallout({ tone: 'success', title: `Registered fixed asset #${created.id}`, body: html`Saved <strong>${created.name}</strong> in ReAI Fixed Assets.` }));
    }
    if (pathname === `${basePath}/live`) {
      const list = /** @type {any[]} */ (await reaiAll(env, '/api/assets', { token: session.accessToken, tenantId: session.tenantId }));
      return htmlResponse(reaiCard({
        eyebrow: 'LIVE REAI FIXED ASSETS', title: `${list.length} registered assets`, badge: reaiBadge({ text: 'Live API', tone: 'success' }),
        body: html`<div class="table-wrap"><table class="data-table"><thead><tr><th>Account</th><th>Asset</th><th>Acquired</th><th class="num">Cost</th><th class="num">Months</th></tr></thead>
          <tbody>${list.slice(0, 100).map((a) => html`<tr><td class="mono">${a.accountNumber}</td><td><strong>${a.name}</strong></td><td class="mono">${a.acquisitionDate}</td><td class="num">${Number(a.acquisitionCost ?? 0).toFixed(2)} ${a.currencyCode || 'NOK'}</td><td class="num">${a.usefulLifeInMonths}</td></tr>`)}</tbody></table></div>`,
      }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Fixed Assets error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
