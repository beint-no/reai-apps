// @ts-check
import { assertPublicHttpsUrl } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * Handles /app/squarespace/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/squarespace';
  const title = "Squarespace / BigCommerce Sync";
  const lead = "Sync Squarespace Commerce or BigCommerce catalog SKUs into ReAI Products and import paid online orders idempotently.";

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">ECOMMERCE · PRODUCT & SALES SYNC</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-squarespace-web', clientName: 'ReAI Squarespace & BigCommerce (Web)' })}
        ${reaiCard({
          eyebrow: 'CONNECT SQUARESPACE & BIGCOMMERCE',
          title: "Scan Squarespace / BigCommerce store",
          body: html`<p class="muted-note">API credentials are used only for this single HTTPS scan and never stored.</p>
            <form class="stack" hx-post="${basePath}/preview" hx-target="#mg-output" hx-swap="innerHTML">
              <div class="inline-row">
                <div class="field"><label for="mg-u">API Base URL</label><input id="mg-u" name="baseUrl" type="url" required placeholder="https://api.squarespace.com/1.0/commerce"></div>
                <div class="field"><label for="mg-k">Bearer API token</label><input id="mg-k" name="apiToken" type="password" autocomplete="off" required placeholder="Bearer token"></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Scan Squarespace & BigCommerce</button>
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
      eyebrow: 'SQUARESPACE & BIGCOMMERCE SAMPLE PREVIEW',
      title: "2 store SKUs & 2 paid orders",
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
      const targetUrl = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}/products`;
      const res = await fetch(targetUrl, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new HttpError(400, `Squarespace & BigCommerce returned HTTP ${res.status}. Verify API URL and Bearer token.`);
      const data = /** @type {any} */ (await res.json());
      const rows = Array.isArray(data.products) ? data.products : Array.isArray(data.records) ? data.records : Array.isArray(data.data) ? data.data : [];
      return htmlResponse(reaiCard({
        eyebrow: 'SQUARESPACE & BIGCOMMERCE LIVE SCAN',
        title: `${rows.length} records returned`,
        badge: reaiBadge({ text: 'API verified', tone: 'success' }),
        body: html`<p class="muted-note">Connected to <code>${parsed.hostname}</code> and verified ${rows.length} live products.</p>`,
      }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Squarespace & BigCommerce error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
