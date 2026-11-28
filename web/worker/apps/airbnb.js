// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/** @typedef {{ date: string, ref: string, stay12Minor: number, exemptLongMinor: number, hostFeeMinor: number }} AirbnbSummary */

/** @param {AirbnbSummary} s @param {boolean} isSample */
function renderAirbnb(s, isSample) {
  const stayNet = Math.round((s.stay12Minor * 100) / 112);
  const stayVat = s.stay12Minor - stayNet;
  const netPayout = s.stay12Minor + s.exemptLongMinor - s.hostFeeMinor;
  return reaiCard({
    eyebrow: 'AIRBNB / BOOKING.COM VOUCHER',
    title: `${s.ref} · ${s.date}`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Net payout (1580)', value: `${formatMinor(netPayout)} NOK`, detail: 'After OTA host commission' })}
        ${reaiMetric({ label: '12% short-term stay (3020)', value: `${formatMinor(s.stay12Minor)} NOK`, detail: `Net ${formatMinor(stayNet)} + VAT ${formatMinor(stayVat)}` })}
        ${reaiMetric({ label: 'OTA host fee (7770)', value: `${formatMinor(s.hostFeeMinor)} NOK`, detail: 'Check reverse-charge VAT if foreign OTA' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Posting</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>
          <tr><td class="mono">1580</td><td>Airbnb / Booking.com net payout clearing</td><td class="num">${formatMinor(netPayout)}</td><td class="num"></td></tr>
          ${s.hostFeeMinor > 0 ? html`<tr><td class="mono">7770</td><td>Host service & OTA commission</td><td class="num">${formatMinor(s.hostFeeMinor)}</td><td class="num"></td></tr>` : ''}
          ${stayNet > 0 ? html`<tr><td class="mono">3020</td><td>Short-term accommodation 12% (net)</td><td class="num"></td><td class="num">${formatMinor(stayNet)}</td></tr>` : ''}
          ${stayVat > 0 ? html`<tr><td class="mono">2700</td><td>Output VAT 12% payable</td><td class="num"></td><td class="num">${formatMinor(stayVat)}</td></tr>` : ''}
          ${s.exemptLongMinor > 0 ? html`<tr><td class="mono">3100</td><td>VAT-exempt residential rental (0%)</td><td class="num"></td><td class="num">${formatMinor(s.exemptLongMinor)}</td></tr>` : ''}
        </tbody>
      </table></div>
      ${!isSample && netPayout > 0
        ? html`<form class="stack-sm confirm-box" hx-post="/app/airbnb/book" hx-target="#ab-booking" hx-swap="innerHTML">
            <input type="hidden" name="abJson" value="${JSON.stringify(s)}">
            <label class="check-row"><input type="checkbox" name="c_ab" required> I verified this payout statement and will attach the Airbnb / Booking.com PDF in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="ab-booking" class="stack-sm"></div>`
        : isSample
          ? reaiCallout({ tone: 'info', body: 'Synthetic payout loaded. Enter your real Airbnb / Booking.com totals above and connect to ReAI to book.' })
          : ''}
    `,
  });
}

/**
 * Handles /app/airbnb/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/airbnb';
  const title = 'Airbnb & Booking.com Host Accounting';
  const lead = 'Book Airbnb and Booking.com payout statements into ReAI separating 12% short-term accommodation VAT (3020), VAT-exempt long-term stays (3100), host service fees (7770) and net payout (1580).';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro"><p class="eyebrow">REAL ESTATE & SHORT-TERM RENTALS</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-airbnb-web', clientName: 'ReAI Airbnb & Booking.com (Web)' })}
        ${reaiCard({
          eyebrow: 'AIRBNB / BOOKING.COM PAYOUT',
          title: 'Enter payout statement totals (NOK)',
          body: html`<form class="stack" hx-post="/app/airbnb/preview" hx-target="#pr-output" hx-swap="innerHTML">
            <div class="mapping-grid">
              <div class="field"><label for="ab-d">Payout date</label><input id="ab-d" name="date" type="date" value="${today}" required></div>
              <div class="field"><label for="ab-r">Payout code</label><input id="ab-r" name="ref" type="text" placeholder="AIR-2026-10" required></div>
              <div class="field"><label for="ab-12">Gross 12% short-term stay (3020)</label><input id="ab-12" name="stay12" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="ab-0">VAT-exempt rental 0% (3100)</label><input id="ab-0" name="exempt" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="ab-f">Host / OTA commission fee (7770)</label><input id="ab-f" name="fee" type="number" step="0.01" min="0" value="0"></div>
            </div>
            <div class="inline-row">
              <button type="submit" class="button primary">Preview balanced voucher</button>
              <button type="button" class="button secondary" hx-post="/app/airbnb/sample" hx-target="#pr-output" hx-swap="innerHTML">Load sample payout</button>
            </div>
          </form>`,
        })}
        <div id="pr-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${basePath}/sample`) {
    return htmlResponse(renderAirbnb({ date: '2026-10-28', ref: 'AIR-2026-10', stay12Minor: 3360000, exemptLongMinor: 0, hostFeeMinor: 504000 }, true));
  }

  try {
    const form = await request.formData();
    if (pathname === `${basePath}/preview`) {
      /** @param {string} k */
      const m = (k) => Math.round(Math.max(0, Number(form.get(k) ?? '0') || 0) * 100);
      const date = String(form.get('date') ?? '').trim();
      const ref = String(form.get('ref') ?? '').trim().slice(0, 60);
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !ref) throw new HttpError(400, 'Enter valid date and payout ref.');
      return htmlResponse(renderAirbnb({ date, ref, stay12Minor: m('stay12'), exemptLongMinor: m('exempt'), hostFeeMinor: m('fee') }, false));
    }
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    if (pathname === `${basePath}/book`) {
      if (form.get('c_ab') !== 'on') throw new HttpError(400, 'Confirm verification checkbox first.');
      const s = /** @type {AirbnbSummary} */ (JSON.parse(String(form.get('abJson') ?? '{}')));
      const stayNet = Math.round((s.stay12Minor * 100) / 112);
      const stayVat = s.stay12Minor - stayNet;
      const netPayout = s.stay12Minor + s.exemptLongMinor - s.hostFeeMinor;
      /** @type {Array<Record<string, unknown>>} */
      const postings = [];
      let idx = 0;
      const push = (/** @type {string} */ acct, /** @type {number} */ minor, /** @type {string} */ desc) => {
        if (minor === 0) return;
        postings.push({ accountNumber: acct, postingDate: s.date, currencyCode: 'NOK', amount: Number((minor / 100).toFixed(2)), vatCode: '0', rowNumber: idx++, description: desc });
      };
      push('1580', netPayout, 'Airbnb / Booking.com net payout');
      push('7770', s.hostFeeMinor, 'Airbnb / Booking.com host commission');
      push('3020', -stayNet, 'Short-term accommodation 12% net');
      push('2700', -stayVat, 'Output VAT 12%');
      push('3100', -s.exemptLongMinor, 'VAT-exempt rental 0%');

      const created = /** @type {{ id: number, number: string }} */ (
        await reaiRequest(env, '/api/manual-vouchers', {
          token: session.accessToken, tenantId: session.tenantId, method: 'POST',
          body: { date: s.date, description: `Airbnb/Booking ${s.ref} ${s.date}`, reviewReason: 'Imported via apps.reai.no. Attach OTA statement PDF and verify reverse-charge VAT on foreign host fees.', postings },
        })
      );
      const url = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${url}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Airbnb error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown Airbnb route.', 404);
}
