// @ts-check
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard } from '../../lib/ui.js';

/**
 * Handles /app/automations/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/automations';
  const title = 'Make, Zapier & n8n Automations Hub';
  const lead = 'Connect ReAI to thousands of apps with ready-to-paste n8n, Make and Zapier HTTP blueprints and verify your live ReAI API token & tenant headers in one click.';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">WEBHOOKS & REAI PUBLIC API BLUEPRINTS</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-automations-web', clientName: 'ReAI Make / Zapier / n8n Hub (Web)' })}
        ${reaiCard({
          eyebrow: 'N8N · MAKE · ZAPIER BLUEPRINTS',
          title: 'Ready-to-paste ReAI REST API request templates',
          body: html`
            <p class="muted-note">Every Make, Zapier or n8n workflow talks directly to <code>https://app.reai.no/api/*</code> with two headers: <code>Authorization: Bearer &lt;token&gt;</code> and <code>X-Tenant-Id: &lt;tenantId&gt;</code>.</p>
            <div class="table-wrap"><table class="data-table">
              <thead><tr><th>Workflow</th><th>Endpoint</th><th>Use case</th></tr></thead>
              <tbody>
                <tr><td><strong>Create Customer</strong></td><td class="mono">POST /api/customers</td><td>Sync new CRM / Stripe / Webflow buyers</td></tr>
                <tr><td><strong>Create Draft Order</strong></td><td class="mono">POST /api/orders</td><td>Turn won deals or form submissions into invoices</td></tr>
                <tr><td><strong>Save Brreg Lead</strong></td><td class="mono">POST /api/leads</td><td>Enrich incoming signups from Brønnøysund</td></tr>
                <tr><td><strong>Log Driving Trip</strong></td><td class="mono">POST /api/driving-log/trips</td><td>Automate mileage from GPS / calendar triggers</td></tr>
                <tr><td><strong>Post Review Voucher</strong></td><td class="mono">POST /api/manual-vouchers</td><td>Automate daily payouts & platform settlements</td></tr>
              </tbody>
            </table></div>
            <div class="inline-row">
              <button type="button" class="button primary" hx-post="${basePath}/test-me" hx-target="#dp-output" hx-swap="innerHTML">Test live /api/me connection</button>
              <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#dp-output" hx-swap="innerHTML">Show n8n JSON snippet</button>
            </div>
          `,
        })}
        <div id="dp-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${basePath}/sample`) {
    return htmlResponse(reaiCard({
      eyebrow: 'N8N / MAKE HTTP NODE SNIPPET',
      title: 'Create customer in ReAI on webhook trigger',
      badge: reaiBadge({ text: 'Ready to copy', tone: 'accent' }),
      body: html`<pre><code>POST https://app.reai.no/api/customers
Authorization: Bearer YOUR_REAI_ACCESS_TOKEN
X-Tenant-Id: YOUR_TENANT_ID
Content-Type: application/json

{"name":"Nordic Demo AS","organizationNumber":"935606403","countryCode":"NO"}</code></pre>`,
    }));
  }

  try {
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    if (pathname === `${basePath}/test-me`) {
      const me = /** @type {any} */ (await reaiRequest(env, '/api/me', { token: session.accessToken, tenantId: session.tenantId }));
      return htmlResponse(reaiCallout({ tone: 'success', title: 'ReAI Public API verified', body: html`Authenticated against <code>${reaiOrigin(env)}/api/me</code> for tenant <code>${session.tenantId}</code> (${me.email || me.name || 'OK'}).` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Automations error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
