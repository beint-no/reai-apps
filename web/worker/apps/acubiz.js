// @ts-check
import { fetchJson, isoDate, num, pickList, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/** @typedef {{ date: string, description: string, account: string, amountMinor: number }} ExpRow */

const BRAND = "Acubiz";
const TITLE = "Acubiz & Visma Expense Import";
const LEAD = "Import corporate travel and receipt expense batches from Acubiz, Visma Expense or Findity via API or CSV into balanced ReAI review vouchers.";
const SAMPLE_CSV = "Dato;Beskrivelse;Konto;Belop\n2026-10-11;Flytoget kvittering;7140;240,00\n2026-10-13;Kundemiddag representasjon;7350;1680,00\n2026-10-19;Kontorutstyr Elkj\u00f8p;6800;1199,00";

/**
 * Fetches approved expenses from Acubiz REST API.
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<ExpRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!token) throw new HttpError(400, `Enter your ${BRAND} API token.`);
  const data = await fetchJson(`https://api.acubiz.com/v1/transactions?from=${from}&to=${to}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, BRAND, fetchImpl);
  const rows = pickList(data).map((e) => {
    const acct = String(e.accountNumber ?? e.account ?? '7140').trim();
    return { date: isoDate(e.date ?? e.expenseDate ?? e.transactionDate, to), description: String(e.description ?? e.merchant ?? `${BRAND} expense`), account: /^[0-9]{4}$/.test(acct) ? acct : '7140', amountMinor: Math.round(Math.abs(num(e.amount ?? e.totalAmount ?? 0)) * 100) };
  }).filter((x) => x.amountMinor > 0);
  if (rows.length === 0) throw new HttpError(400, `${BRAND} returned 0 expenses for ${from}–${to}.`);
  return rows;
}

/** @param {string} csvText @returns {ExpRow[]} */
function parseExpCsv(csvText) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const dIdx = norm.findIndex((h) => h.includes('dato') || h.includes('date'));
  const descIdx = norm.findIndex((h) => h.includes('beskrivelse') || h.includes('desc') || h.includes('tekst'));
  const aIdx = norm.findIndex((h) => h.includes('konto') || h.includes('account'));
  const mIdx = norm.findIndex((h) => h.includes('belop') || h.includes('beløp') || h.includes('amount'));
  if (dIdx < 0 || mIdx < 0) throw new HttpError(400, 'CSV must include Dato/Date and Beløp/Amount.');
  return doc.rows.map((r) => ({
    date: (r[dIdx] ?? '').trim().slice(0, 10),
    description: descIdx >= 0 ? (r[descIdx] ?? '').trim() || 'Expense' : 'Expense',
    account: aIdx >= 0 && /^[0-9]{4}$/.test((r[aIdx] ?? '').trim()) ? (r[aIdx] ?? '').trim() : '7140',
    amountMinor: Math.round(Math.max(0, num(r[mIdx])) * 100),
  })).filter((x) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x.date) && x.amountMinor > 0);
}

