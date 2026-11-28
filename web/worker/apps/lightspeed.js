// @ts-check
import { fetchJson, isoDate, num, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/** @typedef {{ account: string, description: string, debitMinor: number, creditMinor: number }} HospLine */
/** @typedef {{ date: string, ref: string, lines: HospLine[], debitMinor: number, creditMinor: number }} HospVoucher */

const BRAND = "Lightspeed Restaurant";
const TITLE = "Lightspeed Restaurant (Gastrofix) Sync";
const LEAD = "Import daily Lightspeed Restaurant (Gastrofix) accounting summaries into balanced ReAI vouchers with exact Norwegian 25% dine-in, 15% takeaway and tips separation.";
const SAMPLE = {"ref": "LSR-2026-1024", "cash": 2100, "card": 54900, "vipps": 6300, "fee": 900, "s25": 57200, "s15": 4100, "s12": 0, "tips": 2900};

/**
 * Fetches daily settlement summary from Lightspeed Restaurant REST API.
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const date = isoDate(creds.date);
  const token = (creds.apiToken ?? '').trim();
  if (!token) throw new HttpError(400, `Enter your ${BRAND} API token.`);
  const data = await fetchJson(`https://api.lsk.lightspeed.app/f/v2/business/${encodeURIComponent((creds.businessId ?? '').trim() || 'default')}/accounting?from=${date}&to=${date}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, BRAND, fetchImpl);
  const s = Array.isArray(data) ? (data[0] ?? {}) : (data.summary ?? data.report ?? data);
  const m = (/** @type {unknown} */ v) => Math.round(Math.max(0, num(v)) * 100);
  return { date, ref: String(s.reference ?? s.zReportNumber ?? `LIGHTSPEED-${date}`), cashMinor: m(s.cash ?? s.cashTotal), cardMinor: m(s.card ?? s.cardTotal ?? s.netPayout), vippsMinor: m(s.vipps ?? s.vippsTotal), feeMinor: m(s.fee ?? s.fees ?? s.commission), s25Minor: m(s.sales25 ?? s.gross25 ?? s.vat25Gross), s15Minor: m(s.sales15 ?? s.gross15 ?? s.vat15Gross), s12Minor: m(s.sales12 ?? s.gross12 ?? s.vat12Gross), tipsMinor: m(s.tips ?? s.tipsTotal) };
}

/** @param {number} grossMinor @param {number} pct */
function splitVat(grossMinor, pct) {
  if (pct <= 0 || grossMinor === 0) return { net: grossMinor, vat: 0 };
  const net = Math.round((grossMinor * 100) / (100 + pct));
  return { net, vat: grossMinor - net };
}

/** @param {{ date: string, ref: string, cashMinor: number, cardMinor: number, vippsMinor: number, feeMinor: number, s25Minor: number, s15Minor: number, s12Minor: number, tipsMinor: number }} input @returns {HospVoucher} */
function buildVoucher(input) {
  /** @type {HospLine[]} */ const lines = [];
  const pfx = `${BRAND} ${input.ref}`;
  if (input.cashMinor > 0) lines.push({ account: '1900', description: `${pfx} · Cash`, debitMinor: input.cashMinor, creditMinor: 0 });
  if (input.cardMinor > 0) lines.push({ account: '1580', description: `${pfx} · Card / payout`, debitMinor: input.cardMinor, creditMinor: 0 });
  if (input.vippsMinor > 0) lines.push({ account: '1580', description: `${pfx} · Vipps`, debitMinor: input.vippsMinor, creditMinor: 0 });
  if (input.feeMinor > 0) lines.push({ account: '7770', description: `${pfx} · Fees / commission`, debitMinor: input.feeMinor, creditMinor: 0 });
  let vatTotal = 0;
  for (const [gross, pct, acct, label] of [/** @type {const} */ ([input.s25Minor, 25, '3000', '25% sales (net)']), /** @type {const} */ ([input.s15Minor, 15, '3010', '15% food (net)']), /** @type {const} */ ([input.s12Minor, 12, '3020', '12% stay (net)'])]) {
    if (gross > 0) { const { net, vat } = splitVat(gross, pct); vatTotal += vat; lines.push({ account: acct, description: `${pfx} · ${label}`, debitMinor: 0, creditMinor: net }); }
  }
  if (vatTotal > 0) lines.push({ account: '2700', description: `${pfx} · Output VAT`, debitMinor: 0, creditMinor: vatTotal });
  if (input.tipsMinor > 0) lines.push({ account: '2930', description: `${pfx} · Staff tips payable`, debitMinor: 0, creditMinor: input.tipsMinor });
  return { date: input.date, ref: input.ref, lines, debitMinor: lines.reduce((s, l) => s + l.debitMinor, 0), creditMinor: lines.reduce((s, l) => s + l.creditMinor, 0) };
}

