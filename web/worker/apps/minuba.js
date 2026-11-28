// @ts-check
import { fetchJson, isoDate, num, pickList, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/** @typedef {{ ref: string, date: string, customerName: string, description: string, hours: number, amountExVat: number, project: string }} TradeRow */
/** @typedef {{ id: number, name: string }} SimpleRef */

const BRAND = "Minuba";
const TITLE = "Minuba Work Order Sync";
const LEAD = "Import Minuba field work orders, materials and billable craftsman hours directly into ReAI draft customer orders and timesheets.";
const SAMPLE_CSV = "OrdreNr;Dato;Prosjekt;Kunde;Timer;Belop;Beskrivelse\nMNB-310;2026-10-14;Ladeboks Garasje;Borettslag Nord;8,00;18400,00;Montering 2x elbillader inkl. vern\nMNB-314;2026-10-20;Serviceavtale Q4;Kyst Fiskeri AS;10,00;11500,00;\u00c5rskontroll elektrisk anlegg";
/** @type {import('../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [{"name": "apiToken", "label": "Minuba API Bearer token", "type": "password", "placeholder": "Bearer token"}, {"name": "fromDate", "label": "From date", "type": "date", "defaultValue": "$MONTH_START"}, {"name": "toDate", "label": "To date", "type": "date", "defaultValue": "$TODAY"}];

/**
 * Fetches work orders / approved hours from Minuba REST API.
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<TradeRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!token) throw new HttpError(400, `Enter your ${BRAND} API token.`);
  const payload = await fetchJson(`https://api.minuba.dk/v1/orders?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, 'Minuba', fetchImpl);
  const rows = pickList(payload).map((r, i) => ({
    ref: String(r.orderNumber ?? r.ref ?? r.id ?? `MINUBA-${i + 1}`),
    date: isoDate(r.date ?? r.workDate ?? r.completedAt ?? r.createdAt, to),
    project: String(r.projectName ?? r.project?.name ?? r.project ?? '—'),
    customerName: String(r.customerName ?? r.customer?.name ?? r.customer ?? '—'),
    hours: Number(num(r.hours ?? r.ordinaryHours ?? r.durationHours ?? (num(r.minutes) / 60)).toFixed(2)),
    amountExVat: Number(num(r.amountExVat ?? r.totalExVat ?? r.netAmount ?? r.amount ?? 0).toFixed(2)),
    description: String(r.description ?? r.comment ?? r.workDescription ?? `${BRAND} work order`),
  })).filter((x) => x.hours > 0 || x.amountExVat > 0);
  if (rows.length === 0) throw new HttpError(400, `${BRAND} returned 0 billable entries for ${from}–${to}.`);
  return rows;
}

/** @param {string} csvText @returns {TradeRow[]} */
function parseTradeCsv(csvText) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const refIdx = norm.findIndex((h) => h.includes('ordre') || h.includes('order') || h.includes('ref') || h.includes('id'));
  const dateIdx = norm.findIndex((h) => h.includes('dato') || h.includes('date'));
  const projIdx = norm.findIndex((h) => h.includes('prosjekt') || h.includes('project'));
  const custIdx = norm.findIndex((h) => h.includes('kunde') || h.includes('customer'));
  const hrsIdx = norm.findIndex((h) => h.includes('timer') || h.includes('hour'));
  const amtIdx = norm.findIndex((h) => h.includes('belop') || h.includes('beløp') || h.includes('amount') || h.includes('sum'));
  const descIdx = norm.findIndex((h) => h.includes('beskrivelse') || h.includes('desc') || h.includes('tekst'));
  if (dateIdx < 0 || (hrsIdx < 0 && amtIdx < 0)) throw new HttpError(400, 'CSV must include Dato/Date and Timer/Hours or Beløp/Amount columns.');
  return doc.rows.map((r, i) => ({
    ref: refIdx >= 0 && (r[refIdx] ?? '').trim() ? (r[refIdx] ?? '').trim() : `MINUBA-${i + 1}`,
    date: (r[dateIdx] ?? '').trim().slice(0, 10),
    project: projIdx >= 0 ? (r[projIdx] ?? '').trim() || '—' : '—',
    customerName: custIdx >= 0 ? (r[custIdx] ?? '').trim() || '—' : '—',
    hours: hrsIdx >= 0 ? Number(Math.max(0, num(r[hrsIdx])).toFixed(2)) : 0,
    amountExVat: amtIdx >= 0 ? Number(Math.max(0, num(r[amtIdx])).toFixed(2)) : 0,
    description: descIdx >= 0 ? (r[descIdx] ?? '').trim() || 'Work order' : 'Work order',
  })).filter((x) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x.date) && (x.hours > 0 || x.amountExVat > 0));
}

