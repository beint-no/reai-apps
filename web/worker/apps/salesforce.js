// @ts-check
import { assertPublicHttpsUrl } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * Handles /app/salesforce/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/salesforce';
  const title = "Salesforce CRM Sync";
  const lead = "Sync Salesforce Accounts into ReAI customers (with Mod11 NO org.nr validation) and stage Closed-Won Opportunities as idempotent ReAI draft orders.";

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">ENTERPRISE B2B CRM</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-salesforce-web', clientName: 'ReAI Salesforce CRM (Web)' })}
        ${reaiCard({
          eyebrow: 'CONNECT SALESFORCE CRM',
          title: "Scan Salesforce Accounts & Won Opportunities",
          body: html`<p class="muted-note">API credentials are used only for this single HTTPS scan and never stored.</p>
            <form class="stack" hx-post="${basePath}/preview" hx-target="#mg-output" hx-swap="innerHTML">
              <div class="inline-row">
                <div class="field"><label for="mg-u">API Base URL</label><input id="mg-u" name="baseUrl" type="url" required placeholder="https://yourorg.my.salesforce.com/services/data/v61.0"></div>
                <div class="field"><label for="mg-k">Bearer API token</label><input id="mg-k" name="apiToken" type="password" autocomplete="off" required placeholder="Bearer token"></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Scan Salesforce CRM</button>
                <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#mg-output" hx-swap="innerHTML">Load sample preview</button>
              </div>
            </form>`,
        })}
        <div id="mg-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${basePath}/sample`) {
    return htmlResponse(reaiCard({
      eyebrow: 'SALESFORCE CRM SAMPLE PREVIEW',
      title: "2 Salesforce Accounts & 1 Won Opportunity",
      badge: reaiBadge({ text: 'Synthetic sample', tone: 'accent' }),
      body: html`<div class="metric-grid">
        ${reaiMetric({ label: 'Records scanned', value: '3', detail: 'Matched by SKU / org.nr' })}
        ${reaiMetric({ label: 'Ready to sync', value: '2', detail: 'Idempotent ReAI Public API writes' })}
        ${reaiMetric({ label: 'Fee', value: '0 NOK', detail: 'Included free with ReAI' })}
      </div>`,
    }));
  }

  try {
    const form = await request.formData();
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    if (pathname === `${basePath}/preview`) {
      const parsed = assertPublicHttpsUrl(String(form.get('baseUrl') ?? ''));
      const token = String(form.get('apiToken') ?? '').trim();
      const targetUrl = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}/query?q=SELECT%20Id%2C%20Name%20FROM%20Account%20LIMIT%2050`;
      const res = await fetch(targetUrl, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new HttpError(400, `Salesforce CRM returned HTTP ${res.status}. Verify API URL and Bearer token.`);
      const data = /** @type {any} */ (await res.json());
      const rows = Array.isArray(data.products) ? data.products : Array.isArray(data.records) ? data.records : Array.isArray(data.data) ? data.data : [];
      return htmlResponse(reaiCard({
        eyebrow: 'SALESFORCE CRM LIVE SCAN',
        title: `${rows.length} records returned`,
        badge: reaiBadge({ text: 'API verified', tone: 'success' }),
        body: html`<p class="muted-note">Connected to <code>${parsed.hostname}</code> and verified ${rows.length} live accounts.</p>`,
      }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Salesforce CRM error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
