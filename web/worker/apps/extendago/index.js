// @ts-check
import { pairVoucherRows } from '../../lib/voucher-rows.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../../lib/ui.js';
import { decodeCsvBytes } from '../../lib/csv.js';

/** @typedef {{ account: string, vatCode: string, description: string, signedMinor: number, department: string }} VoucherLine */
/** @typedef {{ date: string, ref: string, lines: VoucherLine[], debitMinor: number, creditMinor: number }} Voucher */
/** @typedef {{ code: string, rate: number, vatType: string, amountBasis: string, reverseCharge: boolean }} VatCode */

const SLUG = 'extendago';
const BRAND = 'ExtendaGO';
const BASE_PATH = '/app/extendago';
const TITLE = 'ExtendaGO GBAT10 Accounting';
const EYEBROW = 'RETAIL POS · NORWAY';
const LEAD = 'Import the daily GBAT10 accounting file from ExtendaGO and book it as a balanced ReAI review voucher with the VAT codes set in ExtendaGO.';

/** Sample in the documented GBAT10 layout: tenders negative, revenue incl. VAT positive. */
const SAMPLE_FILE = [
  'GBAT10;118;20261024;C;10;2026;1900;0;-1800.00;;;;;;;;;;;;Wallmob 24.10.2026;;0;;1;;T;-1800.00;;',
  'GBAT10;118;20261024;C;10;2026;1580;0;-21950.00;;;;;;;;;;;;Wallmob 24.10.2026;;0;;1;;T;-21950.00;;',
  'GBAT10;118;20261024;C;10;2026;3000;3;22000.00;;;;;;;;;;;;Wallmob 24.10.2026;;0;;1;;T;22000.00;;',
  'GBAT10;118;20261024;C;10;2026;3010;31;1750.00;;;;;;;;;;;;Wallmob 24.10.2026;;0;;1;;T;1750.00;;',
].join('\n');

/**
 * Parses the GBAT10 file that the ExtendaGO (Wallmob) accounting integration delivers nightly to SFTP.
 * Format: https://www.extendago.com/wp-content/uploads/sites/3/2023/05/gbat10-mapping.pdf (30 semicolon
 * separated columns: 0 GBAT10, 1 report number, 2 date YYYYMMDD, 6 account, 7 VAT code (always 0 for
 * tenders), 8 amount with a dot as decimal separator, 20 description, 24 department). The mapping states
 * that tenders are reported negative and revenue including VAT positive; the sign is taken from the
 * tender lines so a file with the opposite convention books the same way.
 * Setup: https://www.extendago.com/wp-content/uploads/sites/3/2025/01/extendago-x-sharespine-accounting-integration-guide.pdf
 * (Settings → Integrations → Accounting with SFTP delivery).
 * @param {string} text
 * @returns {Voucher}
 */
