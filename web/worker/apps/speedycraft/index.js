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

const SLUG = 'speedycraft';
const BASE_PATH = `/app/${SLUG}`;
const BRAND = 'SpeedyCraft';
const TITLE = 'SpeedyCraft Work Order Sync';
const LEAD = 'Fetch SpeedyCraft service hours and materials per work order, log the hours as ReAI timesheet rows and stage each work order total as a draft ReAI order.';
const MAX_PAGES = 50;
/** @type {import('../../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [{"name":"subjectId","label":"Devinco subjectId","type":"text","placeholder":"subjectId from Devinco"},{"name":"apiKey","label":"Devinco API key","type":"password","placeholder":"API key"},{"name":"clientGuid","label":"SpeedyCraft client ID (GUID)","type":"text","placeholder":"00000000-0000-0000-0000-000000000000"},{"name":"fromDate","label":"From date","type":"date","defaultValue":"$MONTH_START"},{"name":"toDate","label":"To date","type":"date","defaultValue":"$TODAY"}];
/** @type {TradeRow[]} */
const SAMPLE_ROWS = [
  {
    "ref": "A-24017-88121",
    "date": "2026-11-05",
    "customerName": "Borettslaget Lia",
    "project": "Service varmepumpe blokk B",
    "employeeName": "Per Elektriker",
    "description": "Arbeid montør: Bytte styrekort",
    "hours": 3.5,
    "amountExVat": 0
  },
  {
    "ref": "A-24017",
    "date": "2026-11-05",
    "customerName": "Borettslaget Lia",
    "project": "Service varmepumpe blokk B",
    "employeeName": "—",
    "description": "SpeedyCraft work order A-24017: Service varmepumpe blokk B",
    "hours": 0,
    "amountExVat": 6840
  }
];

const SC_API = 'https://api.speedycraft.devinco.com';
const SC_TOKEN_URL = 'https://connect.devinco.com/Token/GenerateAccessTokenFromCache';
const SC_PAGE = 200;
const SC_ID_CHUNK = 50;

/**
 * Reads a SpeedyCraft field by its documented PascalCase name, accepting camelCase JSON too.
 * @param {any} r
 * @param {string} name
 */
function sc(r, name) {
  return r?.[name] ?? r?.[name.charAt(0).toLowerCase() + name.slice(1)];
}

/**
 * Exchanges a Devinco subjectId and apiKey for a SpeedyCraft access token (Devinco Connect clientId 3).
 * The docs do not show the response body, so both a bare token and common JSON token fields are accepted.
 * @param {string} subjectId
 * @param {string} apiKey
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 * @returns {Promise<string>}
 */
async function scToken(subjectId, apiKey, fetchImpl) {
  const res = await fetchImpl(SC_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ clientId: 3, subjectId, apiKey }),
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new HttpError(400, `Devinco Connect ${res.status === 401 || res.status === 403 ? 'rejected the subjectId or API key' : `returned HTTP ${res.status}`}.`);
  const text = (await res.text()).trim();
  /** @type {unknown} */ let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* bare token */ }
  const token = typeof parsed === 'string'
    ? parsed
    : String(/** @type {any} */ (parsed)?.accessToken ?? /** @type {any} */ (parsed)?.access_token ?? /** @type {any} */ (parsed)?.token ?? '');
  if (!token) throw new HttpError(400, 'Devinco Connect returned no access token.');
  return token;
}

/**
 * Reads every page of a SpeedyCraft list endpoint (Filters, Page, PageSize; plain JSON array).
 * @param {string} entity
 * @param {string} filters
 * @param {Record<string, string>} headers
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 * @returns {Promise<any[]>}
 */