/** @param {{ rows: Array<{ row: TradeRow, customerId: number | null }>, defaultCustomerId: number, employeeId: number, projectId: number, isSample?: boolean }} state */
function renderPreview(state) {
  const totalHours = state.rows.reduce((s, r) => s + r.row.hours, 0);
  const totalAmt = state.rows.reduce((s, r) => s + r.row.amountExVat, 0);
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI ORDERS & TIMESHEETS`,
    title: `${state.rows.length} work-order / hour rows parsed`,
    badge: state.isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Ready to sync', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Rows', value: String(state.rows.length), detail: 'Idempotent externalReference per order' })}
        ${reaiMetric({ label: 'Total hours', value: `${totalHours.toFixed(2)} h`, detail: 'Postable to /api/timesheets' })}
        ${reaiMetric({ label: 'Billable ex. VAT', value: `${formatMinor(Math.round(totalAmt * 100))} NOK`, detail: 'ReAI draft orders (25% VAT)' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Ref</th><th>Date</th><th>Customer / Project</th><th class="num">Hours</th><th class="num">Ex. VAT</th><th>Action</th></tr></thead>
        <tbody>${state.rows.map(({ row, customerId }, idx) => {
          const cid = customerId ?? state.defaultCustomerId;
          return html`<tr id="tr-r-${idx}">
            <td class="mono">${row.ref}</td><td class="mono">${row.date}</td>
            <td><strong>${row.customerName}</strong><br><span class="muted-note">${row.project} · ${row.description}</span></td>
            <td class="num">${row.hours.toFixed(2)}</td><td class="num">${formatMinor(Math.round(row.amountExVat * 100))}</td>
            <td>${state.isSample
              ? html`<span class="muted-note">Demo only</span>`
              : html`<div class="inline-row">
                  ${row.amountExVat > 0 && cid > 0 ? html`<form hx-post="/app/minuba/create-order" hx-target="#tr-r-${idx}" hx-swap="outerHTML"><input type="hidden" name="ref" value="${row.ref}"><input type="hidden" name="date" value="${row.date}"><input type="hidden" name="description" value="${row.description}"><input type="hidden" name="amount" value="${row.amountExVat.toFixed(2)}"><input type="hidden" name="customerId" value="${cid}"><button type="submit" class="button primary">Stage order</button></form>` : ''}
                  ${row.hours > 0 && state.employeeId > 0 ? html`<form hx-post="/app/minuba/log-hours" hx-target="#tr-r-${idx}" hx-swap="outerHTML"><input type="hidden" name="date" value="${row.date}"><input type="hidden" name="hours" value="${row.hours.toFixed(2)}"><input type="hidden" name="description" value="[${BRAND}] ${row.description}"><input type="hidden" name="employeeId" value="${state.employeeId}"><input type="hidden" name="projectId" value="${state.projectId}"><button type="submit" class="button secondary">Log hours</button></form>` : ''}
                  ${(row.amountExVat <= 0 || cid <= 0) && (row.hours <= 0 || state.employeeId <= 0) ? html`<span class="muted-note">Select customer/employee</span>` : ''}
                </div>`}</td>
          </tr>`;
        })}</tbody>
      </table></div>
    `,
  });
}

