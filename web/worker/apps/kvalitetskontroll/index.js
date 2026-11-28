// @ts-check
import { fetchJson, isoDate, num, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/** @typedef {{ ref: string, date: string, customerName: string, project: string, employeeName: string, description: string, hours: number, amountExVat: number }} TradeRow */
/** @typedef {{ id: number, name: string }} SimpleRef */
/** @typedef {{ customers: SimpleRef[], employees: SimpleRef[], projects: SimpleRef[] }} ReaiLists */

const SLUG = 'kvalitetskontroll';
const BASE_PATH = `/app/${SLUG}`;
const BRAND = 'Kvalitetskontroll';
const TITLE = 'Kvalitetskontroll Hours Sync';
const LEAD = 'Fetch approved hour registrations from Kvalitetskontroll (KS) and log them as ReAI timesheet rows by employee and project.';
const MAX_PAGES = 50;
/** @type {import('../../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [{"name":"apiToken","label":"Kvalitetskontroll personal access token","type":"password","placeholder":"Bearer token"},{"name":"fromDate","label":"From date","type":"date","defaultValue":"$MONTH_START"},{"name":"toDate","label":"To date","type":"date","defaultValue":"$TODAY"}];
/** @type {TradeRow[]} */
const SAMPLE_ROWS = [
  {
    "ref": "KS-10421",
    "date": "2026-11-03",
    "customerName": "—",
    "project": "2041 Rehabilitering bad Solveien",
    "employeeName": "Ola Tømrer",
    "description": "Ordinær tid: Riving og membran",
    "hours": 7.5,
    "amountExVat": 0
  },
  {
    "ref": "KS-10422",
    "date": "2026-11-03",
    "customerName": "—",
    "project": "2041 Rehabilitering bad Solveien",
    "employeeName": "Kari Lærling",
    "description": "Ordinær tid: Bæring og rydding",
    "hours": 7.5,
    "amountExVat": 0
  },
  {
    "ref": "KS-10437",
    "date": "2026-11-04",
    "customerName": "—",
    "project": "2050 Tilbygg Haugen",
    "employeeName": "Ola Tømrer",
    "description": "Overtid 50%: Forskaling",
    "hours": 2,
    "amountExVat": 0
  }
];

const KS_API = 'https://api.kvalitetskontroll.no';
const KS_PAGE = 100;
const OSLO_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * Reads every page of a Kvalitetskontroll list endpoint (offset/limit).
 * @param {string} path
 * @param {Record<string, string>} query
 * @param {string} token
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 * @returns {Promise<any[]>}
 */
async function ksList(path, query, token, fetchImpl) {
  /** @type {any[]} */
  const all = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(path, KS_API);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    url.searchParams.set('offset', String(page * KS_PAGE));
    url.searchParams.set('limit', String(KS_PAGE));
    const payload = await fetchJson(url.toString(), { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, BRAND, fetchImpl);
    const batch = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
    all.push(...batch);
    if (batch.length < KS_PAGE) return all;
  }
  throw new HttpError(400, `${BRAND} returned more than ${MAX_PAGES * KS_PAGE} rows. Choose a shorter period.`);
}

/** KS returns registration_date as UTC midnight of the local day, e.g. 2026-11-19T23:00:00Z for 20 November. @param {unknown} v */
function osloDate(v) {
  const d = new Date(String(v ?? ''));
  return Number.isNaN(d.getTime()) ? '' : OSLO_DATE.format(d);
}

/**
 * Fetches approved hour registrations from the Kvalitetskontroll API.
 * Docs: https://api.kvalitetskontroll.no/docs/ (OpenAPI 3.0.3: https://api.kvalitetskontroll.no/docs/openapi.yaml)
 * Auth: Authorization: Bearer <Personal Access Token> from https://api.kvalitetskontroll.no/admin
 * Endpoints: GET /timetracking/registrations (from_date, to_date, is_approved, offset, limit),
 * GET /employees, GET /projects, GET /timetracking/hourtypes. duration is in minutes after break.
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<TradeRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!token) throw new HttpError(400, `Enter your ${BRAND} personal access token.`);
  if (from > to) throw new HttpError(400, 'From date must be on or before to date.');
  const [registrations, employees, projects, hourTypes] = await Promise.all([
    ksList('/timetracking/registrations', { from_date: from, to_date: to, is_approved: '1' }, token, fetchImpl),
    ksList('/employees', {}, token, fetchImpl),
    ksList('/projects', {}, token, fetchImpl),
    ksList('/timetracking/hourtypes', {}, token, fetchImpl),
  ]);
  const employeeName = new Map(employees.map((e) => [e.id, String(e.name ?? [e.first_name, e.last_name].filter(Boolean).join(' '))]));
  const project = new Map(projects.map((p) => [p.id, `${p.project_no ? `${p.project_no} ` : ''}${p.name ?? ''}`.trim()]));
  const hourType = new Map(hourTypes.map((h) => [h.id, String(h.title ?? '')]));
  /** @type {TradeRow[]} */
  const rows = registrations
    .filter((r) => !r.deleted_at)
    .map((r) => {
      const type = hourType.get(r.hour_type?.id) ?? '';
      const comment = String(r.comment ?? '').trim();
      return {
        ref: `KS-${r.id}`,
        date: osloDate(r.registration_date),
        customerName: '—',
        project: project.get(r.project?.id) || String(r.temp_project_label ?? '') || '—',
        employeeName: employeeName.get(r.user?.id) ?? '—',
        description: [type, comment].filter(Boolean).join(': ') || `${BRAND} hours`,
        hours: Number((num(r.duration) / 60).toFixed(2)),
        amountExVat: 0,
      };
    })
    .filter((x) => x.date && x.hours > 0);
  if (rows.length === 0) throw new HttpError(400, `${BRAND} returned no approved hours for ${from} to ${to}.`);
  return rows;
}

