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
  const lead = 'HTTP request templates for n8n, Make and Zapier that call the ReAI API, plus a check that your connection and company id work.';

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
            <p class="muted-note">Every Make, Zapier or n8n HTTP step calls <code>https://app.reai.no/api/*</code> with <code>Authorization: Bearer &lt;token&gt;</code>. Create the token in ReAI under your profile, <a href="https://app.reai.no/user/profile#user-access-tokens">Access tokens</a>. A personal token also needs <code>X-Tenant-Id: &lt;company id&gt;</code>; the test below shows the id. Field reference: <a href="https://app.reai.no/openapi/public">ReAI OpenAPI</a>.</p>
            <div class="table-wrap"><table class="data-table">
              <thead><tr><th>Workflow</th><th>Endpoint</th><th>Use case</th></tr></thead>
              <tbody>
                <tr><td><strong>Find or create customer</strong></td><td class="mono">GET /api/customers?organizationNumber=…, then POST /api/customers</td><td>Sync new CRM or web shop buyers without duplicates</td></tr>
                <tr><td><strong>Create order</strong></td><td class="mono">POST /api/orders</td><td>Turn won deals or form submissions into orders to invoice</td></tr>
                <tr><td><strong>Save lead</strong></td><td class="mono">POST /api/leads</td><td>Save a company as a lead by organization number</td></tr>
                <tr><td><strong>Record trip</strong></td><td class="mono">POST /api/driving-log/trips</td><td>Log mileage from GPS or calendar triggers</td></tr>
                <tr><td><strong>Create manual voucher</strong></td><td class="mono">POST /api/manual-vouchers</td><td>Book payouts and settlements; every posting needs a vatCode from GET /api/vat-codes</td></tr>
              </tbody>
            </table></div>
            <div class="inline-row">
              <button type="button" class="button primary" hx-post="${basePath}/test-me" hx-target="#dp-output" hx-swap="innerHTML">Test ReAI connection</button>
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
      title: 'Find or create a customer on a webhook trigger',
      badge: reaiBadge({ text: 'Ready to copy', tone: 'accent' }),
      body: html`<p class="muted-note">Step 1 looks the customer up so a retried webhook does not create a duplicate. Run step 2 only when <code>items</code> is empty.</p>
<pre><code>GET https://app.reai.no/api/customers?organizationNumber=935606403
Authorization: Bearer YOUR_REAI_TOKEN
X-Tenant-Id: YOUR_COMPANY_ID

POST https://app.reai.no/api/customers
Authorization: Bearer YOUR_REAI_TOKEN
X-Tenant-Id: YOUR_COMPANY_ID
Content-Type: application/json

{"name":"Nordic Demo AS","organizationNumber":"935606403","countryCode":"NO","email":"post+demo@aiak.no"}</code></pre>`,
    }));
  }

  try {
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    if (pathname === `${basePath}/test-me`) {
      const me = /** @type {{ email: string, name: string, tenants: Array<{ id: number, companyName: string }> }} */ (await reaiRequest(env, '/api/me', { token: session.accessToken }));
      const company = me.tenants.find((t) => t.id === session.tenantId);
      return htmlResponse(reaiCallout({ tone: 'success', title: 'ReAI API connection works', body: html`Signed in to <code>${reaiOrigin(env)}/api/me</code> as ${me.email || me.name}. Use <code>X-Tenant-Id: ${session.tenantId}</code> for ${company?.companyName ?? 'the selected company'}.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Automations error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
