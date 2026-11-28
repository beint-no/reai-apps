// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * @typedef {'two'} CollSlug
 * @typedef {{ date: string, ref: string, principalMinor: number, interestMinor: number, feeMinor: number }} CollSummary
 */

/** @type {Record<CollSlug, { brand: string, title: string, lead: string, eyebrow: string, sample: CollSummary }>} */
const COLL = {
  two: {
    brand: 'Two (B2B BNPL)',
    title: 'Two B2B Checkout & Factoring Settlement',
    lead: 'Reconcile Two B2B buy-now-pay-later payouts in ReAI splitting settled B2B invoice principal (1579), Two factoring/checkout fees (7770) and net bank payout (1580).',
    eyebrow: 'B2B CHECKOUT & FACTORING',
    sample: { date: '2026-10-28', ref: 'TWO-2026-512', principalMinor: 11800000, interestMinor: 0, feeMinor: 212400 },
  },
};

/** @param {CollSlug} slug @param {CollSummary} s @param {boolean} isSample */
function renderColl(slug, s, isSample) {
  const cfg = COLL[slug];
  const net = s.principalMinor + s.interestMinor - s.feeMinor;
  return reaiCard({
    eyebrow: `${cfg.brand.toUpperCase()} SETTLEMENT VOUCHER`,
    title: `${s.ref} · ${s.date}`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Net payout (1580)', value: `${formatMinor(net)} NOK`, detail: 'Matches incoming bank transfer' })}
        ${reaiMetric({ label: 'Principal cleared (1579)', value: `${formatMinor(s.principalMinor)} NOK`, detail: 'Reconcile against customer ledger' })}
        ${reaiMetric({ label: 'Checkout / factoring fee (7770)', value: `${formatMinor(s.feeMinor)} NOK`, detail: 'Deducted before payout' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Posting</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>
          <tr><td class="mono">1580</td><td>${cfg.brand} · Net settlement clearing</td><td class="num">${formatMinor(net)}</td><td class="num"></td></tr>
          ${s.feeMinor > 0 ? html`<tr><td class="mono">7770</td><td>${cfg.brand} · Checkout / factoring fee</td><td class="num">${formatMinor(s.feeMinor)}</td><td class="num"></td></tr>` : ''}
          <tr><td class="mono">1579</td><td>Settled B2B customer receivable principal</td><td class="num"></td><td class="num">${formatMinor(s.principalMinor)}</td></tr>
          ${s.interestMinor > 0 ? html`<tr><td class="mono">8050</td><td>Interest / fee adjustment</td><td class="num"></td><td class="num">${formatMinor(s.interestMinor)}</td></tr>` : ''}
        </tbody>
      </table></div>
      ${!isSample && net > 0
        ? html`<form class="stack-sm confirm-box" hx-post="/app/${slug}/book" hx-target="#cl-booking" hx-swap="innerHTML">
            <input type="hidden" name="collJson" value="${JSON.stringify(s)}">
            <label class="check-row"><input type="checkbox" name="c_coll" required> I verified this settlement statement from ${cfg.brand} and will attach the PDF in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="cl-booking" class="stack-sm"></div>`
        : isSample
          ? reaiCallout({ tone: 'info', body: `Synthetic ${cfg.brand} preview loaded. Enter your real settlement totals above and connect to ReAI to book.` })
          : ''}
    `,
  });
}

/**
 * Handles /app/two/* routes (Kravia inkasso is built natively into ReAI).
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @param {CollSlug} slug
 * @returns {Promise<Response>}
 */
export async function handleCollection(request, env, slug) {
  const cfg = COLL[slug];
  const { pathname } = new URL(request.url);
  const basePath = `/app/${slug}`;

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  }
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro"><p class="eyebrow">${cfg.eyebrow}</p><h1>${cfg.title}</h1><p class="lead">${cfg.lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${slug}-web`, clientName: `ReAI ${cfg.brand} (Web)` })}
        ${reaiCard({
          eyebrow: `${cfg.brand.toUpperCase()} STATEMENT`,
          title: 'Enter settlement totals (NOK)',
          body: html`<form class="stack" hx-post="${basePath}/preview" hx-target="#cl-output" hx-swap="innerHTML">
            <div class="mapping-grid">
              <div class="field"><label for="cl-d">Date</label><input id="cl-d" name="date" type="date" value="${today}" required></div>
              <div class="field"><label for="cl-r">Statement ref</label><input id="cl-r" name="ref" type="text" placeholder="${cfg.sample.ref}" required></div>
              <div class="field"><label for="cl-p">Settled B2B principal (1579)</label><input id="cl-p" name="principal" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="cl-i">Interest adjustment (8050)</label><input id="cl-i" name="interest" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="cl-f">Two fee (7770)</label><input id="cl-f" name="fee" type="number" step="0.01" min="0" value="0"></div>
            </div>
            <div class="inline-row">
              <button type="submit" class="button primary">Preview balanced voucher</button>
              <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#cl-output" hx-swap="innerHTML">Load sample statement</button>
            </div>
          </form>`,
        })}
        <div id="cl-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: cfg.title, description: cfg.lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${basePath}/sample`) return htmlResponse(renderColl(slug, cfg.sample, true));

  try {
    const form = await request.formData();
    if (pathname === `${basePath}/preview`) {
      /** @param {string} k */
      const m = (k) => Math.round(Math.max(0, Number(form.get(k) ?? '0') || 0) * 100);
      const date = String(form.get('date') ?? '').trim();
      const ref = String(form.get('ref') ?? '').trim().slice(0, 60);
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !ref) throw new HttpError(400, 'Enter valid date and reference.');
      return htmlResponse(renderColl(slug, { date, ref, principalMinor: m('principal'), interestMinor: m('interest'), feeMinor: m('fee') }, false));
    }
    if (pathname === `${basePath}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('c_coll') !== 'on') throw new HttpError(400, 'Confirm verification checkbox first.');
      const s = /** @type {CollSummary} */ (JSON.parse(String(form.get('collJson') ?? '{}')));
      const net = s.principalMinor + s.interestMinor - s.feeMinor;
      if (net <= 0) throw new HttpError(400, 'Net payout must be positive.');
      const marker = `${cfg.brand} ${s.ref} ${s.date}`;
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (
        await reaiAll(env, '/api/vouchers', { token: session.accessToken, tenantId: session.tenantId, query: { startDate: s.date, endDate: s.date, includeReversed: 'true' } })
      );
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) {
        const url = `${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}`;
        return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${url}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      }
      /** @type {Array<Record<string, unknown>>} */
      const postings = [];
      let idx = 0;
      const push = (/** @type {string} */ acct, /** @type {number} */ minor, /** @type {string} */ desc) => {
        if (minor === 0) return;
        postings.push({ accountNumber: acct, postingDate: s.date, currencyCode: 'NOK', amount: Number((minor / 100).toFixed(2)), vatCode: '0', rowNumber: idx++, description: desc });
      };
      push('1580', net, `${cfg.brand} net settlement`);
      push('7770', s.feeMinor, `${cfg.brand} fee`);
      push('1579', -s.principalMinor, `${cfg.brand} principal cleared`);
      push('8050', -s.interestMinor, `${cfg.brand} interest`);

      const created = /** @type {{ id: number, number: string }} */ (
        await reaiRequest(env, '/api/manual-vouchers', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: { date: s.date, description: marker, reviewReason: `${cfg.brand} settlement imported via apps.reai.no. Attach PDF before clearing review.`, postings },
        })
      );
      const url = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${url}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${cfg.brand} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }

  return errorResponse('Unknown B2B payment route.', 404);
}
