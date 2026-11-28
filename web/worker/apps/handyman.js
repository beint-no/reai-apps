// @ts-check
import { assertPublicHttpsUrl, fetchJson, isoDate, num, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/** @typedef {{ ref: string, date: string, customerName: string, description: string, hours: number, amountExVat: number, project: string }} TradeRow */
/** @typedef {{ id: number, name: string }} SimpleRef */

const BRAND = 'Handyman';
const TITLE = 'Handyman Field Service Sync';
const LEAD = 'Fetch completed Handyman service orders with technician hours and materials, and stage them as ReAI orders and timesheets.';
const MAX_ORDERS = 40;

/** @type {TradeRow[]} */
const SAMPLE_ROWS = [
  { ref: 'HM-7712', date: '2026-10-13', customerName: 'Senter Drift AS', description: 'Filterbytte og balansering aggregat 2', hours: 5.5, amountExVat: 7850, project: 'ServiceOrder' },
  { ref: 'HM-7719', date: '2026-10-19', customerName: 'Bergen Hotelldrift AS', description: 'Utbedring lekkasje teknisk rom', hours: 4, amountExVat: 6400, project: 'RepairOrder' },
];

/** @type {Record<number, string>} */
const ORDER_TYPES = { 0: 'WorkOrder', 10: 'InstallationOrder', 11: 'RepairOrder', 12: 'ServiceOrder', 13: 'InvoiceOrder' };

/**
 * Fetches completed service orders from a Handyman API server.
 * Docs: https://support.gsgroup.no/hc/en-us/articles/9651307325713 (Swagger: https://hmapi.gsgroup.io:19000/swagger/ui/index,
 * spec /swagger/docs/v1; API key in the `apiKey` header and the `HandymanClientId` header),
 * https://support.gsgroup.no/hc/en-us/articles/17674524711441 and /17762953047953 (API key and https setup in
 * Handyman ControlCenter on the customer's server), https://support.gsgroup.no/hc/en-us/articles/11054099455633
 * (GET /api/orders with Status=2 for completed, LastChanged, PageSize and StartIndex).
 * Per order: GET /api/orders/{orderId}/salarycoderegistrations (Amount, Unit 0 = hours, CustomerPrice),
 * GET /api/orders/{orderId}/materials (Quantity, CustomerPrice) and GET /api/customers/{id} (CustomerName).
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<TradeRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const apiKey = (creds.apiKey ?? '').trim();
  const clientId = (creds.clientId ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!apiKey || !clientId) throw new HttpError(400, 'Enter the Handyman API key and client number.');
  if (!(creds.baseUrl ?? '').trim()) throw new HttpError(400, 'Enter the https address of your Handyman API server.');
  if (to < from) throw new HttpError(400, 'The to date must be on or after the from date.');
  const base = assertPublicHttpsUrl(creds.baseUrl ?? '').origin;
  const headers = { apikey: apiKey, handymanclientid: clientId, accept: 'application/json' };

  /** @type {any[]} */ const orders = [];
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ status: '2', lastChanged: `${from}T00:00:00`, pageSize: '100', startIndex: String(page * 100), dateTimeBehaviour: '0' });
    const batch = await fetchJson(`${base}/api/orders?${query}`, { headers }, BRAND, fetchImpl);
    const items = Array.isArray(batch) ? batch : [];
    orders.push(...items);
    if (items.length < 100) break;
  }
  /** @param {any} o */
  const finished = (o) => isoDate(o.OrderHead?.ActualFinishDate ?? o.OrderHead?.FinishDate ?? o.LastChanged, '');
  const chosen = orders.filter((o) => !o.ExcludeFromInvoice && !o.OrderHead?.IsInternalOrder && finished(o) >= from && finished(o) <= to);
  if (chosen.length > MAX_ORDERS) throw new HttpError(400, `Handyman has ${chosen.length} completed orders in this period. Choose a shorter period (at most ${MAX_ORDERS} orders).`);

  /** @type {Map<number, string>} */ const customers = new Map();
  /** @type {TradeRow[]} */ const rows = [];
  for (const o of chosen) {
    const id = Number(o.HSId);
    const regs = await fetchJson(`${base}/api/orders/${id}/salarycoderegistrations?pageSize=1000`, { headers }, BRAND, fetchImpl);
    const mats = await fetchJson(`${base}/api/orders/${id}/materials?pageSize=1000`, { headers }, BRAND, fetchImpl);
    let hours = 0;
    let labour = 0;
    for (const r of /** @type {any[]} */ (Array.isArray(regs) ? regs : [])) {
      if (r.Rejected) continue;
      if (Number(r.Unit) === 0) hours += num(r.Amount);
      if (!r.ExcludeFromInvoice) labour += num(r.Amount) * num(r.CustomerPrice);
    }
    let materials = 0;
    for (const m of /** @type {any[]} */ (Array.isArray(mats) ? mats : [])) {
      if (!m.ExcludeFromInvoice) materials += num(m.Quantity) * num(m.CustomerPrice);
    }
    const fixed = num(o.OrderHead?.FixedPrice);
    const customerId = Number(o.CustomerReference?.Id ?? 0);
    if (customerId > 0 && !customers.has(customerId)) {
      const c = await fetchJson(`${base}/api/customers/${customerId}`, { headers }, BRAND, fetchImpl);
      customers.set(customerId, String(c?.CustomerName ?? '').trim());
    }
    rows.push({
      ref: `HM-${id}`,
      date: finished(o),
      customerName: customers.get(customerId) || '—',
      description: String(o.OrderHead?.OrderName ?? o.Description ?? '').trim() || `Handyman order ${id}`,
      hours: Number(hours.toFixed(2)),
      amountExVat: Number((fixed > 0 ? fixed : labour + materials).toFixed(2)),
      project: ORDER_TYPES[Number(o.OrderHead?.OrderType)] ?? 'Order',
    });
  }
  const billable = rows.filter((r) => r.hours > 0 || r.amountExVat > 0);
  if (billable.length === 0) throw new HttpError(400, `Handyman returned no completed orders with hours or amounts for ${from} to ${to}.`);
  return billable;
}

