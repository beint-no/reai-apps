// @ts-check
import { fetchJson, isoDate, num, pickList, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/** @typedef {{ date: string, account: string, description: string, signedMinor: number }} JournalLine */

const BRAND = "PCKasse (Confirma PCK)";
const TITLE = "PCKasse Daily Accounting Import";
const LEAD = "Import PCKasse (Confirma PCK) daily Z-report and accounting export directly into balanced ReAI review vouchers.";
const SAMPLE_CSV = "Dato;Konto;Beskrivelse;Belop\n2026-10-24;1900;PCKasse Z-418 Kontant;3450,00\n2026-10-24;1580;PCKasse Z-418 Bankterminal;28900,00\n2026-10-24;1580;PCKasse Z-418 Vipps;5150,00\n2026-10-24;3000;Varesalg 25% MVA (netto);-30000,00\n2026-10-24;2700;Utg\u00e5ende MVA 25%;-7500,00";

/**
 * Fetches daily Z-report postings from PCKasse (Confirma PCK) REST API.
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<JournalLine[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const date = isoDate(creds.date);
  if (!token) throw new HttpError(400, `Enter your ${BRAND} API credential.`);
  const data = await fetchJson(`https://api.pckasse.no/v1/accounting/journal?date=${date}`, { headers: { 'x-api-key': token, accept: 'application/json' } }, BRAND, fetchImpl);
  const lines = pickList(data, ['lines', 'postings', 'entries', 'items', 'data']).map((l) => ({
    date: isoDate(l.date ?? l.postingDate, date),
    account: String(l.account ?? l.accountNumber ?? '').trim(),
    description: String(l.description ?? l.text ?? `${BRAND} Z-report`),
    signedMinor: Math.round((l.debit !== undefined || l.credit !== undefined ? num(l.debit) - num(l.credit) : num(l.amount ?? l.signedAmount)) * 100),
  })).filter((l) => /^[0-9]{4}$/.test(l.account) && l.signedMinor !== 0);
  if (lines.length === 0) throw new HttpError(400, `${BRAND} API returned 0 valid 4-digit postings for ${date}.`);
  return lines;
}

/** @param {string} csvText @returns {JournalLine[]} */
function parseJournalCsv(csvText) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const dIdx = norm.findIndex((h) => h.includes('dato') || h.includes('date'));
  const aIdx = norm.findIndex((h) => h.includes('konto') || h.includes('account'));
  const descIdx = norm.findIndex((h) => h.includes('beskrivelse') || h.includes('desc') || h.includes('tekst'));
  const mIdx = norm.findIndex((h) => h.includes('belop') || h.includes('beløp') || h.includes('amount'));
  if (dIdx < 0 || aIdx < 0 || mIdx < 0) throw new HttpError(400, 'CSV must include Dato/Date, Konto/Account and Beløp/Amount columns.');
  const lines = doc.rows.map((r) => ({
    date: (r[dIdx] ?? '').trim().slice(0, 10),
    account: (r[aIdx] ?? '').trim(),
    description: descIdx >= 0 ? (r[descIdx] ?? '').trim() || 'POS posting' : 'POS posting',
    signedMinor: Math.round(num(r[mIdx]) * 100),
  })).filter((l) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(l.date) && /^[0-9]{4}$/.test(l.account) && l.signedMinor !== 0);
  if (lines.length === 0) throw new HttpError(400, 'No valid 4-digit postings found in CSV.');
  return lines;
}