/**
 * Handles /app/minuba/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/minuba';
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    /** @type {SimpleRef[]} */ let customers = [];
    /** @type {SimpleRef[]} */ let employees = [];
    /** @type {SimpleRef[]} */ let projects = [];
    if (session && session.tenantId > 0) {
      try {
        const [c, e, p] = await Promise.all([
          reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId, query: { archived: 'false' } }),
          reaiRequest(env, '/api/employees', { token: session.accessToken, tenantId: session.tenantId }).catch(() => []),
          reaiAll(env, '/api/projects', { token: session.accessToken, tenantId: session.tenantId }).catch(() => []),
        ]);
        customers = /** @type {SimpleRef[]} */ (c);
        employees = Array.isArray(e) ? /** @type {SimpleRef[]} */ (e) : [];
        projects = /** @type {Array<SimpleRef & { archived?: boolean }>} */ (p).filter((x) => !x.archived);
      } catch { /* ignore */ }
    }
    const body = html`
      <section class="app-intro"><p class="eyebrow">CONSTRUCTION, CRAFTS & FIELD SERVICE</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-minuba-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({ basePath, targetId: 'tr-output', brand: BRAND, hint: "Paste a Minuba REST API Bearer access token to pull completed orders and billable hours.", fields: API_FIELDS, sampleAction: true })}
        ${reaiCard({
          eyebrow: `CSV IMPORT · ${BRAND.toUpperCase()}`,
          title: `Or upload ${BRAND} work-order / hours CSV`,
          body: html`<form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#tr-output" hx-swap="innerHTML">
            <div class="mapping-grid">
              <div class="field"><label for="tr-cust">Fallback ReAI customer</label><select id="tr-cust" name="defaultCustomerId"><option value="0">${customers.length > 0 ? 'Match by name or choose…' : 'Connect to ReAI first'}</option>${customers.slice(0, 200).map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select></div>
              <div class="field"><label for="tr-emp">ReAI employee (timesheets)</label><select id="tr-emp" name="employeeId"><option value="0">${employees.length > 0 ? 'Select employee…' : 'Connect to ReAI first'}</option>${employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}</select></div>
              <div class="field"><label for="tr-proj">ReAI project (optional)</label><select id="tr-proj" name="projectId"><option value="0">No project</option>${projects.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></div>
            </div>
            ${reaiDropzone({ inputId: 'tr-csv', name: 'file', accept: '.csv,text/csv,text/plain', label: `Choose ${BRAND} CSV`, hint: 'CSV with Dato, Prosjekt, Kunde, Timer, Beløp, Beskrivelse.' })}
            <div class="inline-row"><button type="submit" class="button primary">Preview CSV</button></div>
          </form>`,
        })}
        <div id="tr-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) {
    return htmlResponse(renderPreview({ rows: parseTradeCsv(SAMPLE_CSV).map((row) => ({ row, customerId: 1 })), defaultCustomerId: 1, employeeId: 1, projectId: 0, isSample: true }));
  }

  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      const parsed = await fetchApi(creds);
      const session = await readSession(env, request);
      /** @type {SimpleRef[]} */ let custs = [];
      if (session && session.tenantId > 0) {
        try { custs = /** @type {SimpleRef[]} */ (await reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId, query: { archived: 'false' } })); } catch { custs = []; }
      }
      const byName = new Map(custs.map((c) => [c.name.trim().toLowerCase(), c.id]));
      return htmlResponse(renderPreview({ rows: parsed.map((row) => ({ row, customerId: byName.get(row.customerName.trim().toLowerCase()) ?? null })), defaultCustomerId: 0, employeeId: 0, projectId: 0 }));
    }
    if (pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a CSV file first.');
      const parsed = parseTradeCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer())));
      const session = await readSession(env, request);
      /** @type {SimpleRef[]} */ let custs = [];
      if (session && session.tenantId > 0) {
        try { custs = /** @type {SimpleRef[]} */ (await reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId, query: { archived: 'false' } })); } catch { custs = []; }
      }
      const byName = new Map(custs.map((c) => [c.name.trim().toLowerCase(), c.id]));
      return htmlResponse(renderPreview({ rows: parsed.map((row) => ({ row, customerId: byName.get(row.customerName.trim().toLowerCase()) ?? null })), defaultCustomerId: Number(form.get('defaultCustomerId') ?? '0'), employeeId: Number(form.get('employeeId') ?? '0'), projectId: Number(form.get('projectId') ?? '0') }));
    }
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    if (pathname === `${basePath}/create-order`) {
      const ref = String(form.get('ref') ?? '').trim();
      const date = String(form.get('date') ?? '').slice(0, 10);
      const description = String(form.get('description') ?? BRAND).trim().slice(0, 255);
      const amount = Number(form.get('amount') ?? '0');
      const customerId = Number(form.get('customerId') ?? '0');
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/orders', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { customerId, currencyCode: 'NOK', daysUntilDue: 14, issueDate: date, orderDate: date, externalReference: `minuba-${ref}`.slice(0, 100), comment: `${BRAND} ${ref}`, orderLines: [{ itemName: description, quantity: 1, unitPrice: Number(amount.toFixed(2)) }] } }));
      const url = `${reaiOrigin(env)}/order/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(html`<tr><td class="mono">${ref}</td><td class="mono">${date}</td><td>${description}</td><td class="num">—</td><td class="num">${formatMinor(Math.round(amount * 100))}</td><td><a href="${url}" target="_blank" rel="noopener">Order #${created.id} ↗</a></td></tr>`);
    }
    if (pathname === `${basePath}/log-hours`) {
      const date = String(form.get('date') ?? '').slice(0, 10);
      const hours = Number(form.get('hours') ?? '0');
      const employeeId = Number(form.get('employeeId') ?? '0');
      const projectId = Number(form.get('projectId') ?? '0');
      const comment = String(form.get('description') ?? BRAND).slice(0, 1000);
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/timesheets', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { employeeId, date, hours: Number(hours.toFixed(2)), ...(projectId > 0 ? { projectId } : {}), comment } }));
      return htmlResponse(html`<tr><td class="mono">—</td><td class="mono">${date}</td><td>${comment}</td><td class="num">${hours.toFixed(2)}</td><td class="num">—</td><td>${reaiBadge({ text: `Logged #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
