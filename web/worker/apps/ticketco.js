// @ts-check
import { pairVoucherRows } from '../lib/voucher-rows.js';
import { fetchJson, isoDate, num, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/** @typedef {{ ratePct: number, grossMinor: number }} SalesRate */
/** @typedef {{ from: string, to: string, ref: string, count: number, sales: SalesRate[], feeMinor: number, feeVatMinor: number }} Settlement */
/** @typedef {{ account: string, description: string, signedMinor: number, ratePct: number | null, kind: 'output' | 'input' | 'none' }} VoucherLine */
/** @typedef {{ date: string, ref: string, lines: VoucherLine[], debitMinor: number, creditMinor: number }} Voucher */
/** @typedef {{ code: string, rate: number, vatType: string, amountBasis: string, reverseCharge: boolean }} VatCode */

const SLUG = 'ticketco';
const BRAND = 'TicketCo';
const BASE_PATH = '/app/ticketco';
const TITLE = 'TicketCo Ticket Sales Accounting';
const EYEBROW = 'EVENTS · TICKETING';
const LEAD = 'Turn TicketCo ticket transactions for a period or one event into a balanced ReAI review voucher: sales per VAT rate, TicketCo fees and the amount due from TicketCo.';
const API_HINT = 'TicketCo issues the API token on request: email cs@ticketco.net from the address on your TicketCo user and ask for access to item grosses (transaction data). Leave the event id empty to include every event.';
/** @type {import('../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [
  { name: 'token', label: 'TicketCo API token', type: 'password' },
  { name: 'eventId', label: 'Event id (optional)', required: false, placeholder: '123456' },
  { name: 'from', label: 'Transactions from', type: 'date', defaultValue: '$MONTH_START' },
  { name: 'to', label: 'To', type: 'date', defaultValue: '$TODAY' },
];
const API = 'https://ticketco.events/api/public/v1/item_grosses';
const KNOWN_RATES = [25, 15, 12, 0];
/** @type {Record<string, string>} */
const REVENUE_ACCOUNTS = { 25: '3000', 15: '3010', 12: '3020', 0: '3100' };

/** @type {Settlement} */
const SAMPLE = { from: '2026-10-01', to: '2026-10-31', ref: '2026-10-01 to 2026-10-31', count: 412, sales: [{ ratePct: 0, grossMinor: 14800000 }, { ratePct: 25, grossMinor: 3125000 }], feeMinor: 540000, feeVatMinor: 0 };

/**
 * Reads TicketCo item gross transactions in a date range and sums them per VAT rate.
 * Docs: https://apidoc.ticketco.events/api/v1/public?env=Production (Swagger: host ticketco.events, basePath /api/public/v1,
 * GET /item_grosses with query token, event_id, pii and page; item_grosses[] with transaction_datestamp, transaction_type,
 * price, vat, ticketco_vat and ticketco_total_fee) and
 * https://ticketco.io/en/support/accessing-and-testing-the-ticketco-public-api (token from cs@ticketco.net).
 * The endpoint has no date filter, so pages are read until a page is short and rows are filtered by transaction_datestamp.
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<Settlement>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.token ?? '').trim();
  if (!token) throw new HttpError(400, 'Enter your TicketCo API token.');
  const eventId = (creds.eventId ?? '').trim();
  if (eventId && !/^[0-9]+$/.test(eventId)) throw new HttpError(400, 'The event id is a number.');
  const from = isoDate(creds.from);
  const to = isoDate(creds.to);
  /** @type {Map<number, number>} */ const byRate = new Map();
  let feeMinor = 0;
  let feeVatMinor = 0;
  let count = 0;
  for (let page = 1; page <= 200; page++) {
    const query = new URLSearchParams({ token, pii: 'false', page: String(page) });
    if (eventId) query.set('event_id', eventId);
    const data = await fetchJson(`${API}?${query}`, { headers: { accept: 'application/json' } }, BRAND, fetchImpl);
    /** @type {any[]} */ const rows = Array.isArray(data?.item_grosses) ? data.item_grosses : [];
    for (const r of rows) {
      const day = isoDate(r.transaction_datestamp, '');
      if (!day || day < from || day > to) continue;
      const sign = /refund|return|cancel|credit/i.test(String(r.transaction_type ?? '')) ? -1 : 1;
      const price = Math.abs(num(r.price));
      const vat = Math.abs(num(r.vat));
      const implied = price - vat > 0 ? (vat / (price - vat)) * 100 : 0;
      const rate = KNOWN_RATES.find((k) => Math.abs(k - implied) < 0.5);
      if (rate === undefined) throw new HttpError(400, `TicketCo transaction ${String(r.id)} has a VAT share (${implied.toFixed(1)}%) that is not a Norwegian rate.`);
      byRate.set(rate, (byRate.get(rate) ?? 0) + sign * Math.round(price * 100));
      feeMinor += sign * Math.round(Math.abs(num(r.ticketco_total_fee)) * 100);
      feeVatMinor += sign * Math.round(Math.abs(num(r.ticketco_vat)) * 100);
      count += 1;
    }
    const totalPages = num(data?.meta?.total_pages);
    if (rows.length === 0 || (totalPages > 0 ? page >= totalPages : rows.length < 50)) break;
  }
  if (count === 0) throw new HttpError(400, `TicketCo has no transactions from ${from} to ${to}${eventId ? ` for event ${eventId}` : ''}.`);
  const sales = [...byRate.entries()].map(([ratePct, grossMinor]) => ({ ratePct, grossMinor })).filter((s) => s.grossMinor !== 0);
  return { from, to, ref: `${eventId ? `event ${eventId} ` : ''}${from} to ${to}`, count, sales, feeMinor, feeVatMinor };
}

