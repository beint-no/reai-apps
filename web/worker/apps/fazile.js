// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/**
 * @typedef {{ leaseId: string, tenantName: string, email: string, startDate: string, monthlyRent: number, unit: string }} FazileLease
 * @typedef {{ id: number, name: string, email?: string | null, invoiceEmail?: string | null, archived?: boolean }} ReAICustomer
 */

const SAMPLE_FAZILE_CSV = [
  'LeaseID;Tenant;Email;Unit;StartDate;MonthlyRent',
  'FAZ-101;Nordic Studio AS;faktura@nordicstudio.no;Storgata 12, 3. etg;2026-11-01;24500,00',
  'FAZ-102;Fjord Konsult AS;post@fjordkonsult.no;Storgata 12, 4. etg;2026-11-01;18900,00',
].join('\n');

/** @param {string} raw */
function parseMoney(raw) {
  const n = Number(raw.replace(/[\s\u00A0]/g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** @param {string} csvText @returns {FazileLease[]} */
function parseFazileCsv(csvText) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const idIdx = norm.findIndex((h) => h.includes('lease') || h.includes('kontrakt') || h.includes('id'));
  const nameIdx = norm.findIndex((h) => h.includes('tenant') || h.includes('leietaker') || h.includes('kunde') || h.includes('name'));
  const emailIdx = norm.findIndex((h) => h.includes('email') || h.includes('epost'));
  const unitIdx = norm.findIndex((h) => h.includes('unit') || h.includes('objekt') || h.includes('lokale'));
  const startIdx = norm.findIndex((h) => h.includes('start') || h.includes('dato') || h.includes('date'));
  const rentIdx = norm.findIndex((h) => h.includes('rent') || h.includes('leie') || h.includes('belop') || h.includes('amount'));
  if (nameIdx < 0 || rentIdx < 0) throw new HttpError(400, 'CSV must include Tenant/Leietaker and MonthlyRent/Leie columns.');
  return doc.rows
    .map((r, i) => ({
      leaseId: idIdx >= 0 ? (r[idIdx] ?? `LEASE-${i + 1}`).trim() : `LEASE-${i + 1}`,
      tenantName: (r[nameIdx] ?? '').trim(),
      email: emailIdx >= 0 ? (r[emailIdx] ?? '').trim() : '',
      unit: unitIdx >= 0 ? (r[unitIdx] ?? 'Commercial lease').trim() : 'Commercial lease',
      startDate: startIdx >= 0 && /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test((r[startIdx] ?? '').trim()) ? (r[startIdx] ?? '').trim().slice(0, 10) : new Date().toISOString().slice(0, 10),
      monthlyRent: parseMoney(r[rentIdx] ?? '0'),
    }))
    .filter((l) => l.tenantName && l.monthlyRent > 0);
}

/** @param {{ leases: Array<{ lease: FazileLease, customerId: number | null }>, vatCode: string, isSample?: boolean }} state */
function renderFazilePreview(state) {
  const matched = state.leases.filter((l) => l.customerId !== null).length;
  return reaiCard({
    eyebrow: 'FAZILE → REAI SUBSCRIPTIONS',
    title: `${state.leases.length} commercial leases scanned`,
    badge: state.isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${matched} matched`, tone: matched > 0 ? 'success' : 'warn' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Leases', value: String(state.leases.length), detail: 'Staged with auto-billing off' })}
        ${reaiMetric({ label: 'Matched tenants', value: `${matched} / ${state.leases.length}`, detail: 'By email or exact name' })}
        ${reaiMetric({ label: 'VAT code', value: state.vatCode, detail: 'Applied to staged lease lines' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Lease</th><th>Tenant</th><th>Unit</th><th>Start</th><th class="num">Monthly rent</th><th>Action</th></tr></thead>
        <tbody>${state.leases.map(
          ({ lease, customerId }, idx) => html`<tr id="fz-row-${idx}">
            <td class="mono">${lease.leaseId}</td><td><strong>${lease.tenantName}</strong></td><td>${lease.unit}</td><td class="mono">${lease.startDate}</td>
            <td class="num">${formatMinor(Math.round(lease.monthlyRent * 100))} NOK</td>
            <td>${state.isSample || !customerId
              ? html`<span class="muted-note">${state.isSample ? 'Demo only' : 'No matching ReAI customer'}</span>`
              : html`<form hx-post="/app/fazile/stage" hx-target="#fz-row-${idx}" hx-swap="outerHTML">
                  <input type="hidden" name="leaseId" value="${lease.leaseId}"><input type="hidden" name="unit" value="${lease.unit}">
                  <input type="hidden" name="startDate" value="${lease.startDate}"><input type="hidden" name="monthlyRent" value="${lease.monthlyRent.toFixed(2)}">
                  <input type="hidden" name="customerId" value="${customerId}"><input type="hidden" name="vatCode" value="${state.vatCode}">
                  <button type="submit" class="button primary">Stage subscription</button>
                </form>`}</td>
          </tr>`,
        )}</tbody>
      </table></div>
    `,
  });
}

/**
 * Handles /app/fazile/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/fazile';
  const title = 'Fazile Property Billing';
  const lead = 'Stage commercial property leases exported from Fazile as recurring ReAI billing subscriptions with automatic billing kept safely off until reviewed.';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">REAL ESTATE & LEASES</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-fazile-web', clientName: `ReAI ${title} (Web)` })}
        ${reaiCard({
          eyebrow: 'UPLOAD LEASE CSV',
          title: 'Upload Fazile lease schedule CSV',
          body: html`<form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#bill-output" hx-swap="innerHTML">
            <div class="inline-row"><div class="field"><label for="fz-vat">ReAI VAT code for leases</label><select id="fz-vat" name="vatCode"><option value="6">6 — VAT-exempt property rent (0%)</option><option value="3">3 — Voluntary VAT-registered lease (25%)</option></select></div></div>
            ${reaiDropzone({ inputId: 'bill-csv', name: 'file', accept: '.csv,text/csv,text/plain', label: 'Choose Fazile CSV', hint: 'CSV with LeaseID, Tenant, Email, Unit, StartDate, MonthlyRent columns.' })}
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

  if (pathname === `${basePath}/sample`) {
    const leases = parseFazileCsv(SAMPLE_FAZILE_CSV);
    return htmlResponse(renderFazilePreview({ leases: leases.map((lease, i) => ({ lease, customerId: i === 0 ? 12 : null })), vatCode: '6', isSample: true }));
  }

  try {
    const form = await request.formData();
    if (pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a CSV file or load the sample.');
      const csvText = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
      const session = await readSession(env, request);
      /** @type {ReAICustomer[]} */
      let customers = [];
      if (session && session.tenantId > 0) {
        customers = /** @type {ReAICustomer[]} */ (await reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId }));
      }
      const leases = parseFazileCsv(csvText);
      const vatCode = String(form.get('vatCode') ?? '6').trim();
      return htmlResponse(renderFazilePreview({
        vatCode,
        leases: leases.map((lease) => {
          const email = lease.email.toLowerCase();
          const match = customers.find(
            (c) => (email && ((c.email ?? '').toLowerCase() === email || (c.invoiceEmail ?? '').toLowerCase() === email)) || c.name.trim().toLowerCase() === lease.tenantName.trim().toLowerCase(),
          );
          return { lease, customerId: match?.id ?? null };
        }),
      }));
    }

    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    if (pathname === `${basePath}/stage`) {
      const leaseId = String(form.get('leaseId') ?? '').trim();
      const unit = String(form.get('unit') ?? 'Property lease').trim();
      const startDate = String(form.get('startDate') ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
      const monthlyRent = Number(form.get('monthlyRent') ?? '0');
      const customerId = Number(form.get('customerId') ?? '0');
      const vatCode = String(form.get('vatCode') ?? '6').trim();
      if (!leaseId || monthlyRent <= 0 || customerId <= 0) throw new HttpError(400, 'Lease ID, rent and customer are required.');
      const created = /** @type {{ id?: number }} */ (
        await reaiRequest(env, '/api/subscriptions', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: {
            customerId, startDate, intervalMonths: 1, billingTiming: 'in_advance', periodAlignment: 'start_date',
            outputMode: 'create_order', automaticBillingGeneration: false, currencyCode: 'NOK', billingLeadDays: 0, daysUntilDue: 14, sendEhf: false,
            internalComment: `Fazile lease ${leaseId} (${unit}). Staged from apps.reai.no with auto-billing off.`,
            subscriptionLines: [{ rowNumber: 1, itemName: `Rent ${unit} (${leaseId})`, quantity: 1, unitPrice: Number(monthlyRent.toFixed(2)), vatCode }],
          },
        })
      );
      return htmlResponse(html`<tr><td class="mono">${leaseId}</td><td>Customer #${customerId}</td><td>${unit}</td><td class="mono">${startDate}</td><td class="num">${formatMinor(Math.round(monthlyRent * 100))} NOK</td><td>${reaiBadge({ text: `Staged #${created.id ?? 'ok'}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Fazile error', body: err instanceof Error ? err.message : 'Operation failed.' }));
  }
  return errorResponse('Unknown Fazile route.', 404);
}
