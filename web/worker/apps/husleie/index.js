// @ts-check
import { num } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone } from '../../lib/ui.js';
import { decodeCsvBytes, parseCsv } from '../../lib/csv.js';

/**
 * Husleie.no has an API, but its documentation and credentials are only given out by Husleie.no customer service.
 * This module therefore reads the documented export of the "Leieforhold" report (MinHusleie → Rapporter, download
 * as Excel/CSV, for professional landlords), which lists tenant, rental object, rent, due date and contract start/end:
 * https://husleie-no.zendesk.com/hc/no/articles/360009088880-Oversikt-over-leieforhold-under-Rapporter
 * Husleie.no does not publish the column headers, so columns are found by their Norwegian names.
 *
 * @typedef {{ leaseId: string, tenantName: string, email: string, unit: string, startDate: string, monthlyRent: number }} LeaseRow
 * @typedef {{ id: number, name?: string | null, email?: string | null, invoiceEmail?: string | null }} ReAICustomer
 * @typedef {{ code: string, rate: number, description: string, vatType: string, reverseCharge: boolean }} VatCode
 */

const BASE_PATH = '/app/husleie';
const TITLE = 'Husleie.no Lease Billing';
const LEAD = 'Stage the rental agreements in a Husleie.no Leieforhold report as ReAI subscriptions, with automatic billing off until you have reviewed them.';

const SAMPLE_CSV = 'Status;Leietaker;E-post;Leieobjekt;Husleie;Forfallsdato;Kontraktstart;Kontraktslutt\nAktiv;Kari Nordmann;kari@nordmann.no;Markveien 14, H0201;16 500,00;01.12.2026;01.11.2026;31.10.2029\nAktiv;Ola Hansen;;Markveien 14, H0302;18 200,00;01.12.2026;01.01.2027;\nAvsluttet;Per Berg;;Markveien 14, H0101;15 000,00;01.06.2026;01.06.2023;31.05.2026';

/**
 * Finds the first column whose normalized header equals one of the names, then one that starts with one.
 * @param {string[]} headers
 * @param {string[]} names
 */
function column(headers, names) {
  for (const n of names) {
    const i = headers.indexOf(n);
    if (i >= 0) return i;
  }
  for (const n of names) {
    const i = headers.findIndex((h) => h.startsWith(n));
    if (i >= 0) return i;
  }
  return -1;
}

/** @param {string} raw @returns {string} */
function parseDate(raw) {
  const s = raw.trim();
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(s)) return s.slice(0, 10);
  const m = /^([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{4})$/.exec(s);
  return m ? `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}` : '';
}

/**
 * First billing date: the contract start, or the first of next month for contracts that already run.
 * @param {string} contractStart
 */
function billingStart(contractStart) {
  const now = new Date();
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  return contractStart && contractStart > nextMonth ? contractStart : nextMonth;
}

/** @param {string} csvText @returns {LeaseRow[]} */
export function parseLeaseCsv(csvText) {
  const doc = parseCsv(csvText);
  const h = doc.headers.map((x) => x.toLowerCase().replace(/\s+/g, ' ').trim());
  const tIdx = column(h, ['leietaker', 'leietakere', 'leietakers navn']);
  const rIdx = column(h, ['husleie', 'månedsleie', 'leiebeløp']);
  const sIdx = column(h, ['kontraktstart', 'kontrakt start', 'startdato', 'leiestart', 'fra dato']);
  const uIdx = column(h, ['leieobjekt', 'adresse', 'bolig']);
  const eIdx = column(h, ['e-post', 'epost', 'e-postadresse', 'leietakers e-post']);
  const idIdx = column(h, ['leieforhold id', 'leieforhold', 'kontraktsnummer', 'id']);
  const stIdx = column(h, ['status']);
  if (tIdx < 0 || rIdx < 0) throw new HttpError(400, 'The file needs the Leietaker and Husleie columns from the Husleie.no Leieforhold report.');
  return doc.rows
    .filter((r) => stIdx < 0 || !/avsluttet/i.test(r[stIdx] ?? ''))
    .map((r, i) => ({
      leaseId: idIdx >= 0 && (r[idIdx] ?? '').trim() ? (r[idIdx] ?? '').trim().slice(0, 40) : `L-${i + 1}`,
      tenantName: (r[tIdx] ?? '').trim(),
      email: eIdx >= 0 ? (r[eIdx] ?? '').trim().toLowerCase() : '',
      unit: uIdx >= 0 ? (r[uIdx] ?? '').trim().slice(0, 120) || 'Bolig' : 'Bolig',
      startDate: billingStart(sIdx >= 0 ? parseDate(r[sIdx] ?? '') : ''),
      monthlyRent: Number(Math.max(0, num(r[rIdx])).toFixed(2)),
    }))
    .filter((x) => x.tenantName && x.monthlyRent > 0);
}