async function scList(entity, filters, headers, fetchImpl) {
  /** @type {any[]} */
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL(`/api/${entity}`, SC_API);
    if (filters) url.searchParams.set('Filters', filters);
    url.searchParams.set('Page', String(page));
    url.searchParams.set('PageSize', String(SC_PAGE));
    const batch = await fetchJson(url.toString(), { headers }, BRAND, fetchImpl);
    if (!Array.isArray(batch)) throw new HttpError(400, `${BRAND} returned an unexpected ${entity} response.`);
    all.push(...batch);
    if (batch.length < SC_PAGE) return all;
  }
  throw new HttpError(400, `${BRAND} returned more than ${MAX_PAGES * SC_PAGE} ${entity} rows. Choose a shorter period.`);
}

/**
 * Loads records by id using the documented OR syntax (Field==1|2|3), in bounded chunks.
 * @param {string} entity
 * @param {string} idField
 * @param {Array<string | number>} ids
 * @param {Record<string, string>} headers
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 */
async function scByIds(entity, idField, ids, headers, fetchImpl) {
  /** @type {any[]} */
  const all = [];
  const unique = [...new Set(ids.filter((id) => id !== null && id !== undefined && String(id) !== ''))];
  for (let i = 0; i < unique.length; i += SC_ID_CHUNK) {
    all.push(...(await scList(entity, `${idField}==${unique.slice(i, i + SC_ID_CHUNK).join('|')}`, headers, fetchImpl)));
  }
  return all;
}

/** @param {any} r */
const lineNet = (r) => num(sc(r, 'Quantity')) * num(sc(r, 'ModPrice') ?? sc(r, 'ModPriceOut')) * (1 - num(sc(r, 'ModDiscount')));

