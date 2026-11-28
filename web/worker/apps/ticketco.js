// @ts-check
import { fetchJson, isoDate, num, pickList, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/** @typedef {{ date: string, ref: string, exemptMinor: number, taxable25Minor: number, feeMinor: number }} PayoutSummary */

const BRAND = "TicketCo";
const TITLE = "TicketCo Event & Festival Settlement";
const LEAD = "Book TicketCo event payout statements into ReAI splitting VAT-exempt culture/concert tickets (3100, 0%) from 25% bar/merchandise sales (3000) and ticketing fees (7770).";
const SAMPLE = {"date": "2026-10-25", "ref": "TC-2026-8841", "exemptMinor": 14800000, "taxable25Minor": 3125000, "feeMinor": 540000};

/** @param {Record<string, string>} creds @param {import('../lib/api-http.js').FetchLike} [fetchImpl] */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const date = isoDate(creds.date ?? creds.toDate);
  if (!token) throw new HttpError(400, `Enter your ${BRAND} API key.`);
  const data = await fetchJson(`https://ticketco.events/api/public/v1/transactions?token=${encodeURIComponent(token)}`, { headers: { accept: 'application/json' } }, BRAND, fetchImpl);
  let exemptMinor = 0, taxable25Minor = 0, feeMinor = 0;
  for (const row of pickList(data)) {
    const grossMinor = Math.round(Math.abs(num(row.grossAmount ?? row.amount ?? row.total ?? 0)) * 100);
    if (num(row.vatRate ?? row.taxRate ?? 0) >= 20) taxable25Minor += grossMinor; else exemptMinor += grossMinor;
    feeMinor += Math.round(Math.abs(num(row.fee ?? row.commission ?? 0)) * 100);
  }
  return { date, ref: `TICKETCO-${date}`, exemptMinor, taxable25Minor, feeMinor };
}

/** @param {PayoutSummary} s @param {boolean} isSample */
function renderPreview(s, isSample) {
  const vat25Net = Math.round((s.taxable25Minor * 100) / 125);
  const vatMinor = s.taxable25Minor - vat25Net;
  const netPayout = s.exemptMinor + s.taxable25Minor - s.feeMinor;
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} SETTLEMENT VOUCHER`,
    title: `${s.ref} · ${s.date}`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Net payout (1580)', value: `${formatMinor(netPayout)} NOK` })}
        ${reaiMetric({ label: '0% revenue (3100)', value: `${formatMinor(s.exemptMinor)} NOK` })}
        ${reaiMetric({ label: '25% + fees', value: `${formatMinor(s.taxable25Minor)} / ${formatMinor(s.feeMinor)}` })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Posting</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>
          <tr><td class="mono">1580</td><td>${BRAND} net settlement</td><td class="num">${formatMinor(netPayout)}</td><td class="num"></td></tr>
          ${s.feeMinor > 0 ? html`<tr><td class="mono">7770</td><td>${BRAND} fees</td><td class="num">${formatMinor(s.feeMinor)}</td><td class="num"></td></tr>` : ''}
          ${s.exemptMinor > 0 ? html`<tr><td class="mono">3100</td><td>0% revenue</td><td class="num"></td><td class="num">${formatMinor(s.exemptMinor)}</td></tr>` : ''}
          ${vat25Net > 0 ? html`<tr><td class="mono">3000</td><td>25% taxable net</td><td class="num"></td><td class="num">${formatMinor(vat25Net)}</td></tr>` : ''}
          ${vatMinor > 0 ? html`<tr><td class="mono">2700</td><td>Output VAT 25%</td><td class="num"></td><td class="num">${formatMinor(vatMinor)}</td></tr>` : ''}
        </tbody>
      </table></div>
      ${!isSample && netPayout > 0
        ? html`<form class="stack-sm confirm-box" hx-post="/app/ticketco/book" hx-target="#mb-book" hx-swap="innerHTML">
            <input type="hidden" name="summaryJson" value="${JSON.stringify(s)}">
            <label class="check-row"><input type="checkbox" name="c_member" required> I verified these totals against ${BRAND} and will attach the PDF in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="mb-book" class="stack-sm"></div>`
        : isSample ? reaiCallout({ tone: 'info', body: `Sample ${BRAND} settlement loaded. Connect to ReAI and fetch or enter real totals above to book.` }) : ''}
    `,
  });
}