/**
 * Loads the ReAI customers, employees and active projects used for mapping.
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {import('../../lib/types.d.ts').SessionData | null} session
 * @returns {Promise<ReaiLists>}
 */
async function loadReaiLists(env, session) {
  if (!session || session.tenantId <= 0) return { customers: [], employees: [], projects: [] };
  const auth = { token: session.accessToken, tenantId: session.tenantId };
  const [c, e, p] = await Promise.all([
    reaiAll(env, '/api/customers', { ...auth, query: { archived: 'false' } }).catch(() => []),
    reaiRequest(env, '/api/employees', auth).catch(() => []),
    reaiAll(env, '/api/projects', { ...auth, query: { archived: 'false' } }).catch(() => []),
  ]);
  return {
    customers: /** @type {SimpleRef[]} */ (c),
    employees: Array.isArray(e) ? /** @type {SimpleRef[]} */ (e) : [],
    projects: /** @type {SimpleRef[]} */ (p),
  };
}

/** @param {string} s */
const key = (s) => s.trim().toLowerCase();

/** @param {{ rows: TradeRow[], lists: ReaiLists, defaultCustomerId: number, defaultEmployeeId: number, projectId: number, isSample?: boolean }} state */
function renderPreview(state) {
  const customerByName = new Map(state.lists.customers.map((c) => [key(c.name), c.id]));
  const employeeByName = new Map(state.lists.employees.map((e) => [key(e.name), e.id]));
  const totalHours = state.rows.reduce((s, r) => s + r.hours, 0);
  const totalAmt = state.rows.reduce((s, r) => s + r.amountExVat, 0);
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI TIMESHEETS AND DRAFT ORDERS`,
    title: `${state.rows.length} rows fetched`,
    badge: state.isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Review before staging', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Rows', value: String(state.rows.length), detail: 'Each row is staged only when you click it' })}
        ${reaiMetric({ label: 'Hours', value: `${totalHours.toFixed(2)} h`, detail: 'Logged as ReAI timesheet rows' })}
        ${reaiMetric({ label: 'Invoice basis ex. VAT', value: `${formatMinor(Math.round(totalAmt * 100))} NOK`, detail: 'Staged as ReAI draft orders' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Ref</th><th>Date</th><th>Customer / project</th><th>Employee</th><th class="num">Hours</th><th class="num">Ex. VAT</th><th>Action</th></tr></thead>
        <tbody>${state.rows.map((row, idx) => {
          const cid = customerByName.get(key(row.customerName)) ?? state.defaultCustomerId;
          const eid = employeeByName.get(key(row.employeeName)) ?? state.defaultEmployeeId;
          return html`<tr id="${SLUG}-r-${idx}">
            <td class="mono">${row.ref}</td><td class="mono">${row.date}</td>
            <td><strong>${row.customerName}</strong><br><span class="muted-note">${row.project} · ${row.description}</span></td>
            <td>${row.employeeName}</td>
            <td class="num">${row.hours.toFixed(2)}</td><td class="num">${formatMinor(Math.round(row.amountExVat * 100))}</td>
            <td>${state.isSample
              ? html`<span class="muted-note">Demo only</span>`
              : html`<div class="inline-row">
                  ${row.amountExVat > 0 && cid > 0 ? html`<form hx-post="${BASE_PATH}/create-order" hx-target="#${SLUG}-r-${idx}" hx-swap="outerHTML"><input type="hidden" name="ref" value="${row.ref}"><input type="hidden" name="date" value="${row.date}"><input type="hidden" name="description" value="${row.description}"><input type="hidden" name="amount" value="${row.amountExVat.toFixed(2)}"><input type="hidden" name="customerId" value="${cid}"><input type="hidden" name="projectId" value="${state.projectId}"><button type="submit" class="button primary">Stage draft order</button></form>` : ''}
                  ${row.hours > 0 && eid > 0 ? html`<form hx-post="${BASE_PATH}/log-hours" hx-target="#${SLUG}-r-${idx}" hx-swap="outerHTML"><input type="hidden" name="date" value="${row.date}"><input type="hidden" name="hours" value="${row.hours.toFixed(2)}"><input type="hidden" name="description" value="[${BRAND} ${row.ref}] ${row.description}"><input type="hidden" name="employeeId" value="${eid}"><input type="hidden" name="projectId" value="${state.projectId}"><button type="submit" class="button secondary">Log hours</button></form>` : ''}
                  ${(row.amountExVat <= 0 || cid <= 0) && (row.hours <= 0 || eid <= 0) ? html`<span class="muted-note">Choose a ReAI customer or employee above</span>` : ''}
                </div>`}</td>
          </tr>`;
        })}</tbody>
      </table></div>
    `,
  });
}