/**
 * Fetches service hours and materials per work order (Assignment) from the SpeedyCraft REST API.
 * Docs: https://www.devinco.com/developer/speedycraft/connect/ (token + headers),
 * https://www.devinco.com/developer/speedycraft/paging-filtering-and-sorting/ (Filters, Page, PageSize),
 * OpenAPI: https://api.speedycraft.devinco.com/openapi/v1.json
 * Auth: POST connect.devinco.com/Token/GenerateAccessTokenFromCache { clientId: 3, subjectId, apiKey },
 * then Authorization: Bearer <token> and clientId: <SpeedyCraft client GUID> on every API call.
 * Endpoints: GET /api/AssignmentService, /api/AssignmentProduct, /api/Assignment, /api/Customer, /api/Employee, /api/Service.
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<TradeRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const subjectId = (creds.subjectId ?? '').trim();
  const apiKey = (creds.apiKey ?? '').trim();
  const clientGuid = (creds.clientGuid ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!subjectId || !apiKey || !clientGuid) throw new HttpError(400, 'Enter the subjectId, API key and SpeedyCraft client ID from Devinco.');
  if (!/^[0-9a-f-]{36}$/i.test(clientGuid)) throw new HttpError(400, 'The SpeedyCraft client ID must be a GUID.');
  if (from > to) throw new HttpError(400, 'From date must be on or before to date.');
  const token = await scToken(subjectId, apiKey, fetchImpl);
  const headers = { authorization: `Bearer ${token}`, clientId: clientGuid, accept: 'application/json' };
  const dayAfter = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const [services, products, serviceTypes, employees] = await Promise.all([
    scList('AssignmentService', `ServiceDate>=${from},ServiceDate<${dayAfter},Approved!=2`, headers, fetchImpl),
    scList('AssignmentProduct', `RegDate>=${from},RegDate<${dayAfter}`, headers, fetchImpl),
    scList('Service', '', headers, fetchImpl),
    scList('Employee', '', headers, fetchImpl),
  ]);
  const liveServices = services.filter((r) => sc(r, 'SysDeleted') !== true && sc(r, 'ShowRecord') !== false);
  const liveProducts = products.filter((r) => sc(r, 'SysDeleted') !== true && sc(r, 'ShowRecord') !== false);
  const assignments = await scByIds('Assignment', 'AssignmentId', [...liveServices, ...liveProducts].map((r) => sc(r, 'AssignmentId')), headers, fetchImpl);
  const customers = await scByIds('Customer', 'CustomerId', assignments.map((a) => sc(a, 'CustomerId')), headers, fetchImpl);
  const serviceById = new Map(serviceTypes.map((s) => [String(sc(s, 'ServiceId')), s]));
  const employeeById = new Map(employees.map((e) => [String(sc(e, 'EmployeeId')), [sc(e, 'Firstname'), sc(e, 'Lastname')].filter(Boolean).join(' ')]));
  const assignmentById = new Map(assignments.map((a) => [String(sc(a, 'AssignmentId')), a]));
  const customerById = new Map(customers.map((c) => [String(sc(c, 'CustomerId')), [sc(c, 'ContactFirstname'), sc(c, 'CompanyLastname')].filter(Boolean).join(' ')]));
  /** @param {any} r */
  const context = (r) => {
    const a = assignmentById.get(String(sc(r, 'AssignmentId')));
    return {
      orderRef: String(sc(a, 'AssignmentIdtext') ?? sc(r, 'AssignmentId') ?? ''),
      customerName: customerById.get(String(sc(a, 'CustomerId'))) || '—',
      project: String(sc(a, 'Description') ?? '').trim() || '—',
    };
  };
  /** @type {TradeRow[]} */
  const rows = [];
  /** @type {Map<string, TradeRow>} */
  const orders = new Map();
  /** @param {any} r @param {string} date @param {number} amount */
  const addToOrder = (r, date, amount) => {
    if (amount <= 0) return;
    const c = context(r);
    const existing = orders.get(c.orderRef);
    if (existing) {
      existing.amountExVat = Number((existing.amountExVat + amount).toFixed(2));
      if (date > existing.date) existing.date = date;
      return;
    }
    orders.set(c.orderRef, { ref: c.orderRef, date, customerName: c.customerName, project: c.project, employeeName: '—', description: `${BRAND} work order ${c.orderRef}: ${c.project}`, hours: 0, amountExVat: Number(amount.toFixed(2)) });
  };
  for (const r of liveServices) {
    const date = isoDate(sc(r, 'ServiceDate'), to);
    const type = serviceById.get(String(sc(r, 'ServiceId')));
    const isAbsence = num(sc(type, 'ServiceType')) === 1;
    const countsAsHours = !isAbsence && sc(type, 'IncludeInTotal') !== false;
    const c = context(r);
    if (countsAsHours && num(sc(r, 'Quantity')) > 0) {
      rows.push({
        ref: `${c.orderRef}-${sc(r, 'AssignmentServiceId')}`,
        date,
        customerName: c.customerName,
        project: c.project,
        employeeName: employeeById.get(String(sc(r, 'EmployeeId'))) || '—',
        description: [sc(type, 'ServiceDescription'), String(sc(r, 'ServiceComment') ?? '').trim()].filter(Boolean).join(': ') || `${BRAND} service hours`,
        hours: Number(num(sc(r, 'Quantity')).toFixed(2)),
        amountExVat: 0,
      });
    }
    if (!isAbsence) addToOrder(r, date, lineNet(r));
  }
  for (const r of liveProducts) addToOrder(r, isoDate(sc(r, 'RegDate'), to), lineNet(r));
  rows.push(...orders.values());
  if (rows.length === 0) throw new HttpError(400, `${BRAND} returned no service hours or materials for ${from} to ${to}.`);
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
 * Handles /app/speedycraft/* routes.
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
        ${renderApiFetchCard({ basePath: BASE_PATH, targetId: `${SLUG}-output`, brand: BRAND, hint: 'Ask Devinco support (support@devinco.com) for a subjectId and API key for your user and the GUID of your SpeedyCraft client. Requires SpeedyCraft hosted in the Devinco cloud. Rejected hours are skipped.', fields: API_FIELDS, extraFields: html`${renderMappingFields(lists)}`, sampleAction: true })}
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