/**
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {{ accessToken: string, tenantId: number } | null} session
 * @returns {Promise<VatCode[]>}
 */
async function loadVatCodes(env, session) {
  if (!session || session.tenantId <= 0) return [];
  return /** @type {VatCode[]} */ (await reaiRequest(env, '/api/vat-codes', { token: session.accessToken, tenantId: session.tenantId, query: { usage: 'customer_invoice' } }));
}

/** @param {Array<{ l: LeaseRow, customerId: number | null }>} leases @param {string} vatCode @param {boolean} isSample */
function renderLeases(leases, vatCode, isSample) {
  return reaiCard({
    eyebrow: 'HUSLEIE.NO → REAI SUBSCRIPTIONS',
    title: `${leases.length} active rental agreements`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `VAT code ${vatCode}`, tone: 'success' }),
    body: html`<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Agreement</th><th>Tenant</th><th>Rental object</th><th>Billing starts</th><th class="num">Monthly rent</th><th>Action</th></tr></thead>
      <tbody>${leases.map(
        ({ l, customerId }, idx) => html`<tr id="pr-l-${idx}">
          <td class="mono">${l.leaseId}</td><td><strong>${l.tenantName}</strong>${l.email ? html`<div class="muted-note">${l.email}</div>` : ''}</td><td>${l.unit}</td><td class="mono">${l.startDate}</td>
          <td class="num">${formatMinor(Math.round(l.monthlyRent * 100))} NOK</td>
          <td>${isSample || !customerId
            ? html`<span class="muted-note">${isSample ? 'Demo only' : 'No matching ReAI customer'}</span>`
            : html`<form hx-post="${BASE_PATH}/stage" hx-target="#pr-l-${idx}" hx-swap="outerHTML">
                <input type="hidden" name="leaseId" value="${l.leaseId}"><input type="hidden" name="unit" value="${l.unit}">
                <input type="hidden" name="startDate" value="${l.startDate}"><input type="hidden" name="monthlyRent" value="${l.monthlyRent.toFixed(2)}">
                <input type="hidden" name="customerId" value="${customerId}"><input type="hidden" name="vatCode" value="${vatCode}">
                <button type="submit" class="button primary">Stage subscription</button>
              </form>`}</td>
        </tr>`,
      )}</tbody>
    </table></div>
    <p class="muted-note">Ended agreements are skipped. Agreements that already run start billing on the first of next month. Husleie.no still collects rent from tenants itself, so stage only agreements that ReAI will invoice.</p>`,
  });
}