/** @param {ReaiLists} lists */
function renderMappingFields(lists) {
  return html`<div class="mapping-grid">
    <div class="field"><label for="${SLUG}-cust">Fallback ReAI customer</label><select id="${SLUG}-cust" name="defaultCustomerId"><option value="0">${lists.customers.length > 0 ? 'Match by name or choose…' : 'Connect to ReAI first'}</option>${lists.customers.slice(0, 500).map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select></div>
    <div class="field"><label for="${SLUG}-emp">Fallback ReAI employee</label><select id="${SLUG}-emp" name="defaultEmployeeId"><option value="0">${lists.employees.length > 0 ? 'Match by name or choose…' : 'Connect to ReAI first'}</option>${lists.employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}</select></div>
    <div class="field"><label for="${SLUG}-proj">ReAI project (optional)</label><select id="${SLUG}-proj" name="projectId"><option value="0">No project</option>${lists.projects.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></div>
  </div>`;
}

/**
 * Handles /app/kvalitetskontroll/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE_PATH && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE_PATH}/`, request.url), 301);
  if (pathname === `${BASE_PATH}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const lists = await loadReaiLists(env, session);
    const body = html`
      <section class="app-intro"><p class="eyebrow">CONSTRUCTION, CRAFTS & FIELD SERVICE</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${SLUG}-web`, clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({ basePath: BASE_PATH, targetId: `${SLUG}-output`, brand: BRAND, hint: 'Create a personal access token at api.kvalitetskontroll.no/admin (log in with your Kvalitetskontroll user). Only approved hours are fetched.', fields: API_FIELDS, extraFields: html`${renderMappingFields(lists)}`, sampleAction: true })}
        <div id="${SLUG}-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE_PATH}/sample`) {
    return htmlResponse(renderPreview({ rows: SAMPLE_ROWS, lists: { customers: [], employees: [], projects: [] }, defaultCustomerId: 1, defaultEmployeeId: 1, projectId: 0, isSample: true }));
  }

  try {
    const form = await request.formData();
    if (pathname === `${BASE_PATH}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) if (typeof v === 'string') creds[k] = v;
      const rows = await fetchApi(creds);
      const lists = await loadReaiLists(env, await readSession(env, request));
      return htmlResponse(renderPreview({ rows, lists, defaultCustomerId: Number(creds.defaultCustomerId ?? '0'), defaultEmployeeId: Number(creds.defaultEmployeeId ?? '0'), projectId: Number(creds.projectId ?? '0') }));
    }
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    const auth = { token: session.accessToken, tenantId: session.tenantId };
    const projectId = Number(form.get('projectId') ?? '0');
    if (pathname === `${BASE_PATH}/create-order`) {
      const ref = String(form.get('ref') ?? '').trim();
      const date = isoDate(form.get('date'));
      const description = String(form.get('description') ?? BRAND).trim().slice(0, 255) || `${BRAND} ${ref}`;
      const amount = Number(num(form.get('amount')).toFixed(2));
      const customerId = Number(form.get('customerId') ?? '0');
      if (!ref || amount <= 0 || customerId <= 0) throw new HttpError(400, 'A reference, a positive amount and a ReAI customer are required.');
      const externalReference = `${SLUG}-${ref}`.slice(0, 100);
      const existing = /** @type {{ items: Array<{ id: number }> }} */ (await reaiRequest(env, '/api/orders', { ...auth, query: { externalReference, pageSize: '1' } }));
      const found = existing.items[0];
      const created = found ?? /** @type {{ id: number }} */ (await reaiRequest(env, '/api/orders', { ...auth, method: 'POST', body: { customerId, currencyCode: 'NOK', daysUntilDue: 14, issueDate: date, orderDate: date, externalReference, comment: `${BRAND} ${ref}`, ...(projectId > 0 ? { projectId } : {}), orderLines: [{ itemName: description, quantity: 1, unitPrice: amount }] } }));
      const url = `${reaiOrigin(env)}/order/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(html`<tr><td class="mono">${ref}</td><td class="mono">${date}</td><td>${description}</td><td>—</td><td class="num">—</td><td class="num">${formatMinor(Math.round(amount * 100))}</td><td><a href="${url}" target="_blank" rel="noopener">${found ? 'Already staged' : 'Draft order'} #${created.id} ↗</a></td></tr>`);
    }
    if (pathname === `${BASE_PATH}/log-hours`) {
      const date = isoDate(form.get('date'));
      const hours = Number(num(form.get('hours')).toFixed(2));
      const employeeId = Number(form.get('employeeId') ?? '0');
      const comment = String(form.get('description') ?? BRAND).slice(0, 1000);
      if (employeeId <= 0 || hours < 0.01 || hours > 24) throw new HttpError(400, 'A ReAI employee and 0.01 to 24 hours are required.');
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/timesheets', { ...auth, method: 'POST', body: { employeeId, date, hours, ...(projectId > 0 ? { projectId } : {}), comment } }));
      return htmlResponse(html`<tr><td class="mono">—</td><td class="mono">${date}</td><td>${comment}</td><td>—</td><td class="num">${hours.toFixed(2)}</td><td class="num">—</td><td>${reaiBadge({ text: `Logged #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
