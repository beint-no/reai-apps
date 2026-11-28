// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/** @typedef {{ leaseId: string, tenantName: string, unit: string, startDate: string, monthlyRent: number }} LeaseRow */

const SAMPLE_CSV = 'Kontrakt;Leietaker;Objekt;Startdato;Leie\nFEN-901;Nordic Konsult AS;Aker Brygge Kontor 4.etg (inkl. felleskost);2026-11-01;48500,00\nFEN-902;Fjord Tech AS;Aker Brygge Kontor 5.etg;2026-11-01;62000,00';

/** @param {string} raw */
function num(raw) {
  const n = Number(raw.replace(/[\s\u00A0]/g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** @param {string} csvText @returns {LeaseRow[]} */
function parseLeaseCsv(csvText) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const idIdx = norm.findIndex((h) => h.includes('kontrakt') || h.includes('lease') || h.includes('id'));
  const tIdx = norm.findIndex((h) => h.includes('leietaker') || h.includes('tenant') || h.includes('kunde'));
  const uIdx = norm.findIndex((h) => h.includes('bolig') || h.includes('objekt') || h.includes('unit'));
  const sIdx = norm.findIndex((h) => h.includes('start') || h.includes('dato'));
  const rIdx = norm.findIndex((h) => h.includes('leie') || h.includes('rent') || h.includes('belop'));
  if (tIdx < 0 || rIdx < 0) throw new HttpError(400, 'CSV must include Leietaker/Tenant and Husleie/Leie columns.');
  return doc.rows
    .map((r, i) => ({
      leaseId: idIdx >= 0 ? (r[idIdx] ?? `L-${i + 1}`).trim() : `L-${i + 1}`,
      tenantName: (r[tIdx] ?? '').trim(),
      unit: uIdx >= 0 ? (r[uIdx] ?? 'Lease').trim() : 'Lease',
      startDate: sIdx >= 0 && /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test((r[sIdx] ?? '').trim()) ? (r[sIdx] ?? '').trim().slice(0, 10) : new Date().toISOString().slice(0, 10),
      monthlyRent: num(r[rIdx] ?? '0'),
    }))
    .filter((x) => x.tenantName && x.monthlyRent > 0);
}

/** @param {Array<{ l: LeaseRow, customerId: number | null }>} leases @param {string} vatCode @param {boolean} isSample */
function renderLeases(leases, vatCode, isSample) {
  return reaiCard({
    eyebrow: 'FENISTRA → REAI SUBSCRIPTIONS',
    title: `${leases.length} lease schedules parsed`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `VAT code ${vatCode}`, tone: 'success' }),
    body: html`<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Contract</th><th>Tenant</th><th>Property / Unit</th><th>Start</th><th class="num">Monthly rent</th><th>Action</th></tr></thead>
      <tbody>${leases.map(
        ({ l, customerId }, idx) => html`<tr id="pr-l-${idx}">
          <td class="mono">${l.leaseId}</td><td><strong>${l.tenantName}</strong></td><td>${l.unit}</td><td class="mono">${l.startDate}</td>
          <td class="num">${formatMinor(Math.round(l.monthlyRent * 100))} NOK</td>
          <td>${isSample || !customerId
            ? html`<span class="muted-note">${isSample ? 'Demo only' : 'No matching ReAI customer'}</span>`
            : html`<form hx-post="/app/fenistra/stage" hx-target="#pr-l-${idx}" hx-swap="outerHTML">
                <input type="hidden" name="leaseId" value="${l.leaseId}"><input type="hidden" name="unit" value="${l.unit}">
                <input type="hidden" name="startDate" value="${l.startDate}"><input type="hidden" name="monthlyRent" value="${l.monthlyRent.toFixed(2)}">
                <input type="hidden" name="customerId" value="${customerId}"><input type="hidden" name="vatCode" value="${vatCode}">
                <button type="submit" class="button primary">Stage subscription</button>
              </form>`}</td>
        </tr>`,
      )}</tbody>
    </table></div>`,
  });
}