/**
 * Handles /app/husleie/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE_PATH && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE_PATH}/`, request.url), 301);
  if (pathname === `${BASE_PATH}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    /** @type {VatCode[]} */ let codes = [];
    try { codes = await loadVatCodes(env, session); } catch { codes = []; }
    const body = html`
      <section class="app-intro"><p class="eyebrow">REAL ESTATE & BOLIGFORVALTNING</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-husleie-web', clientName: 'ReAI Husleie.no (Web)' })}
        ${reaiCard({
          eyebrow: 'HUSLEIE.NO LEIEFORHOLD REPORT',
          title: 'Upload the Leieforhold report',
          body: html`<form class="stack" hx-post="${BASE_PATH}/preview" hx-encoding="multipart/form-data" hx-target="#pr-output" hx-swap="innerHTML">
            <p class="muted-note">In MinHusleie, open Rapporter → Leieforhold and download the list as CSV below the table. The report is available to professional landlords.</p>
            <div class="inline-row"><div class="field"><label for="pr-vat">ReAI VAT code for rent</label><select id="pr-vat" name="vatCode">${codes.length
              ? codes.filter((c) => c.vatType !== 'input_vat' && !c.reverseCharge).sort((a, b) => a.rate - b.rate).map((c) => html`<option value="${c.code}">${c.code}: ${c.description}</option>`)
              : html`<option value="">Connect to ReAI to load VAT codes</option>`}</select></div></div>
            ${reaiDropzone({ inputId: 'pr-csv', name: 'file', accept: '.csv,text/csv,text/plain', label: 'Choose Leieforhold CSV', hint: 'Needs Leietaker and Husleie. Kontraktstart, Leieobjekt, E-post and Status are used when present.' })}
            <div class="inline-row">
              <button type="submit" class="button primary">Preview agreements</button>
              <button type="button" class="button secondary" hx-post="${BASE_PATH}/sample" hx-target="#pr-output" hx-swap="innerHTML">Load sample report</button>
            </div>
          </form>`,
        })}
        <div id="pr-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${BASE_PATH}/sample`) {
    const parsed = parseLeaseCsv(SAMPLE_CSV);
    return htmlResponse(renderLeases(parsed.map((l, i) => ({ l, customerId: i === 0 ? 11 : null })), '6', true));
  }

  try {
    const form = await request.formData();
    const session = await readSession(env, request);
    if (pathname === `${BASE_PATH}/preview`) {
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a CSV file or load the sample.');
      const parsed = parseLeaseCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer())));
      const vatCode = String(form.get('vatCode') ?? '').trim();
      const codes = await loadVatCodes(env, session);
      if (!codes.some((c) => c.code === vatCode)) throw new HttpError(400, 'Choose a ReAI VAT code for the rent.');
      const custs = /** @type {ReAICustomer[]} */ (await reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId }));
      return htmlResponse(renderLeases(parsed.map((l) => ({
        l,
        customerId: (custs.find((c) => l.email && ((c.invoiceEmail ?? '').toLowerCase() === l.email || (c.email ?? '').toLowerCase() === l.email))
          ?? custs.find((c) => (c.name ?? '').trim().toLowerCase() === l.tenantName.toLowerCase()))?.id ?? null,
      })), vatCode, false));
    }

    if (pathname === `${BASE_PATH}/stage`) {
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const leaseId = String(form.get('leaseId') ?? '').trim().slice(0, 40);
      const unit = String(form.get('unit') ?? '').trim().slice(0, 120);
      const startDate = String(form.get('startDate') ?? '').trim();
      const monthlyRent = Number(form.get('monthlyRent') ?? '0');
      const customerId = Number(form.get('customerId') ?? '0');
      const vatCode = String(form.get('vatCode') ?? '').trim();
      if (!(customerId > 0) || !(monthlyRent > 0) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(startDate)) throw new HttpError(400, 'Customer, start date and rent are required.');
      const codes = await loadVatCodes(env, session);
      if (!codes.some((c) => c.code === vatCode)) throw new HttpError(400, `VAT code ${vatCode} is not available for invoices in this ReAI company.`);
      const existing = /** @type {{ items: Array<{ id?: number | null, intervalMonths: number, active: boolean, amounts?: { discountedSubTotal?: number } }> }} */ (
        await reaiRequest(env, '/api/subscriptions', { token: session.accessToken, tenantId: session.tenantId, query: { customerId: String(customerId), pageSize: '200' } })
      );
      const dup = existing.items.find((x) => x.intervalMonths === 1 && Math.round(Number(x.amounts?.discountedSubTotal ?? -1) * 100) === Math.round(monthlyRent * 100));
      if (dup) {
        return htmlResponse(html`<tr><td class="mono">${leaseId}</td><td>Customer #${customerId}</td><td>${unit}</td><td class="mono">${startDate}</td><td class="num">${formatMinor(Math.round(monthlyRent * 100))} NOK</td><td>${reaiBadge({ text: `Already in ReAI #${dup.id ?? ''}`, tone: 'neutral' })}</td></tr>`);
      }
      const created = /** @type {{ id?: number, webUrl?: string }} */ (
        await reaiRequest(env, '/api/subscriptions', {
          token: session.accessToken, tenantId: session.tenantId, method: 'POST',
          body: {
            customerId, startDate, intervalMonths: 1, billingTiming: 'in_advance', periodAlignment: 'start_date',
            outputMode: 'create_order', automaticBillingGeneration: false, currencyCode: 'NOK', billingLeadDays: 0, daysUntilDue: 14, sendEhf: false,
            internalComment: `Husleie.no agreement ${leaseId} (${unit}). Staged from apps.reai.no with automatic billing off.`,
            subscriptionLines: [{ rowNumber: 1, itemName: `Husleie ${unit}`.slice(0, 200), quantity: 1, unitPrice: Number(monthlyRent.toFixed(2)), vatCode }],
          },
        })
      );
      return htmlResponse(html`<tr><td class="mono">${leaseId}</td><td>Customer #${customerId}</td><td>${unit}</td><td class="mono">${startDate}</td><td class="num">${formatMinor(Math.round(monthlyRent * 100))} NOK</td><td>${created.webUrl ? html`<a href="${created.webUrl}" target="_blank" rel="noopener">Subscription #${created.id ?? ''} ↗</a>` : reaiBadge({ text: `Staged #${created.id ?? 'ok'}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Husleie.no error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown property route.', 404);
}
