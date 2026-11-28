// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/** @typedef {{ date: string, description: string, exemptMinor: number, vat25Minor: number, feeMinor: number }} BookingRow */

const SAMPLE_TIMMA_CSV = [
  'Date;Description;ExemptSales;TaxableSales25;PaymentFee',
  '2026-10-31;Timma / Klinikksalg oktober (helsetjenester + produkter);42500,00;18750,00;915,00',
].join('\n');

/** @param {string} raw */
function parseMoney(raw) {
  const n = Number(raw.replace(/[\s\u00A0]/g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** @param {string} csvText @returns {BookingRow[]} */
function parseBookingCsv(csvText) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const dateIdx = norm.findIndex((h) => h.includes('date') || h.includes('dato'));
  const descIdx = norm.findIndex((h) => h.includes('desc') || h.includes('beskrivelse') || h.includes('periode'));
  const exIdx = norm.findIndex((h) => h.includes('exempt') || h.includes('fritatt') || h.includes('helse'));
  const vatIdx = norm.findIndex((h) => h.includes('taxable') || h.includes('mva') || h.includes('25'));
  const feeIdx = norm.findIndex((h) => h.includes('fee') || h.includes('gebyr'));
  if (dateIdx < 0 || (exIdx < 0 && vatIdx < 0)) throw new HttpError(400, 'CSV must contain Date/Dato and at least one sales column (ExemptSales / TaxableSales25).');
  return doc.rows
    .map((r) => ({
      date: (r[dateIdx] ?? '').trim().slice(0, 10),
      description: descIdx >= 0 ? (r[descIdx] ?? 'Booking settlement').trim() : 'Booking settlement',
      exemptMinor: exIdx >= 0 ? Math.round(parseMoney(r[exIdx] ?? '0') * 100) : 0,
      vat25Minor: vatIdx >= 0 ? Math.round(parseMoney(r[vatIdx] ?? '0') * 100) : 0,
      feeMinor: feeIdx >= 0 ? Math.round(parseMoney(r[feeIdx] ?? '0') * 100) : 0,
    }))
    .filter((b) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(b.date) && (b.exemptMinor > 0 || b.vat25Minor > 0));
}

/** @param {{ rows: BookingRow[], isSample?: boolean }} state */
function renderTimmaPreview(state) {
  const exemptTotal = state.rows.reduce((s, r) => s + r.exemptMinor, 0);
  const vat25Gross = state.rows.reduce((s, r) => s + r.vat25Minor, 0);
  const vat25Net = Math.round((vat25Gross * 100) / 125);
  const vatMinor = vat25Gross - vat25Net;
  const feeTotal = state.rows.reduce((s, r) => s + r.feeMinor, 0);
  const netPayout = exemptTotal + vat25Gross - feeTotal;
  const lastDate = state.rows.map((r) => r.date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);

  return reaiCard({
    eyebrow: 'TIMMA BOOKING & CLINIC SETTLEMENT VOUCHER',
    title: `Period ending ${lastDate}`,
    badge: state.isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Net bank / clearing (1580)', value: `${formatMinor(netPayout)} NOK`, detail: 'After payment fees' })}
        ${reaiMetric({ label: 'Exempt services (3100)', value: `${formatMinor(exemptTotal)} NOK`, detail: 'Healthcare / VAT-exempt' })}
        ${reaiMetric({ label: '25% sales + VAT', value: `${formatMinor(vat25Gross)} NOK`, detail: `Net ${formatMinor(vat25Net)} + VAT ${formatMinor(vatMinor)}` })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Posting</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>
          <tr><td class="mono">1580</td><td>Booking / payment terminal clearing (net)</td><td class="num">${formatMinor(netPayout)}</td><td class="num"></td></tr>
          ${feeTotal > 0 ? html`<tr><td class="mono">7770</td><td>Booking & card processing fees</td><td class="num">${formatMinor(feeTotal)}</td><td class="num"></td></tr>` : ''}
          ${exemptTotal > 0 ? html`<tr><td class="mono">3100</td><td>VAT-exempt healthcare / clinic revenue</td><td class="num"></td><td class="num">${formatMinor(exemptTotal)}</td></tr>` : ''}
          ${vat25Net > 0 ? html`<tr><td class="mono">3000</td><td>Taxable salon / product sales (25% net)</td><td class="num"></td><td class="num">${formatMinor(vat25Net)}</td></tr>` : ''}
          ${vatMinor > 0 ? html`<tr><td class="mono">2700</td><td>Output VAT 25% payable</td><td class="num"></td><td class="num">${formatMinor(vatMinor)}</td></tr>` : ''}
        </tbody>
      </table></div>
      ${!state.isSample
        ? html`<form class="stack-sm confirm-box" hx-post="/app/timma/book" hx-target="#tm-booking" hx-swap="innerHTML">
            <input type="hidden" name="rowsJson" value="${JSON.stringify(state.rows)}">
            <label class="check-row"><input type="checkbox" name="c_booking" required> I verified these figures against my Timma settlement report.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="tm-booking" class="stack-sm"></div>`
        : reaiCallout({ tone: 'info', body: 'Upload your real Timma settlement CSV report above and connect to ReAI to post the review voucher.' })}
    `,
  });
}

/**
 * Handles /app/timma/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/timma';
  const title = 'Timma Salon & Clinic Settlement';
  const lead = 'Book Timma salon, wellness and clinic settlements into ReAI with clean separation of VAT-exempt healthcare (3100), 25% salon & product sales (3000) and fees (7770).';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">BOOKING, SALON & CLINIC</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-timma-web', clientName: `ReAI ${title} (Web)` })}
        ${reaiCard({
          eyebrow: 'UPLOAD SETTLEMENT CSV',
          title: 'Upload Timma settlement CSV',
          body: html`<form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#bill-output" hx-swap="innerHTML">
            ${reaiDropzone({ inputId: 'bill-csv', name: 'file', accept: '.csv,text/csv,text/plain', label: 'Choose Timma CSV', hint: 'CSV with Date, Description, ExemptSales, TaxableSales25, PaymentFee columns.' })}
            <div class="inline-row">
              <button type="submit" class="button primary">Preview</button>
              <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#bill-output" hx-swap="innerHTML">Load sample CSV</button>
            </div>
          </form>`,
        })}
        <div id="bill-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${basePath}/sample`) return htmlResponse(renderTimmaPreview({ rows: parseBookingCsv(SAMPLE_TIMMA_CSV), isSample: true }));

  try {
    const form = await request.formData();
    if (pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a CSV file or load the sample.');
      return htmlResponse(renderTimmaPreview({ rows: parseBookingCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer()))) }));
    }
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    if (pathname === `${basePath}/book`) {
      if (form.get('c_booking') !== 'on') throw new HttpError(400, 'Confirm the verification checkbox first.');
      const rows = /** @type {BookingRow[]} */ (JSON.parse(String(form.get('rowsJson') ?? '[]')));
      if (!rows.length) throw new HttpError(400, 'No booking rows to post.');
      const exemptTotal = rows.reduce((s, r) => s + r.exemptMinor, 0);
      const vat25Gross = rows.reduce((s, r) => s + r.vat25Minor, 0);
      const vat25Net = Math.round((vat25Gross * 100) / 125);
      const vatMinor = vat25Gross - vat25Net;
      const feeTotal = rows.reduce((s, r) => s + r.feeMinor, 0);
      const netPayout = exemptTotal + vat25Gross - feeTotal;
      const lastDate = rows.map((r) => r.date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
      /** @type {Array<Record<string, unknown>>} */
      const postings = [];
      let idx = 0;
      const push = (/** @type {string} */ acct, /** @type {number} */ minor, /** @type {string} */ desc) => {
        if (minor === 0) return;
        postings.push({ accountNumber: acct, postingDate: lastDate, currencyCode: 'NOK', amount: Number((minor / 100).toFixed(2)), vatCode: '0', rowNumber: idx++, description: desc });
      };
      push('1580', netPayout, 'Timma settlement clearing');
      push('7770', feeTotal, 'Timma booking & card processing fees');
      push('3100', -exemptTotal, 'VAT-exempt healthcare / clinic revenue');
      push('3000', -vat25Net, 'Taxable salon / product sales (25% net)');
      push('2700', -vatMinor, 'Output VAT 25%');

      const created = /** @type {{ id: number, number: string }} */ (
        await reaiRequest(env, '/api/manual-vouchers', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: { date: lastDate, description: `Timma settlement ${lastDate}`, reviewReason: 'Imported from Timma settlement report via apps.reai.no. Attach source report before clearing review.', postings },
        })
      );
      const url = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI to attach your settlement PDF: <a href="${url}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Timma sync error', body: err instanceof Error ? err.message : 'Operation failed.' }));
  }
  return errorResponse('Unknown Timma route.', 404);
}