/** @param {Settlement} s @returns {Voucher} */
function buildVoucher(s) {
  const pfx = `${BRAND} ${s.ref}`;
  const salesTotal = s.sales.reduce((t, r) => t + r.grossMinor, 0);
  const feeRate = s.feeVatMinor !== 0 && s.feeMinor - s.feeVatMinor !== 0 ? Math.round((s.feeVatMinor / (s.feeMinor - s.feeVatMinor)) * 100) : null;
  /** @type {VoucherLine[]} */ const lines = [];
  if (salesTotal - s.feeMinor !== 0) lines.push({ account: '1580', description: `${pfx} · Due from TicketCo`, signedMinor: salesTotal - s.feeMinor, ratePct: null, kind: 'none' });
  if (s.feeMinor !== 0) lines.push({ account: '7770', description: `${pfx} · TicketCo fees`, signedMinor: s.feeMinor, ratePct: feeRate, kind: feeRate === null ? 'none' : 'input' });
  for (const r of s.sales) lines.push({ account: REVENUE_ACCOUNTS[String(r.ratePct)] ?? '3000', description: `${pfx} · Ticket sales ${r.ratePct}% VAT`, signedMinor: -r.grossMinor, ratePct: r.ratePct, kind: 'output' });
  const debitMinor = lines.filter((l) => l.signedMinor > 0).reduce((t, l) => t + l.signedMinor, 0);
  const creditMinor = lines.filter((l) => l.signedMinor < 0).reduce((t, l) => t - l.signedMinor, 0);
  return { date: s.to, ref: s.ref, lines, debitMinor, creditMinor };
}