/** @param {JournalLine[]} lines @param {boolean} isSample */
function renderPreview(lines, isSample) {
  const debit = lines.filter((l) => l.signedMinor > 0).reduce((s, l) => s + l.signedMinor, 0);
  const credit = lines.filter((l) => l.signedMinor < 0).reduce((s, l) => s - l.signedMinor, 0);
  const diff = debit - credit;
  const balanced = diff === 0 && debit > 0;
  const lastDate = lines.map((l) => l.date).sort().at(-1) ?? '';
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI VOUCHER`,
    title: `${lines.length} postings · ${lastDate}`,
    badge: balanced ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }) : reaiBadge({ text: `Out of balance ${formatMinor(Math.abs(diff))}`, tone: 'danger' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Total debit', value: `${formatMinor(debit)} NOK` })}
        ${reaiMetric({ label: 'Total credit', value: `${formatMinor(credit)} NOK` })}
        ${reaiMetric({ label: 'Difference', value: `${formatMinor(diff)} NOK` })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Account</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${lines.map((l) => html`<tr><td class="mono">${l.date}</td><td class="mono">${l.account}</td><td>${l.description}</td><td class="num">${l.signedMinor > 0 ? formatMinor(l.signedMinor) : ''}</td><td class="num">${l.signedMinor < 0 ? formatMinor(-l.signedMinor) : ''}</td></tr>`)}</tbody>
      </table></div>
      ${balanced && !isSample
        ? html`<form class="stack-sm confirm-box" hx-post="/app/pckasse/book" hx-target="#rt-book" hx-swap="innerHTML">
            <input type="hidden" name="linesJson" value="${JSON.stringify(lines)}">
            <label class="check-row"><input type="checkbox" name="c_pos" required> I verified this ${BRAND} export against the official Z-report and will attach the PDF in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="rt-book" class="stack-sm"></div>`
        : isSample ? reaiCallout({ tone: 'info', body: `Sample ${BRAND} Z-report loaded. Fetch via API or upload CSV above to book.` }) : ''}
    `,
  });
}

/**
 * Handles /app/pckasse/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/pckasse';
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">RETAIL POS · NORWAY</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-pckasse-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({ basePath, targetId: 'rt-output', brand: BRAND, hint: "Paste your PCKasse Web API key to fetch the daily accounting journal.", fields: [{"name": "apiToken", "label": "PCKasse API key", "type": "password", "placeholder": "X-Api-Key"}, {"name": "date", "label": "Z-report date", "type": "date", "defaultValue": "$TODAY"}], sampleAction: true })}
        ${reaiCard({
          eyebrow: 'UPLOAD ACCOUNTING EXPORT CSV',
          title: `Or upload ${BRAND} Z-report CSV`,
          body: html`<form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#rt-output" hx-swap="innerHTML">
            ${reaiDropzone({ inputId: 'rt-csv', name: 'file', accept: '.csv,text/csv,text/plain', label: `Choose ${BRAND} CSV`, hint: 'CSV with Dato, Konto, Beskrivelse and signed Beløp.' })}
            <div class="inline-row"><button type="submit" class="button primary">Preview balanced voucher</button></div>
          </form>`,
        })}
        <div id="rt-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${basePath}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) return htmlResponse(renderPreview(parseJournalCsv(SAMPLE_CSV), true));
  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderPreview(await fetchApi(creds), false));
    }
    if (pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a CSV file first.');
      return htmlResponse(renderPreview(parseJournalCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer()))), false));
    }
    if (pathname === `${basePath}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('c_pos') !== 'on') throw new HttpError(400, 'Confirm verification checkbox first.');
      const lines = /** @type {JournalLine[]} */ (JSON.parse(String(form.get('linesJson') ?? '[]')));
      if (!lines.length || lines.reduce((s, l) => s + l.signedMinor, 0) !== 0) throw new HttpError(400, 'Journal must balance to 0.00.');
      const lastDate = lines.map((l) => l.date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
      const debit = lines.filter((l) => l.signedMinor > 0).reduce((s, l) => s + l.signedMinor, 0);
      const marker = `${BRAND} Z-report ${lastDate} (${lines.length} lines, ${debit})`;
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (await reaiAll(env, '/api/vouchers', { token: session.accessToken, tenantId: session.tenantId, query: { startDate: lastDate, endDate: lastDate, includeReversed: 'true' } }));
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { date: lastDate, description: marker, reviewReason: `${BRAND} Z-report imported via apps.reai.no.`, postings: lines.map((l, idx) => ({ accountNumber: l.account, postingDate: l.date, currencyCode: 'NOK', amount: Number((l.signedMinor / 100).toFixed(2)), vatCode: '0', rowNumber: idx, description: l.description })) } }));
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