export function parseGbat10(text) {
  const rows = text.replace(/^﻿/, '').split(/\r?\n/).map((r) => r.trim()).filter((r) => r.length > 0);
  if (rows.length === 0) throw new HttpError(400, 'The file is empty.');
  /** @type {Array<{ date: string, report: string, account: string, vatCode: string, amountMinor: number, description: string, department: string }>} */
  const parsed = [];
  for (const [i, row] of rows.entries()) {
    const c = row.split(';');
    if (c[0] !== 'GBAT10') throw new HttpError(400, `Line ${i + 1} is not a GBAT10 line. Upload the file ExtendaGO delivered to SFTP.`);
    const d = String(c[2] ?? '');
    const amount = String(c[8] ?? '').trim();
    if (!/^[0-9]{8}$/.test(d) || !/^-?[0-9]+(\.[0-9]{1,2})?$/.test(amount)) throw new HttpError(400, `Line ${i + 1} has an invalid date or amount.`);
    const account = String(c[6] ?? '').trim();
    if (!/^[0-9]{4}$/.test(account)) throw new HttpError(400, `Line ${i + 1} has account "${account}". Set four digit ReAI accounts in the ExtendaGO accounting settings.`);
    parsed.push({
      date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`,
      report: String(c[1] ?? '').trim(),
      account,
      vatCode: String(c[7] ?? '').trim() || '0',
      amountMinor: Math.round(Number(amount) * 100),
      description: String(c[20] ?? '').trim(),
      department: String(c[24] ?? '').trim(),
    });
  }
  const dates = [...new Set(parsed.map((p) => p.date))];
  if (dates.length !== 1) throw new HttpError(400, 'The file contains more than one report date. Upload one daily file at a time.');
  const tenderSum = parsed.filter((p) => p.vatCode === '0' && p.account.startsWith('1')).reduce((t, p) => t + p.amountMinor, 0);
  const sign = tenderSum > 0 ? 1 : -1;
  const lines = parsed
    .filter((p) => p.amountMinor !== 0)
    .map((p) => ({
      account: p.account,
      vatCode: p.vatCode,
      department: p.department,
      signedMinor: sign * p.amountMinor,
      description: `${BRAND} ${p.description || p.date}${p.department ? ` · dept ${p.department}` : ''}`.slice(0, 200),
    }));
  const debitMinor = lines.filter((l) => l.signedMinor > 0).reduce((t, l) => t + l.signedMinor, 0);
  const creditMinor = lines.filter((l) => l.signedMinor < 0).reduce((t, l) => t - l.signedMinor, 0);
  const reports = [...new Set(parsed.map((p) => p.report).filter(Boolean))];
  return { date: dates[0] ?? '', ref: `report ${reports.join(', ')}`, lines, debitMinor, creditMinor };
}

/** @param {Voucher} v @param {boolean} isSample */
function renderPreview(v, isSample) {
  const diff = v.debitMinor - v.creditMinor;
  const balanced = diff === 0 && v.debitMinor > 0;
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI REVIEW VOUCHER`,
    title: `${v.ref} · ${v.date}`,
    badge: balanced ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }) : reaiBadge({ text: `Diff ${formatMinor(Math.abs(diff))}`, tone: 'danger' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Tenders (debit)', value: formatMinor(v.debitMinor) })}
        ${reaiMetric({ label: 'Revenue incl. VAT (credit)', value: formatMinor(v.creditMinor) })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Posting</th><th>VAT code</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${v.lines.map((l) => html`<tr><td class="mono">${l.account}</td><td>${l.description}</td><td class="mono">${l.vatCode}</td><td class="num">${l.signedMinor > 0 ? formatMinor(l.signedMinor) : ''}</td><td class="num">${l.signedMinor < 0 ? formatMinor(-l.signedMinor) : ''}</td></tr>`)}</tbody>
      </table></div>
      <p class="muted-note">Revenue lines are posted including VAT with the VAT code from the ExtendaGO accounting settings, so ReAI separates the taxable base and VAT. The code must be a ReAI output VAT code.</p>
      ${balanced && !isSample
        ? html`<form class="stack-sm confirm-box" hx-post="${BASE_PATH}/book" hx-target="#${SLUG}-book" hx-swap="innerHTML">
            <input type="hidden" name="voucherJson" value="${JSON.stringify(v)}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I verified these figures against the ${BRAND} Z-report and will attach it in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="${SLUG}-book" class="stack-sm"></div>`
        : isSample
          ? reaiCallout({ tone: 'info', body: `Sample ${BRAND} GBAT10 file loaded. Connect to ReAI and upload a real daily file above to book it.` })
          : reaiCallout({ tone: 'warn', body: 'Tenders and revenue do not balance in this file. Check the deviation account in the ExtendaGO accounting settings.' })}
    `,
  });
}

/**
 * Checks a VAT code from the GBAT10 file against the ReAI VAT codes.
 * @param {VatCode[]} codes
 * @param {string} code
 */
function knownOutputVatCode(codes, code) {
  const match = codes.find((c) => c.code === code);
  if (!match || match.reverseCharge || match.amountBasis !== 'vat_inclusive' || match.vatType === 'input_vat') throw new HttpError(400, `VAT code ${code} from ${BRAND} is not a ReAI output VAT code. Check the VAT codes in the ${BRAND} accounting settings.`);
  return match.code;
}

/**
 * Handles /app/extendago/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
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
        ${reaiCard({
          eyebrow: 'GBAT10 ACCOUNTING FILE',
          title: `Upload the daily ${BRAND} file`,
          body: html`<p class="muted-note">ExtendaGO delivers one GBAT10 file per day to the SFTP server set under Settings → Integrations → Accounting. Download it from that server and upload it here.</p>
            <form class="stack" hx-post="${BASE_PATH}/preview" hx-encoding="multipart/form-data" hx-target="#${SLUG}-output" hx-swap="innerHTML">
              ${reaiDropzone({ inputId: `${SLUG}-file`, name: 'file', accept: '.csv,.txt,text/csv,text/plain', label: `Choose ${BRAND} GBAT10 file`, hint: 'Semicolon separated GBAT10 file for one day.' })}
              <div class="inline-row">
                <button type="submit" class="button primary">Preview voucher</button>
                <button type="button" class="button secondary" hx-post="${BASE_PATH}/sample" hx-target="#${SLUG}-output" hx-swap="innerHTML">Load sample file</button>
              </div>
            </form>`,
        })}
        <div id="${SLUG}-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderPreview(parseGbat10(SAMPLE_FILE), true));
  try {
    const form = await request.formData();
    if (pathname === `${BASE_PATH}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a GBAT10 file first.');
      return htmlResponse(renderPreview(parseGbat10(decodeCsvBytes(new Uint8Array(await file.arrayBuffer()))), false));
    }
    if (pathname === `${BASE_PATH}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('confirm') !== 'on') throw new HttpError(400, 'Confirm the verification checkbox first.');
      const v = /** @type {Voucher} */ (JSON.parse(String(form.get('voucherJson') ?? '{}')));
      if (!Array.isArray(v.lines) || !v.lines.length || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(v.date))) throw new HttpError(400, 'Voucher is empty.');
      const sum = v.lines.reduce((t, l) => t + Math.round(Number(l.signedMinor)), 0);
      if (sum !== 0 || !v.lines.every((l) => /^[0-9]{4}$/.test(String(l.account)))) throw new HttpError(400, 'Voucher must balance to 0.00.');
      // GBAT10 has no currency column; amounts are in the shop currency, which must be the company's accounting currency.
      const currencyCode = session.tenants.find((t) => t.id === session.tenantId)?.currencyCode ?? 'NOK';
      const marker = `${BRAND} ${String(v.ref).slice(0, 80)} ${v.date}`;
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (await reaiAll(env, '/api/vouchers', { ...auth, query: { startDate: v.date, endDate: v.date, includeReversed: 'true' } }));
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      const vatCodes = /** @type {VatCode[]} */ (await reaiRequest(env, '/api/vat-codes', auth));
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', {
        ...auth,
        method: 'POST',
        body: {
          date: v.date,
          description: marker,
          reviewReason: `${BRAND} GBAT10 file imported via apps.reai.no. Check against the ${BRAND} Z-report.`,
          postings: pairVoucherRows(v.lines.map((l) => ({
            accountNumber: String(l.account),
            postingDate: v.date,
            currencyCode,
            amount: Number((Math.round(Number(l.signedMinor)) / 100).toFixed(2)),
            vatCode: String(l.vatCode) === '0' ? '0' : knownOutputVatCode(vatCodes, String(l.vatCode)),
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