/** @param {Voucher} v @param {boolean} isSample @param {number} count */
function renderPreview(v, isSample, count) {
  const diff = v.debitMinor - v.creditMinor;
  const balanced = diff === 0 && v.debitMinor > 0;
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI REVIEW VOUCHER`,
    title: `${v.ref}`,
    badge: balanced ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }) : reaiBadge({ text: `Diff ${formatMinor(Math.abs(diff))} NOK`, tone: 'danger' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Transactions', value: String(count) })}
        ${reaiMetric({ label: 'Ticket sales incl. VAT', value: `${formatMinor(v.creditMinor)} NOK` })}
        ${reaiMetric({ label: 'Voucher date', value: v.date })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Posting</th><th>VAT</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${v.lines.map((l) => html`<tr><td class="mono">${l.account}</td><td>${l.description}</td><td>${l.ratePct === null ? 'None' : `${l.kind === 'input' ? 'Input' : 'Output'} ${l.ratePct}%`}</td><td class="num">${l.signedMinor > 0 ? formatMinor(l.signedMinor) : ''}</td><td class="num">${l.signedMinor < 0 ? formatMinor(-l.signedMinor) : ''}</td></tr>`)}</tbody>
      </table></div>
      <p class="muted-note">Ticket sales are posted including VAT with the matching ReAI VAT code, so ReAI separates the base and VAT. Tickets without VAT use the exempt code. The amount due from TicketCo stays on clearing account 1580 until the payout is matched against the bank.</p>
      ${balanced && !isSample
        ? html`<form class="stack-sm confirm-box" hx-post="${BASE_PATH}/book" hx-target="#${SLUG}-book" hx-swap="innerHTML">
            <input type="hidden" name="voucherJson" value="${JSON.stringify(v)}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I verified these figures against the ${BRAND} settlement report and will attach it in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="${SLUG}-book" class="stack-sm"></div>`
        : isSample
          ? reaiCallout({ tone: 'info', body: `Sample ${BRAND} period loaded. Connect to ReAI and fetch real transactions above to book them.` })
          : reaiCallout({ tone: 'warn', body: 'The transactions do not add up to a positive amount. Check the period in TicketCo before booking.' })}
    `,
  });
}

/**
 * Picks the ReAI VAT code for a VAT-inclusive voucher line.
 * @param {VatCode[]} codes @param {VoucherLine} l
 */
function vatCodeFor(codes, l) {
  if (l.kind === 'none' || l.ratePct === null) return '0';
  const pct = l.ratePct;
  const usable = codes.filter((c) => !c.reverseCharge && c.amountBasis === 'vat_inclusive' && Math.abs(c.rate - pct) < 0.001);
  const match = l.kind === 'input'
    ? usable.find((c) => c.vatType === 'input_vat')
    : pct > 0
      ? usable.find((c) => c.vatType === 'output_vat')
      : (usable.find((c) => c.vatType === 'exempt') ?? usable.find((c) => c.vatType === 'outside_scope') ?? usable.find((c) => c.vatType === 'output_vat'));
  if (!match) throw new HttpError(400, `ReAI has no ${l.kind} VAT code for ${pct}% in this company.`);
  return match.code;
}

/**
 * Handles /app/ticketco/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE_PATH && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE_PATH}/`, request.url), 301);
  if (pathname === `${BASE_PATH}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">${EYEBROW}</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${SLUG}-web`, clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({ basePath: BASE_PATH, targetId: `${SLUG}-output`, brand: BRAND, hint: API_HINT, fields: API_FIELDS, sampleAction: true })}
        <div id="${SLUG}-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderPreview(buildVoucher(SAMPLE), true, SAMPLE.count));
  try {
    const form = await request.formData();
    if (pathname === `${BASE_PATH}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      const s = await fetchApi(creds);
      return htmlResponse(renderPreview(buildVoucher(s), false, s.count));
    }
    if (pathname === `${BASE_PATH}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('confirm') !== 'on') throw new HttpError(400, 'Confirm the verification checkbox first.');
      const v = /** @type {Voucher} */ (JSON.parse(String(form.get('voucherJson') ?? '{}')));
      if (!Array.isArray(v.lines) || !v.lines.length || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(v.date))) throw new HttpError(400, 'Voucher is empty.');
      const sum = v.lines.reduce((t, l) => t + Math.round(Number(l.signedMinor)), 0);
      if (sum !== 0 || !v.lines.every((l) => /^[0-9]{4}$/.test(String(l.account)))) throw new HttpError(400, 'Voucher must balance to 0.00.');
      const marker = `${BRAND} ${String(v.ref).slice(0, 80)}`;
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (await reaiAll(env, '/api/vouchers', { ...auth, query: { startDate: v.date, endDate: v.date, includeReversed: 'true' } }));
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      const codes = /** @type {VatCode[]} */ (await reaiRequest(env, '/api/vat-codes', auth));
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', {
        ...auth,
        method: 'POST',
        body: {
          date: v.date,
          description: marker,
          reviewReason: `${BRAND} ticket sales imported via apps.reai.no. Check against the ${BRAND} settlement report.`,
          postings: pairVoucherRows(v.lines.map((l) => ({
            accountNumber: String(l.account),
            postingDate: v.date,
            currencyCode: 'NOK',
            amount: Number((Math.round(Number(l.signedMinor)) / 100).toFixed(2)),
            vatCode: vatCodeFor(codes, l),
            description: String(l.description).slice(0, 200),
          }))),
        },
      }));
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
