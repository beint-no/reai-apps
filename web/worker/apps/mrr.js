// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * Handles /app/mrr/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/mrr';
  const title = 'Live MRR, ARR & Subscription Billing Hub';
  const lead = 'Monitor Monthly Recurring Revenue (MRR), Annual Recurring Revenue (ARR), active contracts and trigger due recurring invoices directly via ReAI /api/subscriptions.';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">REAI SUBSCRIPTIONS & RECURRING BILLING</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-mrr-web', clientName: 'ReAI SaaS MRR / ARR (Web)' })}
        ${reaiCard({
          eyebrow: 'LIVE REAI DATA · SAAS MRR / ARR',
          title: 'Fetch live recurring revenue from your connected ReAI company',
          body: html`<div class="inline-row">
            <button type="button" class="button primary" hx-post="${basePath}/live" hx-target="#pw-output" hx-swap="innerHTML">Load live from ReAI</button>
            <button type="button" class="button secondary" hx-post="${basePath}/generate-due" hx-target="#pw-output" hx-swap="innerHTML">Generate due invoices</button>
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
      eyebrow: 'REAI SUBSCRIPTIONS SAMPLE', title: 'Live SaaS & Retainer Metrics', badge: reaiBadge({ text: 'Sample', tone: 'accent' }),
      body: html`<div class="metric-grid">${reaiMetric({ label: 'Active MRR', value: '148 500,00 NOK', detail: '24 active recurring contracts' })}${reaiMetric({ label: 'Annualized ARR', value: '1 782 000,00 NOK', detail: 'MRR × 12' })}${reaiMetric({ label: 'Due for billing', value: '3 contracts', detail: 'Ready for POST /api/subscriptions/generate-due' })}</div>`,
    }));
  }

  try {
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    if (pathname === `${basePath}/live`) {
      const subs = /** @type {any[]} */ (await reaiAll(env, '/api/subscriptions', { token: session.accessToken, tenantId: session.tenantId }));
      const active = subs.filter((s) => s.active);
      const due = active.filter((s) => s.due);
      const mrr = active.reduce((acc, s) => acc + Number(s.amounts?.totalExVat ?? s.amounts?.netAmount ?? 0) / Math.max(1, Number(s.intervalMonths ?? 1)), 0);
      return htmlResponse(reaiCard({
        eyebrow: 'LIVE REAI SUBSCRIPTIONS', title: `${active.length} active recurring contracts`, badge: reaiBadge({ text: 'Live API', tone: 'success' }),
        body: html`<div class="metric-grid">${reaiMetric({ label: 'Active MRR', value: `${formatMinor(Math.round(mrr * 100))} NOK`, detail: 'Normalized monthly ex. VAT' })}${reaiMetric({ label: 'Annualized ARR', value: `${formatMinor(Math.round(mrr * 1200))} NOK`, detail: 'MRR × 12' })}${reaiMetric({ label: 'Due now', value: String(due.length), detail: 'Ready to bill' })}</div>
          <div class="table-wrap"><table class="data-table"><thead><tr><th>Customer</th><th>Interval</th><th>Next billing</th><th>Status</th></tr></thead>
          <tbody>${active.slice(0, 100).map((s) => html`<tr><td><strong>${s.customerName}</strong></td><td class="mono">${s.intervalMonths}m</td><td class="mono">${s.nextBillingDate}</td><td>${reaiBadge({ text: s.due ? 'Due' : 'Scheduled', tone: s.due ? 'warn' : 'success' })}</td></tr>`)}</tbody></table></div>`,
      }));
    }
    if (pathname === `${basePath}/generate-due`) {
      const res = /** @type {any} */ (await reaiRequest(env, '/api/subscriptions/generate-due', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: {} }));
      return htmlResponse(reaiCallout({ tone: 'success', title: 'Due subscription billing executed', body: `ReAI processed due subscription billing (${JSON.stringify(res).slice(0, 160)}).` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'MRR / ARR error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