/** @param {{ rows: Array<{ row: TradeRow, customerId: number | null }>, defaultCustomerId: number, employeeId: number, projectId: number, isSample?: boolean }} state */
function renderPreview(state) {
  const totalHours = state.rows.reduce((s, r) => s + r.row.hours, 0);
  const totalAmt = state.rows.reduce((s, r) => s + r.row.amountExVat, 0);
  return reaiCard({
    eyebrow: 'HANDYMAN → REAI ORDERS & TIMESHEETS',
    title: `${state.rows.length} completed orders`,
    badge: state.isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Ready to stage', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Orders', value: String(state.rows.length), detail: 'Completed in Handyman' })}
        ${reaiMetric({ label: 'Total hours', value: `${totalHours.toFixed(2)} h`, detail: 'Hour salary codes only' })}
        ${reaiMetric({ label: 'Billable ex. VAT', value: `${formatMinor(Math.round(totalAmt * 100))} NOK`, detail: 'Fixed price, or labour and materials' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Ref</th><th>Date</th><th>Customer / Order</th><th class="num">Hours</th><th class="num">Ex. VAT</th><th>Action</th></tr></thead>
        <tbody>${state.rows.map(({ row, customerId }, idx) => {
          const cid = customerId ?? state.defaultCustomerId;
          return html`<tr id="hm-r-${idx}">
            <td class="mono">${row.ref}</td><td class="mono">${row.date}</td>
            <td><strong>${row.customerName}</strong><br><span class="muted-note">${row.project} · ${row.description}</span></td>
            <td class="num">${row.hours.toFixed(2)}</td><td class="num">${formatMinor(Math.round(row.amountExVat * 100))}</td>
            <td>${state.isSample
              ? html`<span class="muted-note">Demo only</span>`
              : html`<div class="inline-row">
                  ${row.amountExVat > 0 && cid > 0 ? html`<form hx-post="/app/handyman/create-order" hx-target="#hm-r-${idx}" hx-swap="outerHTML"><input type="hidden" name="ref" value="${row.ref}"><input type="hidden" name="date" value="${row.date}"><input type="hidden" name="description" value="${row.description}"><input type="hidden" name="amount" value="${row.amountExVat.toFixed(2)}"><input type="hidden" name="customerId" value="${cid}"><button type="submit" class="button primary">Stage order</button></form>` : ''}
                  ${row.hours > 0 && state.employeeId > 0 ? html`<form hx-post="/app/handyman/log-hours" hx-target="#hm-r-${idx}" hx-swap="outerHTML"><input type="hidden" name="date" value="${row.date}"><input type="hidden" name="hours" value="${row.hours.toFixed(2)}"><input type="hidden" name="description" value="[Handyman ${row.ref}] ${row.description}"><input type="hidden" name="employeeId" value="${state.employeeId}"><input type="hidden" name="projectId" value="${state.projectId}"><button type="submit" class="button secondary">Log hours</button></form>` : ''}
                  ${(row.amountExVat <= 0 || cid <= 0) && (row.hours <= 0 || state.employeeId <= 0) ? html`<span class="muted-note">Select customer or employee</span>` : ''}
                </div>`}</td>
          </tr>`;
        })}</tbody>
      </table></div>
    `,
  });
}

/**
 * Handles /app/handyman/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/handyman';
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    /** @type {SimpleRef[]} */ let customers = [];
    /** @type {SimpleRef[]} */ let employees = [];
    /** @type {SimpleRef[]} */ let projects = [];
    if (session && session.tenantId > 0) {
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const [c, e, p] = await Promise.all([
        reaiAll(env, '/api/customers', { ...auth, query: { archived: 'false' } }).catch(() => []),
        reaiRequest(env, '/api/employees', auth).catch(() => []),
        reaiAll(env, '/api/projects', auth).catch(() => []),
      ]);
      customers = /** @type {SimpleRef[]} */ (c);
      employees = Array.isArray(e) ? /** @type {SimpleRef[]} */ (e) : [];
      projects = /** @type {Array<SimpleRef & { archived?: boolean }>} */ (p).filter((x) => !x.archived);
    }
    const extraFields = html`<div class="mapping-grid">
      <div class="field"><label for="hm-cust">Fallback ReAI customer</label><select id="hm-cust" name="defaultCustomerId"><option value="0">${customers.length > 0 ? 'Match by name or choose…' : 'Connect to ReAI first'}</option>${customers.slice(0, 200).map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select></div>
      <div class="field"><label for="hm-emp">ReAI employee (timesheets)</label><select id="hm-emp" name="employeeId"><option value="0">${employees.length > 0 ? 'Select employee…' : 'Connect to ReAI first'}</option>${employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}</select></div>
      <div class="field"><label for="hm-proj">ReAI project (optional)</label><select id="hm-proj" name="projectId"><option value="0">No project</option>${projects.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></div>
    </div>`;
    const body = html`
      <section class="app-intro"><p class="eyebrow">FIELD SERVICE</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-handyman-web', clientName: 'ReAI Handyman (Web)' })}
        ${renderApiFetchCard({
          basePath,
          targetId: 'hm-output',
          brand: BRAND,
          hint: 'The Handyman API runs on your own Handyman server. Your IT partner must publish it over https. The API key and client number are set in Handyman ControlCenter under Integration.',
          fields: [
            { name: 'baseUrl', label: 'Handyman API address', type: 'url', placeholder: 'https://hmapi.example.no' },
            { name: 'apiKey', label: 'Handyman API key', type: 'password', placeholder: 'apiKey' },
            { name: 'clientId', label: 'Handyman client number', placeholder: 'HandymanClientId' },
            { name: 'fromDate', label: 'Completed from', type: 'date', defaultValue: '$MONTH_START' },
            { name: 'toDate', label: 'Completed to', type: 'date', defaultValue: '$TODAY' },
          ],
          extraFields,
          sampleAction: true,
        })}
        <div id="hm-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) {
    return htmlResponse(renderPreview({ rows: SAMPLE_ROWS.map((row) => ({ row, customerId: 1 })), defaultCustomerId: 1, employeeId: 1, projectId: 0, isSample: true }));
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
        custs = /** @type {SimpleRef[]} */ (await reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId, query: { archived: 'false' } }).catch(() => []));
      }
      const byName = new Map(custs.map((c) => [c.name.trim().toLowerCase(), c.id]));
      return htmlResponse(renderPreview({
        rows: parsed.map((row) => ({ row, customerId: byName.get(row.customerName.trim().toLowerCase()) ?? null })),
        defaultCustomerId: Number(form.get('defaultCustomerId') ?? '0'),
        employeeId: Number(form.get('employeeId') ?? '0'),
        projectId: Number(form.get('projectId') ?? '0'),
      }));
    }
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    if (pathname === `${basePath}/create-order`) {
      const ref = String(form.get('ref') ?? '').trim();
      const date = String(form.get('date') ?? '').slice(0, 10);
      const description = String(form.get('description') ?? BRAND).trim().slice(0, 255);
      const amount = Number(form.get('amount') ?? '0');
      const customerId = Number(form.get('customerId') ?? '0');
      if (!ref || customerId <= 0 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !(amount > 0)) throw new HttpError(400, 'A customer, date and positive amount are required.');
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/orders', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { customerId, currencyCode: 'NOK', daysUntilDue: 14, issueDate: date, orderDate: date, externalReference: `handyman-${ref}`.slice(0, 100), comment: `Handyman ${ref}`, orderLines: [{ itemName: description, quantity: 1, unitPrice: Number(amount.toFixed(2)) }] } }));
      const url = `${reaiOrigin(env)}/order/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(html`<tr><td class="mono">${ref}</td><td class="mono">${date}</td><td>${description}</td><td class="num">—</td><td class="num">${formatMinor(Math.round(amount * 100))}</td><td><a href="${url}" target="_blank" rel="noopener">Order #${created.id} ↗</a></td></tr>`);
    }
    if (pathname === `${basePath}/log-hours`) {
      const date = String(form.get('date') ?? '').slice(0, 10);
      const hours = Number(form.get('hours') ?? '0');
      const employeeId = Number(form.get('employeeId') ?? '0');
      const projectId = Number(form.get('projectId') ?? '0');
      const comment = String(form.get('description') ?? BRAND).slice(0, 1000);
      if (employeeId <= 0 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !(hours >= 0.01 && hours <= 24)) throw new HttpError(400, 'Valid employee, date and hours (0.01 to 24) are required.');
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/timesheets', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { employeeId, date, hours: Number(hours.toFixed(2)), ...(projectId > 0 ? { projectId } : {}), comment } }));
      return htmlResponse(html`<tr><td class="mono">—</td><td class="mono">${date}</td><td>${comment}</td><td class="num">${hours.toFixed(2)}</td><td class="num">—</td><td>${reaiBadge({ text: `Logged #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Handyman error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