/** @param {HospVoucher} v @param {boolean} isSample */
function renderPreview(v, isSample) {
  const diff = v.debitMinor - v.creditMinor;
  const balanced = diff === 0 && v.debitMinor > 0;
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI VOUCHER`,
    title: `${v.ref} · ${v.date}`,
    badge: balanced ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }) : reaiBadge({ text: `Diff ${formatMinor(Math.abs(diff))} NOK`, tone: 'danger' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Debit (payments + fees)', value: `${formatMinor(v.debitMinor)} NOK` })}
        ${reaiMetric({ label: 'Credit (sales + VAT + tips)', value: `${formatMinor(v.creditMinor)} NOK` })}
        ${reaiMetric({ label: 'Difference', value: `${formatMinor(diff)} NOK` })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Posting</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${v.lines.map((l) => html`<tr><td class="mono">${l.account}</td><td>${l.description}</td><td class="num">${l.debitMinor ? formatMinor(l.debitMinor) : ''}</td><td class="num">${l.creditMinor ? formatMinor(l.creditMinor) : ''}</td></tr>`)}</tbody>
      </table></div>
      ${balanced && !isSample
        ? html`<form class="stack-sm confirm-box" hx-post="/app/lightspeed/book" hx-target="#hosp-book" hx-swap="innerHTML">
            <input type="hidden" name="voucherJson" value="${JSON.stringify(v)}">
            <label class="check-row"><input type="checkbox" name="c_hosp" required> I verified these figures against ${BRAND} and will attach the report PDF in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="hosp-book" class="stack-sm"></div>`
        : isSample ? reaiCallout({ tone: 'info', body: `Sample ${BRAND} settlement loaded. Connect to ReAI and fetch or enter real figures above to book.` }) : ''}
    `,
  });
}

/**
 * Handles /app/lightspeed/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/lightspeed';
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro"><p class="eyebrow">RESTAURANT POS (GASTROFIX)</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-lightspeed-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({ basePath, targetId: 'hosp-output', brand: BRAND, hint: "Connect Lightspeed K-Series Financial API using your Business Location ID and Bearer token.", fields: [{"name": "businessId", "label": "Lightspeed Business ID", "type": "text", "placeholder": "123456"}, {"name": "apiToken", "label": "Lightspeed Bearer token", "type": "password", "placeholder": "Bearer token"}, {"name": "date", "label": "Settlement date", "type": "date", "defaultValue": "$TODAY"}], sampleAction: true })}
        ${reaiCard({
          eyebrow: `${BRAND.toUpperCase()} DAILY / PERIOD SETTLEMENT`,
          title: 'Enter settlement totals (NOK incl. VAT)',
          body: html`<form class="stack" hx-post="${basePath}/preview" hx-target="#hosp-output" hx-swap="innerHTML">
            <div class="mapping-grid">
              <div class="field"><label for="h-date">Date</label><input id="h-date" name="date" type="date" value="${today}" required></div>
              <div class="field"><label for="h-ref">Ref</label><input id="h-ref" name="ref" type="text" placeholder="${SAMPLE.ref}" required></div>
              <div class="field"><label for="h-cash">Cash (1900)</label><input id="h-cash" name="cash" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="h-card">Card / payout (1580)</label><input id="h-card" name="card" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="h-vipps">Vipps (1580)</label><input id="h-vipps" name="vipps" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="h-fee">Fees (7770)</label><input id="h-fee" name="fee" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="h-s25">25% gross (3000)</label><input id="h-s25" name="s25" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="h-s15">15% gross (3010)</label><input id="h-s15" name="s15" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="h-s12">12% gross (3020)</label><input id="h-s12" name="s12" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="h-tips">Tips (2930)</label><input id="h-tips" name="tips" type="number" step="0.01" min="0" value="0"></div>
            </div>
            <div class="inline-row"><button type="submit" class="button primary">Preview balanced voucher</button><button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#hosp-output" hx-swap="innerHTML">Load sample settlement</button></div>
          </form>`,
        })}
        <div id="hosp-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${basePath}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) {
    return htmlResponse(renderPreview(buildVoucher({ date: '2026-10-24', ref: SAMPLE.ref, cashMinor: SAMPLE.cash * 100, cardMinor: SAMPLE.card * 100, vippsMinor: SAMPLE.vipps * 100, feeMinor: SAMPLE.fee * 100, s25Minor: SAMPLE.s25 * 100, s15Minor: SAMPLE.s15 * 100, s12Minor: SAMPLE.s12 * 100, tipsMinor: SAMPLE.tips * 100 }), true));
  }
  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderPreview(buildVoucher(await fetchApi(creds)), false));
    }
    if (pathname === `${basePath}/preview`) {
      /** @param {string} k */ const m = (k) => Math.round(Math.max(0, Number(form.get(k) ?? '0') || 0) * 100);
      const date = String(form.get('date') ?? '').trim();
      const ref = String(form.get('ref') ?? '').trim().slice(0, 60);
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !ref) throw new HttpError(400, 'Enter a valid date and reference.');
      return htmlResponse(renderPreview(buildVoucher({ date, ref, cashMinor: m('cash'), cardMinor: m('card'), vippsMinor: m('vipps'), feeMinor: m('fee'), s25Minor: m('s25'), s15Minor: m('s15'), s12Minor: m('s12'), tipsMinor: m('tips') }), false));
    }
    if (pathname === `${basePath}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('c_hosp') !== 'on') throw new HttpError(400, 'Confirm verification checkbox first.');
      const v = /** @type {HospVoucher} */ (JSON.parse(String(form.get('voucherJson') ?? '{}')));
      if (!v.lines?.length || v.debitMinor !== v.creditMinor || v.debitMinor <= 0) throw new HttpError(400, 'Voucher must balance to 0.00.');
      const marker = `${BRAND} ${v.ref} ${v.date}`;
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (await reaiAll(env, '/api/vouchers', { token: session.accessToken, tenantId: session.tenantId, query: { startDate: v.date, endDate: v.date, includeReversed: 'true' } }));
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { date: v.date, description: marker, reviewReason: `${BRAND} settlement imported via apps.reai.no.`, postings: v.lines.map((l, idx) => ({ accountNumber: l.account, postingDate: v.date, currencyCode: 'NOK', amount: Number(((l.debitMinor - l.creditMinor) / 100).toFixed(2)), vatCode: '0', rowNumber: idx, description: l.description })) } }));
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
