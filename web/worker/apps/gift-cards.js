// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * Handles /app/gift-cards/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/gift-cards';
  const title = 'Gift Card Issuer & Liability Console';
  const lead = 'Issue new gift cards (POST /api/gift-cards), check live remaining balances by code and audit outstanding Norwegian gift-card liability across your company.';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">REAI GIFT CARD LIABILITY (2900)</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-gift-cards-web', clientName: 'ReAI Gift Cards (Web)' })}
        ${reaiCard({
          eyebrow: 'GIFT CARDS → /api/gift-cards',
          title: 'Issue gift card or audit outstanding balances',
          body: html`<form class="stack" hx-post="${basePath}/issue" hx-target="#pw-output" hx-swap="innerHTML">
            <div class="inline-row">
              <div class="field"><label for="gc-a">Amount (NOK)</label><input id="gc-a" name="amount" type="number" step="1" min="1" value="1000" required></div>
              <div class="field"><label for="gc-r">Reference</label><input id="gc-r" name="reference" type="text" placeholder="POS / Web order #"></div>
            </div>
            <div class="inline-row">
              <button type="submit" class="button primary">Issue gift card in ReAI</button>
              <button type="button" class="button secondary" hx-post="${basePath}/live" hx-target="#pw-output" hx-swap="innerHTML">Load all live gift cards</button>
              <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#pw-output" hx-swap="innerHTML">Load sample report</button>
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
    return htmlResponse(reaiCard({ eyebrow: 'GIFT CARDS SAMPLE', title: 'Live ReAI Gift Cards preview', badge: reaiBadge({ text: 'Sample', tone: 'accent' }), body: html`<div class="metric-grid">${reaiMetric({ label: 'Active cards', value: '18', detail: 'Positive balance' })}${reaiMetric({ label: 'Liability (2900)', value: '24 500,00 NOK', detail: 'NS 4102 account 2900' })}${reaiMetric({ label: 'Add-on fee', value: '0 NOK', detail: 'Included free with ReAI' })}</div>` }));
  }

  try {
    const form = await request.formData();
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    if (pathname === `${basePath}/issue`) {
      const amount = Number(form.get('amount') ?? 0);
      const reference = String(form.get('reference') ?? '').trim() || null;
      const gc = /** @type {{ code: string, balance: number, currencyCode: string }} */ (await reaiRequest(env, '/api/gift-cards', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { amount, currencyCode: 'NOK', reference } }));
      return htmlResponse(reaiCallout({ tone: 'success', title: `Issued gift card ${gc.code}`, body: html`Code: <code>${gc.code}</code> · Balance: <strong>${gc.balance.toFixed(2)} ${gc.currencyCode}</strong>.` }));
    }
    if (pathname === `${basePath}/live`) {
      const list = /** @type {any[]} */ (await reaiAll(env, '/api/gift-cards', { token: session.accessToken, tenantId: session.tenantId }));
      const openLiability = list.filter((g) => !g.voided).reduce((s, g) => s + Number(g.balance ?? 0), 0);
      return htmlResponse(reaiCard({
        eyebrow: 'LIVE GIFT CARD LIABILITY (2900)', title: `${list.length} gift cards`, badge: reaiBadge({ text: 'Live API', tone: 'success' }),
        body: html`<div class="metric-grid">${reaiMetric({ label: 'Outstanding liability', value: `${formatMinor(Math.round(openLiability * 100))} NOK`, detail: 'Matches NS 4102 account 2900' })}${reaiMetric({ label: 'Active cards', value: String(list.filter((g) => !g.voided && Number(g.balance) > 0).length), detail: 'With positive balance' })}</div>
          <div class="table-wrap"><table class="data-table"><thead><tr><th>Code</th><th>Issued</th><th class="num">Initial</th><th class="num">Remaining</th><th>Status</th></tr></thead>
          <tbody>${list.slice(0, 100).map((g) => html`<tr><td class="mono">${g.code}</td><td class="mono">${String(g.issuedAt ?? '').slice(0, 10)}</td><td class="num">${Number(g.initialAmount ?? 0).toFixed(2)}</td><td class="num"><strong>${Number(g.balance ?? 0).toFixed(2)}</strong></td><td>${reaiBadge({ text: g.voided ? 'Voided' : Number(g.balance) > 0 ? 'Open' : 'Redeemed', tone: g.voided ? 'danger' : Number(g.balance) > 0 ? 'accent' : 'neutral' })}</td></tr>`)}</tbody></table></div>`,
      }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Gift Cards error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