/**
 * Handles /app/fenistra/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/fenistra';
  const title = "Fenistra Commercial Property Billing";
  const lead = "Stage Fenistra commercial property & felleskostnader lease schedules as recurring ReAI subscriptions with automatic billing kept off until reviewed.";

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">REAL ESTATE & BOLIGFORVALTNING</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-fenistra-web', clientName: 'ReAI Fenistra (Web)' })}
        ${reaiCard({
          eyebrow: 'FENISTRA LEASE SCHEDULE',
          title: 'Upload Fenistra lease CSV',
          body: html`<form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#pr-output" hx-swap="innerHTML">
            <div class="inline-row"><div class="field"><label for="pr-vat">VAT code</label><select id="pr-vat" name="vatCode"><option value="6">6 — Residential / exempt rent (0%)</option><option value="3">3 — Voluntary VAT commercial lease (25%)</option></select></div></div>
            ${reaiDropzone({ inputId: 'pr-csv', name: 'file', accept: '.csv,text/csv,text/plain', label: 'Choose Fenistra CSV', hint: 'CSV with Kontrakt, Leietaker, Bolig/Objekt, Startdato, Husleie/Leie.' })}
            <div class="inline-row">
              <button type="submit" class="button primary">Preview leases</button>
              <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#pr-output" hx-swap="innerHTML">Load sample leases</button>
            </div>
          </form>`,
        })}
        <div id="pr-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${basePath}/sample`) {
    const parsed = parseLeaseCsv(SAMPLE_CSV);
    return htmlResponse(renderLeases(parsed.map((l, i) => ({ l, customerId: i === 0 ? 11 : null })), '3', true));
  }

  try {
    const form = await request.formData();
    if (pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a CSV file or load sample.');
      const parsed = parseLeaseCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer())));
      const vatCode = String(form.get('vatCode') ?? '3').trim();
      const session = await readSession(env, request);
      /** @type {Array<{ id: number, name?: string | null }>} */
      let custs = [];
      if (session && session.tenantId > 0) {
        custs = /** @type {Array<{ id: number, name?: string | null }>} */ (await reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId }));
      }
      return htmlResponse(renderLeases(parsed.map((l) => ({ l, customerId: custs.find((c) => (c.name ?? '').trim().toLowerCase() === l.tenantName.toLowerCase())?.id ?? null })), vatCode, false));
    }

    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    if (pathname === `${basePath}/stage`) {
      const leaseId = String(form.get('leaseId') ?? '').trim();
      const unit = String(form.get('unit') ?? '').trim();
      const startDate = String(form.get('startDate') ?? '').trim();
      const monthlyRent = Number(form.get('monthlyRent') ?? '0');
      const customerId = Number(form.get('customerId') ?? '0');
      const vatCode = String(form.get('vatCode') ?? '3').trim();
      const created = /** @type {{ id?: number }} */ (
        await reaiRequest(env, '/api/subscriptions', {
          token: session.accessToken, tenantId: session.tenantId, method: 'POST',
          body: {
            customerId, startDate, intervalMonths: 1, billingTiming: 'in_advance', periodAlignment: 'start_date',
            outputMode: 'create_order', automaticBillingGeneration: false, currencyCode: 'NOK', billingLeadDays: 0, daysUntilDue: 14, sendEhf: false,
            internalComment: `Fenistra lease ${leaseId} (${unit}). Staged with auto-billing off.`,
            subscriptionLines: [{ rowNumber: 1, itemName: `Rent ${unit} (${leaseId})`, quantity: 1, unitPrice: Number(monthlyRent.toFixed(2)), vatCode }],
          },
        })
      );
      return htmlResponse(html`<tr><td class="mono">${leaseId}</td><td>Customer #${customerId}</td><td>${unit}</td><td class="mono">${startDate}</td><td class="num">${formatMinor(Math.round(monthlyRent * 100))} NOK</td><td>${reaiBadge({ text: `Staged #${created.id ?? 'ok'}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Fenistra error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown property route.', 404);
}
