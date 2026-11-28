// @ts-check
import { fetchJson, isoDate, num, pickList, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/** @typedef {{ date: string, merchant: string, account: string, amountMinor: number, vatCode: string }} ExpenseLine */

const BRAND = "Pleo";
const TITLE = "Pleo Corporate Card Expenses";
const LEAD = "Import Pleo corporate card expenses via Pleo Open API or CSV into balanced ReAI review vouchers.";
const DEFAULT_CLEARING = "2380";
const SAMPLE_CSV = "Date;Merchant;Account;Amount;VAT\n2026-10-04;Cloudflare Inc;6900;420,00;0\n2026-10-09;Vy Togbillett Oslo\u2013Bergen;7140;899,00;0\n2026-10-16;Clas Ohlson Kontorrekvisita;6800;649,00;0";

/**
 * Fetches corporate card expenses from Pleo REST API.
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<ExpenseLine[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!token) throw new HttpError(400, `Enter your ${BRAND} API token.`);
  /** @type {ExpenseLine[]} */ const out = [];
  const data = await fetchJson(`https://external.pleo.io/v1/expenses?dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(to)}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, 'Pleo', fetchImpl);
  for (const e of pickList(data)) {
    const amountMinor = Math.round(Math.abs(num(e.amountSettled?.value ?? e.amountOriginal?.value ?? e.amount ?? 0)) * 100);
    if (amountMinor <= 0) continue;
    const acct = String(e.account?.code ?? e.accountNumber ?? '6800').trim();
    out.push({ date: isoDate(e.performedAt ?? e.date, to), merchant: String(e.merchant?.name ?? e.note ?? 'Pleo card expense'), account: /^[0-9]{4}$/.test(acct) ? acct : '6800', amountMinor, vatCode: '0' });
  }
  if (out.length === 0) throw new HttpError(400, `${BRAND} returned 0 expenses for ${from}–${to}.`);
  return out;
}

/** @param {string} csvText @returns {ExpenseLine[]} */
function parseCardCsv(csvText) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const dIdx = norm.findIndex((h) => h.includes('date') || h.includes('dato'));
  const mIdx = norm.findIndex((h) => h.includes('merchant') || h.includes('desc') || h.includes('beskrivelse'));
  const aIdx = norm.findIndex((h) => h.includes('amount') || h.includes('belop') || h.includes('beløp'));
  const acIdx = norm.findIndex((h) => h.includes('account') || h.includes('konto'));
  const fIdx = norm.findIndex((h) => h.includes('fee') || h.includes('gebyr'));
  if (dIdx < 0 || aIdx < 0) throw new HttpError(400, 'CSV must include Date/Dato and Amount/Beløp columns.');
  /** @type {ExpenseLine[]} */ const out = [];
  for (const r of doc.rows) {
    const date = (r[dIdx] ?? '').trim().slice(0, 10);
    const amountMinor = Math.round(Math.abs(num(r[aIdx])) * 100);
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || amountMinor <= 0) continue;
    const rawAcct = acIdx >= 0 ? (r[acIdx] ?? '').trim() : '';
    const merchant = mIdx >= 0 ? (r[mIdx] ?? '').trim() || 'Card expense' : 'Card expense';
    out.push({ date, merchant, account: /^[0-9]{4}$/.test(rawAcct) ? rawAcct : '6800', amountMinor, vatCode: '0' });
    if (fIdx >= 0) {
      const feeMinor = Math.round(Math.abs(num(r[fIdx])) * 100);
      if (feeMinor > 0) out.push({ date, merchant: `${merchant} · FX/card fee`, account: '7770', amountMinor: feeMinor, vatCode: '0' });
    }
  }
  if (out.length === 0) throw new HttpError(400, 'No valid expense rows found.');
  return out;
}

/** @param {{ lines: ExpenseLine[], clearingAccount: string, isSample?: boolean }} state */
function renderPreview(state) {
  const totalMinor = state.lines.reduce((s, l) => s + l.amountMinor, 0);
  const lastDate = state.lines.map((l) => l.date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} BATCH VOUCHER`,
    title: `${state.lines.length} expense lines · ${lastDate.slice(0, 7)}`,
    badge: state.isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Expense lines', value: String(state.lines.length) })}
        ${reaiMetric({ label: 'Total debit', value: `${formatMinor(totalMinor)} NOK` })}
        ${reaiMetric({ label: 'Credit clearing', value: state.clearingAccount })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Merchant</th><th>Account</th><th class="num">Amount</th></tr></thead>
        <tbody>${state.lines.map((l) => html`<tr><td class="mono">${l.date}</td><td>${l.merchant}</td><td class="mono">${l.account}</td><td class="num">${formatMinor(l.amountMinor)} NOK</td></tr>`)}</tbody>
      </table></div>
      ${!state.isSample ? html`<form class="stack-sm confirm-box" hx-post="/app/pleo/book" hx-target="#cd-book" hx-swap="innerHTML">
        <input type="hidden" name="linesJson" value="${JSON.stringify(state.lines)}"><input type="hidden" name="clearingAccount" value="${state.clearingAccount}">
        <label class="check-row"><input type="checkbox" name="c_receipts" required> I verified these ${BRAND} expenses and will attach receipts in ReAI.</label>
        <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
      </form><div id="cd-book" class="stack-sm"></div>` : reaiCallout({ tone: 'info', body: `Sample ${BRAND} batch loaded. Connect to ReAI and fetch via API or upload CSV above.` })}
    `,
  });
}

/**
 * Handles /app/pleo/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/pleo';
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">CORPORATE CARDS & EXPENSES</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-pleo-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({ basePath, targetId: 'card-output', brand: BRAND, hint: "Create an API key in Pleo Settings \u2192 Open API to pull approved card expenses via GET https://external.pleo.io/v1/expenses.", fields: [{"name": "apiToken", "label": "Pleo Open API key", "type": "password", "placeholder": "Pleo Bearer token"}, {"name": "fromDate", "label": "From date", "type": "date", "defaultValue": "$MONTH_START"}, {"name": "toDate", "label": "To date", "type": "date", "defaultValue": "$TODAY"}, {"name": "clearingAccount", "label": "Clearing account (4 digits)", "type": "text", "defaultValue": "2380"}], sampleAction: true })}
        ${reaiCard({
          eyebrow: 'UPLOAD STATEMENT CSV',
          title: `Or upload ${BRAND} CSV export`,
          body: html`<form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#card-output" hx-swap="innerHTML">
            <div class="inline-row"><div class="field"><label for="card-cl">Clearing account (4 digits)</label><input id="card-cl" name="clearingAccount" type="text" pattern="[0-9]{4}" value="${DEFAULT_CLEARING}" required></div></div>
            ${reaiDropzone({ inputId: 'card-csv', name: 'file', accept: '.csv,text/csv,text/plain', label: `Choose ${BRAND} CSV`, hint: 'CSV with Date, Merchant/Description, Amount and optional Account/Fee.' })}
            <div class="inline-row"><button type="submit" class="button primary">Preview balanced voucher</button></div>
          </form>`,
        })}
        <div id="card-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${basePath}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) return htmlResponse(renderPreview({ lines: parseCardCsv(SAMPLE_CSV), clearingAccount: DEFAULT_CLEARING, isSample: true }));
  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderPreview({ lines: await fetchApi(creds), clearingAccount: (creds.clearingAccount || DEFAULT_CLEARING).trim() }));
    }
    if (pathname === `${basePath}/preview`) {
      const clearingAccount = String(form.get('clearingAccount') ?? DEFAULT_CLEARING).trim();
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a CSV file first.');
      return htmlResponse(renderPreview({ lines: parseCardCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer()))), clearingAccount }));
    }
    if (pathname === `${basePath}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('c_receipts') !== 'on') throw new HttpError(400, 'Confirm verification checkbox first.');
      const lines = /** @type {ExpenseLine[]} */ (JSON.parse(String(form.get('linesJson') ?? '[]')));
      const clearingAccount = String(form.get('clearingAccount') ?? DEFAULT_CLEARING).trim();
      const lastDate = lines.map((l) => l.date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
      const totalMinor = lines.reduce((s, l) => s + l.amountMinor, 0);
      const marker = `${BRAND} expenses ${lastDate.slice(0, 7)} (${lines.length} lines, ${totalMinor})`;
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (await reaiAll(env, '/api/vouchers', { token: session.accessToken, tenantId: session.tenantId, query: { startDate: lastDate, endDate: lastDate, includeReversed: 'true' } }));
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      const postings = [
        ...lines.map((l, idx) => ({ accountNumber: l.account, postingDate: l.date, currencyCode: 'NOK', amount: Number((l.amountMinor / 100).toFixed(2)), vatCode: '0', rowNumber: idx, description: l.merchant })),
        { accountNumber: clearingAccount, postingDate: lastDate, currencyCode: 'NOK', amount: -Number((totalMinor / 100).toFixed(2)), vatCode: '0', rowNumber: lines.length, description: `${BRAND} card clearing` },
      ];
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { date: lastDate, description: marker, reviewReason: `${BRAND} batch imported via apps.reai.no.`, postings } }));
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