/**
 * Handles /app/ticketco/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/ticketco';
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro"><p class="eyebrow">EVENTS & TICKETING</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-ticketco-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({ basePath, targetId: 'mb-output', brand: BRAND, hint: "Uses the TicketCo Public API with your organizer API token to pull event sales & fees.", fields: [{"name": "apiToken", "label": "TicketCo API token", "type": "password", "placeholder": "Organizer API token"}, {"name": "date", "label": "Settlement date", "type": "date", "defaultValue": "$TODAY"}], sampleAction: true })}
        ${reaiCard({
          eyebrow: `${BRAND.toUpperCase()} PAYOUT STATEMENT`,
          title: 'Enter settlement summary (NOK)',
          body: html`<form class="stack" hx-post="${basePath}/preview" hx-target="#mb-output" hx-swap="innerHTML">
            <div class="mapping-grid">
              <div class="field"><label for="mb-d">Date</label><input id="mb-d" name="date" type="date" value="${today}" required></div>
              <div class="field"><label for="mb-r">Ref</label><input id="mb-r" name="ref" type="text" placeholder="${SAMPLE.ref}" required></div>
              <div class="field"><label for="mb-ex">0% sales / export (3100)</label><input id="mb-ex" name="exempt" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="mb-25">Gross 25% sales (3000)</label><input id="mb-25" name="taxable25" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="mb-f">Fees (7770)</label><input id="mb-f" name="fee" type="number" step="0.01" min="0" value="0"></div>
            </div>
            <div class="inline-row"><button type="submit" class="button primary">Preview balanced voucher</button><button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#mb-output" hx-swap="innerHTML">Load sample settlement</button></div>
          </form>`,
        })}
        <div id="mb-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${basePath}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) return htmlResponse(renderPreview(SAMPLE, true));
  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderPreview(await fetchApi(creds), false));
    }
    if (pathname === `${basePath}/preview`) {
      /** @param {string} k */ const m = (k) => Math.round(Math.max(0, Number(form.get(k) ?? '0') || 0) * 100);
      const date = String(form.get('date') ?? '').trim();
      const ref = String(form.get('ref') ?? '').trim().slice(0, 60);
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !ref) throw new HttpError(400, 'Enter a valid date and reference.');
      return htmlResponse(renderPreview({ date, ref, exemptMinor: m('exempt'), taxable25Minor: m('taxable25'), feeMinor: m('fee') }, false));
    }
    if (pathname === `${basePath}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('c_member') !== 'on') throw new HttpError(400, 'Confirm verification checkbox first.');
      const s = /** @type {PayoutSummary} */ (JSON.parse(String(form.get('summaryJson') ?? '{}')));
      const vat25Net = Math.round((s.taxable25Minor * 100) / 125);
      const vatMinor = s.taxable25Minor - vat25Net;
      const netPayout = s.exemptMinor + s.taxable25Minor - s.feeMinor;
      if (netPayout <= 0) throw new HttpError(400, 'Net settlement must be positive.');
      const marker = `${BRAND} payout ${s.ref} ${s.date}`;
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (await reaiAll(env, '/api/vouchers', { token: session.accessToken, tenantId: session.tenantId, query: { startDate: s.date, endDate: s.date, includeReversed: 'true' } }));
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      /** @type {Array<Record<string, unknown>>} */ const postings = [];
      let idx = 0;
      const push = (/** @type {string} */ acct, /** @type {number} */ minor, /** @type {string} */ desc) => { if (minor !== 0) postings.push({ accountNumber: acct, postingDate: s.date, currencyCode: 'NOK', amount: Number((minor / 100).toFixed(2)), vatCode: '0', rowNumber: idx++, description: desc }); };
      push('1580', netPayout, `${BRAND} net settlement`); push('7770', s.feeMinor, `${BRAND} fees`); push('3100', -s.exemptMinor, `${BRAND} 0% revenue`); push('3000', -vat25Net, `${BRAND} 25% net`); push('2700', -vatMinor, 'Output VAT 25%');
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { date: s.date, description: marker, reviewReason: `${BRAND} payout imported via apps.reai.no.`, postings } }));
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