/** @param {ExpRow[]} lines @param {string} clearing @param {boolean} isSample */
function renderExpenses(lines, clearing, isSample) {
  const total = lines.reduce((s, l) => s + l.amountMinor, 0);
  const lastDate = lines.map((l) => l.date).sort().at(-1) ?? '';
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI REVIEW VOUCHER`,
    title: `${lines.length} expense lines · ${formatMinor(total)} NOK`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Expense lines', value: String(lines.length) })}
        ${reaiMetric({ label: 'Total debit', value: `${formatMinor(total)} NOK` })}
        ${reaiMetric({ label: 'Credit account', value: clearing })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Description</th><th>Account</th><th class="num">Amount (NOK)</th></tr></thead>
        <tbody>
          ${lines.map((l) => html`<tr><td class="mono">${l.date}</td><td>${l.description}</td><td class="mono">${l.account}</td><td class="num">${formatMinor(l.amountMinor)}</td></tr>`)}
          <tr><td class="mono">${lastDate}</td><td><strong>${BRAND} payable clearing (credit)</strong></td><td class="mono">${clearing}</td><td class="num"><strong>-${formatMinor(total)}</strong></td></tr>
        </tbody>
      </table></div>
      ${!isSample ? html`<form class="stack-sm confirm-box" hx-post="/app/acubiz/book" hx-target="#hr-book" hx-swap="innerHTML">
        <input type="hidden" name="linesJson" value="${JSON.stringify(lines)}"><input type="hidden" name="clearingAccount" value="${clearing}">
        <label class="check-row"><input type="checkbox" name="c_exp" required> I verified these approved expenses and will attach receipts in ReAI.</label>
        <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
      </form><div id="hr-book" class="stack-sm"></div>` : reaiCallout({ tone: 'info', body: `Sample ${BRAND} batch loaded. Connect to ReAI and fetch via API or upload CSV above.` })}
    `,
  });
}

/**
 * Handles /app/acubiz/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/acubiz';
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">TRAVEL & EXPENSE MANAGEMENT</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-acubiz-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({ basePath, targetId: 'hr-output', brand: BRAND, hint: "Connect your Acubiz REST API token to pull approved expense transactions.", fields: [{ name: 'apiToken', label: `${BRAND} API token`, type: 'password', placeholder: 'Bearer token' }, { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' }, { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' }, { name: 'clearingAccount', label: 'Clearing account', type: 'text', defaultValue: '2915' }], sampleAction: true })}
        ${reaiCard({ eyebrow: `CSV IMPORT · ${BRAND.toUpperCase()}`, title: `Or upload ${BRAND} export CSV`, body: html`<form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#hr-output" hx-swap="innerHTML"><div class="inline-row"><div class="field"><label for="hr-cl">Employee clearing account</label><input id="hr-cl" name="clearingAccount" type="text" pattern="[0-9]{4}" value="2915" required></div></div>${reaiDropzone({ inputId: 'hr-csv', name: 'file', accept: '.csv,text/csv,text/plain', label: `Choose ${BRAND} CSV`, hint: 'CSV with Dato, Beskrivelse, Konto and Beløp.' })}<div class="inline-row"><button type="submit" class="button primary">Preview CSV</button></div></form>` })}
        <div id="hr-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${basePath}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) return htmlResponse(renderExpenses(parseExpCsv(SAMPLE_CSV), '2915', true));
  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderExpenses(await fetchApi(creds), (creds.clearingAccount || '2915').trim(), false));
    }
    if (pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a CSV file.');
      return htmlResponse(renderExpenses(parseExpCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer()))), String(form.get('clearingAccount') ?? '2915').trim(), false));
    }
    if (pathname === `${basePath}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('c_exp') !== 'on') throw new HttpError(400, 'Confirm verification checkbox first.');
      const lines = /** @type {ExpRow[]} */ (JSON.parse(String(form.get('linesJson') ?? '[]')));
      const clearing = String(form.get('clearingAccount') ?? '2915').trim();
      const total = lines.reduce((s, l) => s + l.amountMinor, 0);
      const lastDate = lines.map((l) => l.date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
      const postings = [
        ...lines.map((l, idx) => ({ accountNumber: l.account, postingDate: l.date, currencyCode: 'NOK', amount: Number((l.amountMinor / 100).toFixed(2)), vatCode: '0', rowNumber: idx, description: l.description })),
        { accountNumber: clearing, postingDate: lastDate, currencyCode: 'NOK', amount: -Number((total / 100).toFixed(2)), vatCode: '0', rowNumber: lines.length, description: `${BRAND} payable clearing` },
      ];
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { date: lastDate, description: `${BRAND} expenses ${lastDate} (${lines.length} lines)`, reviewReason: `${BRAND} batch imported via apps.reai.no.`, postings } }));
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
