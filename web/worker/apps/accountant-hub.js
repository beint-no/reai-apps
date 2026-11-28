// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiOrigin, reaiRequest } from '../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard } from '../lib/ui.js';

/**
 * Handles /app/accountant-hub/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/accountant-hub';
  const title = 'Multi-Client Accountant Control Tower';
  const lead = 'Fast cross-client control panel for Norwegian accounting firms using ReAI — inspect all engagements, start dates, assignees and status from GET /api/accountant-clients.';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">REGNSKAPSFØRER PORTFOLIO DASHBOARD</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-accountant-hub-web', clientName: 'ReAI Accountant Control Tower (Web)' })}
        ${reaiCard({
          eyebrow: 'LIVE REAI DATA · ACCOUNTANT CONTROL TOWER',
          title: 'Fetch live client portfolio from your connected ReAI firm',
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
    return htmlResponse(reaiCard({
      eyebrow: 'REGNSKAPSFØRER PORTFOLIO SAMPLE', title: '2 active ReAI accounting clients', badge: reaiBadge({ text: 'Sample', tone: 'accent' }),
      body: html`<div class="table-wrap"><table class="data-table"><thead><tr><th>Client</th><th>Org.nr</th><th>Start date</th><th>Status</th></tr></thead>
        <tbody>
          <tr><td><strong>Nordic Bakeri AS</strong></td><td class="mono">935606403</td><td>2025-01-01</td><td>${reaiBadge({ text: 'Active', tone: 'success' })}</td></tr>
          <tr><td><strong>Fjord Elektro AS</strong></td><td class="mono">923609016</td><td>2026-01-01</td><td>${reaiBadge({ text: 'Active', tone: 'success' })}</td></tr>
        </tbody></table></div>`,
    }));
  }

  try {
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    if (pathname === `${basePath}/live`) {
      const clients = /** @type {any[]} */ (await reaiRequest(env, '/api/accountant-clients', { token: session.accessToken, tenantId: session.tenantId }));
      const arr = Array.isArray(clients) ? clients : [];
      return htmlResponse(reaiCard({
        eyebrow: 'LIVE REGNSKAPSFØRER PORTFOLIO', title: `${arr.length} connected client companies`, badge: reaiBadge({ text: 'Live API', tone: 'success' }),
        body: html`<div class="table-wrap"><table class="data-table"><thead><tr><th>Client</th><th>Org.nr</th><th>Start date</th><th>Open</th></tr></thead>
          <tbody>${arr.slice(0, 200).map((c) => html`<tr><td><strong>${c.companyName || c.name || `Tenant #${c.clientTenantId}`}</strong></td><td class="mono">${c.organizationNumber || '—'}</td><td class="mono">${c.accountingStartDate || '—'}</td><td><a href="${reaiOrigin(env)}/?tenantId=${c.clientTenantId}" target="_blank" rel="noopener">Open ↗</a></td></tr>`)}</tbody></table></div>`,
      }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Accountant Hub error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
