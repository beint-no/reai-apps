// @ts-check
import { fetchJson, isoDate, num, pickList, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/** @typedef {{ date: string, ref: string, principalMinor: number, interestMinor: number, feeMinor: number }} TwoSummary */

/**
 * Fetches settled B2B BNPL totals from Two (https://api.two.inc/v1/order).
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<TwoSummary>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!token) throw new HttpError(400, 'Enter your Two X-API-Key.');
  const data = await fetchJson(
    `https://api.two.inc/v1/order?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { headers: { 'x-api-key': token, accept: 'application/json' } },
    'Two',
    fetchImpl,
  );
  let principalMinor = 0;
  let feeMinor = 0;
  for (const o of pickList(data)) {
    principalMinor += Math.round(Math.abs(num(o.gross_amount ?? o.grossAmount ?? o.amount ?? 0)) * 100);
    feeMinor += Math.round(Math.abs(num(o.merchant_fee ?? o.fee ?? 0)) * 100);
  }
  return { date: to, ref: `TWO-${to}`, principalMinor, interestMinor: 0, feeMinor };
}

/** @param {TwoSummary} s @param {boolean} isSample */
function renderTwo(s, isSample) {
  const net = s.principalMinor + s.interestMinor - s.feeMinor;
  return reaiCard({
    eyebrow: 'TWO (B2B BNPL) SETTLEMENT VOUCHER',
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
          <tr><td class="mono">1580</td><td>Two · Net settlement clearing</td><td class="num">${formatMinor(net)}</td><td class="num"></td></tr>
          ${s.feeMinor > 0 ? html`<tr><td class="mono">7770</td><td>Two · Checkout / factoring fee</td><td class="num">${formatMinor(s.feeMinor)}</td><td class="num"></td></tr>` : ''}
          <tr><td class="mono">1579</td><td>Settled B2B customer receivable principal</td><td class="num"></td><td class="num">${formatMinor(s.principalMinor)}</td></tr>
          ${s.interestMinor > 0 ? html`<tr><td class="mono">8050</td><td>Interest / fee adjustment</td><td class="num"></td><td class="num">${formatMinor(s.interestMinor)}</td></tr>` : ''}
        </tbody>
      </table></div>
      ${!isSample && net > 0
        ? html`<form class="stack-sm confirm-box" hx-post="/app/two/book" hx-target="#cl-booking" hx-swap="innerHTML">
            <input type="hidden" name="collJson" value="${JSON.stringify(s)}">
            <label class="check-row"><input type="checkbox" name="c_coll" required> I verified this settlement statement from Two and will attach the PDF in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="cl-booking" class="stack-sm"></div>`
        : isSample
          ? reaiCallout({ tone: 'info', body: 'Synthetic Two preview loaded. Fetch via Two API or enter your real totals above and connect to ReAI to book.' })
          : ''}
    `,
  });
}

/**
 * Handles /app/two/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/two';
  const title = 'Two B2B Checkout & Factoring Settlement';
  const lead = 'Reconcile Two B2B buy-now-pay-later payouts in ReAI splitting settled B2B invoice principal (1579), Two factoring/checkout fees (7770) and net bank payout (1580).';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro"><p class="eyebrow">B2B CHECKOUT & FACTORING</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-two-web', clientName: 'ReAI Two (Web)' })}
        ${renderApiFetchCard({
          basePath,
          targetId: 'cl-output',
          brand: 'Two (B2B BNPL)',
          hint: 'Paste your Two Merchant X-API-Key (GET https://api.two.inc/v1/order) to pull settled B2B BNPL orders & fees.',
          fields: [
            { name: 'apiToken', label: 'Two X-API-Key', type: 'password', placeholder: 'X-API-Key' },
            { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
            { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
          ],
          sampleAction: true,
        })}
        ${reaiCard({
          eyebrow: 'MANUAL STATEMENT ENTRY',
          title: 'Or enter Two settlement totals (NOK)',
          body: html`<form class="stack" hx-post="${basePath}/preview" hx-target="#cl-output" hx-swap="innerHTML">
            <div class="mapping-grid">
              <div class="field"><label for="cl-d">Date</label><input id="cl-d" name="date" type="date" value="${today}" required></div>
              <div class="field"><label for="cl-r">Statement ref</label><input id="cl-r" name="ref" type="text" placeholder="TWO-2026-512" required></div>
              <div class="field"><label for="cl-p">Settled B2B principal (1579)</label><input id="cl-p" name="principal" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="cl-i">Interest adjustment (8050)</label><input id="cl-i" name="interest" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="cl-f">Two fee (7770)</label><input id="cl-f" name="fee" type="number" step="0.01" min="0" value="0"></div>
            </div>
            <div class="inline-row"><button type="submit" class="button primary">Preview balanced voucher</button></div>
          </form>`,
        })}
        <div id="cl-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) return htmlResponse(renderTwo({ date: '2026-10-28', ref: 'TWO-2026-512', principalMinor: 11800000, interestMinor: 0, feeMinor: 212400 }, true));

  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */
      const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderTwo(await fetchApi(creds), false));
    }
    if (pathname === `${basePath}/preview`) {
      /** @param {string} k */
      const m = (k) => Math.round(Math.max(0, Number(form.get(k) ?? '0') || 0) * 100);
      const date = String(form.get('date') ?? '').trim();
      const ref = String(form.get('ref') ?? '').trim().slice(0, 60);
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !ref) throw new HttpError(400, 'Enter valid date and reference.');
      return htmlResponse(renderTwo({ date, ref, principalMinor: m('principal'), interestMinor: m('interest'), feeMinor: m('fee') }, false));
    }
    if (pathname === `${basePath}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('c_coll') !== 'on') throw new HttpError(400, 'Confirm verification checkbox first.');
      const s = /** @type {TwoSummary} */ (JSON.parse(String(form.get('collJson') ?? '{}')));
      const net = s.principalMinor + s.interestMinor - s.feeMinor;
      if (net <= 0) throw new HttpError(400, 'Net payout must be positive.');
      const marker = `Two (B2B BNPL) ${s.ref} ${s.date}`;
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
      push('1580', net, 'Two net settlement');
      push('7770', s.feeMinor, 'Two fee');
      push('1579', -s.principalMinor, 'Two principal cleared');
      push('8050', -s.interestMinor, 'Two interest');
      const created = /** @type {{ id: number, number: string }} */ (
        await reaiRequest(env, '/api/manual-vouchers', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { date: s.date, description: marker, reviewReason: 'Two B2B settlement imported via apps.reai.no.', postings } })
      );
      const url = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${url}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Two error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown Two route.', 404);
}
