// @ts-check
import { fetchJson, isoDate, num, pickList, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/** @typedef {{ date: string, ref: string, cardMinor: number, cashMinor: number, claimMinor: number, feeMinor: number, exemptMinor: number, taxable25Minor: number }} WellnessVoucher */

const BRAND = "EasyPractice";
const TITLE = "EasyPractice / MakePlans Therapist Billing";
const LEAD = "Book therapist, psychologist, osteopath and clinic settlements from EasyPractice into ReAI separating 0% exempt treatments (3100) from 25% taxable sessions (3000).";
const SAMPLE = {"date": "2026-10-31", "ref": "EP-2026-10", "cardMinor": 5240000, "cashMinor": 0, "claimMinor": 960000, "feeMinor": 110000, "exemptMinor": 5810000, "taxable25Minor": 500000};

/** @param {Record<string, string>} creds @param {import('../lib/api-http.js').FetchLike} [fetchImpl] */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const date = isoDate(creds.toDate ?? creds.date);
  const from = isoDate(creds.fromDate, date);
  if (!token) throw new HttpError(400, 'Enter your EasyPractice Personal Access Token.');
  const data = await fetchJson(`https://system.easypractice.net/api/v1/invoices?from=${from}&to=${date}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, 'EasyPractice', fetchImpl);
  let cardMinor = 0, claimMinor = 0, exemptMinor = 0, taxable25Minor = 0;
  for (const inv of pickList(data)) {
    const grossMinor = Math.round(Math.abs(num(inv.total ?? inv.amount ?? 0)) * 100);
    if (num(inv.vat ?? inv.tax ?? 0) > 0) taxable25Minor += grossMinor; else exemptMinor += grossMinor;
    if (String(inv.status ?? '').toLowerCase() === 'paid') cardMinor += grossMinor; else claimMinor += grossMinor;
  }
  return { date, ref: `EP-${date}`, cardMinor, cashMinor: 0, claimMinor, feeMinor: 0, exemptMinor, taxable25Minor };
}

/** @param {WellnessVoucher} v @param {boolean} isSample */
function renderPreview(v, isSample) {
  const vatNet = Math.round((v.taxable25Minor * 100) / 125);
  const vatAmt = v.taxable25Minor - vatNet;
  const debit = v.cardMinor + v.cashMinor + v.claimMinor + v.feeMinor;
  const credit = v.exemptMinor + vatNet + vatAmt;
  const diff = debit - credit;
  const balanced = diff === 0 && debit > 0;
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} SETTLEMENT VOUCHER`,
    title: `${v.ref} · ${v.date}`,
    badge: balanced ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }) : reaiBadge({ text: `Diff ${formatMinor(diff)} NOK`, tone: 'danger' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Settlements + fees (Debit)', value: `${formatMinor(debit)} NOK` })}
        ${reaiMetric({ label: 'Exempt 0% (3100)', value: `${formatMinor(v.exemptMinor)} NOK` })}
        ${reaiMetric({ label: '25% taxable (3000+2700)', value: `${formatMinor(v.taxable25Minor)} NOK` })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Posting</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>
          ${v.cardMinor > 0 ? html`<tr><td class="mono">1580</td><td>${BRAND} card / Vipps</td><td class="num">${formatMinor(v.cardMinor)}</td><td class="num"></td></tr>` : ''}
          ${v.cashMinor > 0 ? html`<tr><td class="mono">1900</td><td>${BRAND} cash</td><td class="num">${formatMinor(v.cashMinor)}</td><td class="num"></td></tr>` : ''}
          ${v.claimMinor > 0 ? html`<tr><td class="mono">1570</td><td>Invoiced / insurance (1570)</td><td class="num">${formatMinor(v.claimMinor)}</td><td class="num"></td></tr>` : ''}
          ${v.feeMinor > 0 ? html`<tr><td class="mono">7770</td><td>Fees</td><td class="num">${formatMinor(v.feeMinor)}</td><td class="num"></td></tr>` : ''}
          ${v.exemptMinor > 0 ? html`<tr><td class="mono">3100</td><td>VAT-exempt therapy 0% (3100)</td><td class="num"></td><td class="num">${formatMinor(v.exemptMinor)}</td></tr>` : ''}
          ${vatNet > 0 ? html`<tr><td class="mono">3000</td><td>25% taxable net</td><td class="num"></td><td class="num">${formatMinor(vatNet)}</td></tr>` : ''}
          ${vatAmt > 0 ? html`<tr><td class="mono">2700</td><td>Output VAT 25%</td><td class="num"></td><td class="num">${formatMinor(vatAmt)}</td></tr>` : ''}
        </tbody>
      </table></div>
      ${balanced && !isSample
        ? html`<form class="stack-sm confirm-box" hx-post="/app/easypractice/book" hx-target="#wl-book" hx-swap="innerHTML">
            <input type="hidden" name="voucherJson" value="${JSON.stringify(v)}">
            <label class="check-row"><input type="checkbox" name="c_wl" required> I verified these figures against ${BRAND} and will attach the report PDF in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="wl-book" class="stack-sm"></div>`
        : isSample ? reaiCallout({ tone: 'info', body: `Sample ${BRAND} preview loaded. Fetch or enter real totals above to book.` }) : ''}
    `,
  });
}

/**
 * Handles /app/easypractice/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/easypractice';
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro"><p class="eyebrow">THERAPISTS & BOOKING CLINICS</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-easypractice-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({ basePath, targetId: 'wl-output', brand: BRAND, hint: "Enable the API app in EasyPractice Apps and paste your Personal Access Token (GET /api/v1/invoices).", fields: [{"name": "apiToken", "label": "EasyPractice Personal Access Token", "type": "password", "placeholder": "Bearer token"}, {"name": "fromDate", "label": "From date", "type": "date", "defaultValue": "$MONTH_START"}, {"name": "toDate", "label": "To date", "type": "date", "defaultValue": "$TODAY"}], sampleAction: true })}
        ${reaiCard({
          eyebrow: `${BRAND.toUpperCase()} SETTLEMENT ENTRY`,
          title: 'Enter settlement totals (NOK incl. VAT)',
          body: html`<form class="stack" hx-post="${basePath}/preview" hx-target="#wl-output" hx-swap="innerHTML">
            <div class="mapping-grid">
              <div class="field"><label for="wl-d">Date</label><input id="wl-d" name="date" type="date" value="${today}" required></div>
              <div class="field"><label for="wl-r">Ref</label><input id="wl-r" name="ref" type="text" placeholder="${SAMPLE.ref}" required></div>
              <div class="field"><label for="wl-c">Card / Vipps (1580)</label><input id="wl-c" name="card" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="wl-k">Cash (1900)</label><input id="wl-k" name="cash" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="wl-cl">Invoiced / insurance (1570)</label><input id="wl-cl" name="claim" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="wl-f">Fees (7770)</label><input id="wl-f" name="fee" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="wl-ex">VAT-exempt therapy 0% (3100)</label><input id="wl-ex" name="exempt" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="wl-25">25% gross (3000)</label><input id="wl-25" name="taxable25" type="number" step="0.01" min="0" value="0"></div>
            </div>
            <div class="inline-row"><button type="submit" class="button primary">Preview balanced voucher</button><button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#wl-output" hx-swap="innerHTML">Load sample settlement</button></div>
          </form>`,
        })}
        <div id="wl-output" class="stack"></div>
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
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !ref) throw new HttpError(400, 'Enter valid date and ref.');
      return htmlResponse(renderPreview({ date, ref, cardMinor: m('card'), cashMinor: m('cash'), claimMinor: m('claim'), feeMinor: m('fee'), exemptMinor: m('exempt'), taxable25Minor: m('taxable25') }, false));
    }
    if (pathname === `${basePath}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('c_wl') !== 'on') throw new HttpError(400, 'Confirm verification checkbox first.');
      const v = /** @type {WellnessVoucher} */ (JSON.parse(String(form.get('voucherJson') ?? '{}')));
      const vatNet = Math.round((v.taxable25Minor * 100) / 125);
      const vatAmt = v.taxable25Minor - vatNet;
      if (v.cardMinor + v.cashMinor + v.claimMinor + v.feeMinor !== v.exemptMinor + vatNet + vatAmt) throw new HttpError(400, 'Voucher must balance to 0.00.');
      const marker = `${BRAND} ${v.ref} ${v.date}`;
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (await reaiAll(env, '/api/vouchers', { token: session.accessToken, tenantId: session.tenantId, query: { startDate: v.date, endDate: v.date, includeReversed: 'true' } }));
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      /** @type {Array<Record<string, unknown>>} */ const postings = [];
      let idx = 0;
      const push = (/** @type {string} */ acct, /** @type {number} */ minor, /** @type {string} */ desc) => { if (minor !== 0) postings.push({ accountNumber: acct, postingDate: v.date, currencyCode: 'NOK', amount: Number((minor / 100).toFixed(2)), vatCode: '0', rowNumber: idx++, description: desc }); };
      push('1580', v.cardMinor, `${BRAND} card/Vipps`); push('1900', v.cashMinor, `${BRAND} cash`); push('1570', v.claimMinor, 'Invoiced / insurance (1570)'); push('7770', v.feeMinor, `${BRAND} fees`); push('3100', -v.exemptMinor, 'VAT-exempt therapy 0% (3100)'); push('3000', -vatNet, '25% net sales'); push('2700', -vatAmt, 'Output VAT 25%');
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { date: v.date, description: marker, reviewReason: `${BRAND} settlement imported via apps.reai.no.`, postings } }));
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
