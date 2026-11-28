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

const SLUG = 'ordrestyring';
const BASE_PATH = `/app/${SLUG}`;
const BRAND = 'Ordrestyring';
const TITLE = 'Ordrestyring Case Sync';
const LEAD = 'Fetch uninvoiced Ordrestyring hours and materials per case, log the hours as ReAI timesheet rows and stage each case total as a draft ReAI order.';
const MAX_PAGES = 50;
/** @type {import('../../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [{"name":"apiToken","label":"Ordrestyring API token","type":"password","placeholder":"Bearer token"},{"name":"fromDate","label":"From date","type":"date","defaultValue":"$MONTH_START"},{"name":"toDate","label":"To date","type":"date","defaultValue":"$TODAY"}];
/** @type {TradeRow[]} */
const SAMPLE_ROWS = [
  {
    "ref": "OS-88412",
    "date": "2026-11-04",
    "customerName": "Lillestrøm Eiendom AS",
    "project": "3105 Nytt sikringsskap",
    "employeeName": "Jonas Elektriker",
    "description": "Montør: Bytte hovedtavle",
    "hours": 6,
    "amountExVat": 0
  },
  {
    "ref": "OS-88415",
    "date": "2026-11-05",
    "customerName": "Lillestrøm Eiendom AS",
    "project": "3105 Nytt sikringsskap",
    "employeeName": "Jonas Elektriker",
    "description": "Montør: Kontroll og dokumentasjon",
    "hours": 2.5,
    "amountExVat": 0
  },
  {
    "ref": "3105",
    "date": "2026-11-05",
    "customerName": "Lillestrøm Eiendom AS",
    "project": "Nytt sikringsskap",
    "employeeName": "—",
    "description": "Ordrestyring case 3105: Nytt sikringsskap",
    "hours": 0,
    "amountExVat": 14250
  }
];

/** Norwegian accounts use graphql.ordrestyring.no, Danish accounts graphql.ordrestyring.dk. */
const OS_HOSTS = /** @type {const} */ ({ no: 'https://graphql.ordrestyring.no/graphql', dk: 'https://graphql.ordrestyring.dk/graphql' });
const OS_PAGE = 100;

const HOURS_QUERY = `query ($cursor: String, $limit: Int!, $from: Int!, $to: Int!) {
  hours(pagination: { cursor: $cursor, limit: $limit }, between: { field: startTime, from: $from, to: $to, toInclusivity: EXCLUSIVE }, filters: { isInvoiced: false }) {
    items { id startTime totalHours billableHours description salesPrice status transferState { state } user { id fullName } type { id name } case { id caseNumber projectName description customer { id name } } }
    hasMorePages nextCursor
  }
}`;

const MATERIALS_QUERY = `query ($cursor: String, $limit: Int!, $type: AddedBy!, $from: Int!, $to: Int!) {
  caseMaterials(type: $type, pagination: { cursor: $cursor, limit: $limit }, filters: { isInvoiced: false, createdAt: { from: $from, to: $to, toInclusivity: EXCLUSIVE } }) {
    items { id quantity description total materialDate createdAt transferState { state } case { id caseNumber projectName description customer { id name } } }
    hasMorePages nextCursor
  }
}`;

const OSLO_PARTS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Unix seconds of local midnight in Norway for an ISO day. @param {string} day */
function osloMidnight(day) {
  const utc = Date.parse(`${day}T00:00:00Z`);
  const p = Object.fromEntries(OSLO_PARTS.formatToParts(new Date(utc)).map((x) => [x.type, x.value]));
  const shownAsUtc = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
  return Math.round((utc - (shownAsUtc - utc)) / 1000);
}

/** @param {unknown} unix */
function osloDay(unix) {
  const n = num(unix);
  if (!n) return '';
  const p = Object.fromEntries(OSLO_PARTS.formatToParts(new Date(n * 1000)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * Runs one GraphQL query and follows nextCursor while hasMorePages is true.
 * @param {string} endpoint
 * @param {string} token
 * @param {string} query
 * @param {string} field
 * @param {Record<string, unknown>} variables
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 * @returns {Promise<any[]>}
 */
async function osAll(endpoint, token, query, field, variables, fetchImpl) {
  /** @type {any[]} */
  const all = [];
  /** @type {string | null} */
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await fetchJson(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query, variables: { ...variables, cursor, limit: OS_PAGE } }),
    }, BRAND, fetchImpl);
    if (Array.isArray(res?.errors) && res.errors.length > 0) throw new HttpError(400, `${BRAND} API error: ${String(res.errors[0]?.message ?? 'unknown').slice(0, 200)}`);
    const conn = res?.data?.[field];
    all.push(...(Array.isArray(conn?.items) ? conn.items : []));
    if (!conn?.hasMorePages || !conn.nextCursor) return all;
    cursor = String(conn.nextCursor);
  }
  throw new HttpError(400, `${BRAND} returned more than ${MAX_PAGES * OS_PAGE} rows. Choose a shorter period.`);
}

/**
 * Fetches uninvoiced hours and case materials from the Ordrestyring GraphQL API.
 * Docs: https://graphql.ordrestyring.dk/docs (auth, cursor pagination, errors, rate limits) and the schema in
 * https://graphql.ordrestyring.dk/graphiql (queries hours, caseMaterials; Money is in cents, UnixTime in seconds).
 * Auth: Authorization: Bearer <API token>, issued by Ordrestyring support.
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<TradeRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const endpoint = creds.region === 'dk' ? OS_HOSTS.dk : OS_HOSTS.no;
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!token) throw new HttpError(400, `Enter your ${BRAND} API token.`);
  if (from > to) throw new HttpError(400, 'From date must be on or before to date.');
  const nextDay = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const range = { from: osloMidnight(from), to: osloMidnight(nextDay) };
  const [hours, materials, expenses] = await Promise.all([
    osAll(endpoint, token, HOURS_QUERY, 'hours', range, fetchImpl),
    osAll(endpoint, token, MATERIALS_QUERY, 'caseMaterials', { ...range, type: 'MATERIAL' }, fetchImpl),
    osAll(endpoint, token, MATERIALS_QUERY, 'caseMaterials', { ...range, type: 'OTHER_EXPENSE' }, fetchImpl),
  ]);
  /** @param {any} c */
  const caseInfo = (c) => ({
    ref: String(c?.caseNumber ?? ''),
    customerName: String(c?.customer?.name ?? '').trim() || '—',
    project: String(c?.projectName ?? '').trim() || String(c?.description ?? '').trim().slice(0, 80) || '—',
  });
  /** @type {TradeRow[]} */
  const rows = [];
  /** @type {Map<string, TradeRow>} */
  const orders = new Map();
  /** @param {any} c @param {string} date @param {number} amount */
  const addToOrder = (c, date, amount) => {
    const info = caseInfo(c);
    if (!info.ref || amount <= 0) return;
    const existing = orders.get(info.ref);
    if (existing) {
      existing.amountExVat = Number((existing.amountExVat + amount).toFixed(2));
      if (date > existing.date) existing.date = date;
      return;
    }
    orders.set(info.ref, { ref: info.ref, date, customerName: info.customerName, project: info.project, employeeName: '—', description: `${BRAND} case ${info.ref}: ${info.project}`, hours: 0, amountExVat: Number(amount.toFixed(2)) });
  };
  for (const h of hours) {
    if (h.status === 'REJECTED') continue;
    const date = osloDay(h.startTime);
    if (!date) continue;
    const info = caseInfo(h.case);
    const total = Number(num(h.totalHours).toFixed(2));
    if (total > 0) {
      rows.push({
        ref: `OS-${h.id}`,
        date,
        customerName: info.customerName,
        project: info.ref ? `${info.ref} ${info.project}` : info.project,
        employeeName: String(h.user?.fullName ?? '').trim() || '—',
        description: [h.type?.name, String(h.description ?? '').trim()].filter(Boolean).join(': ') || `${BRAND} hours`,
        hours: total,
        amountExVat: 0,
      });
    }
    if (h.transferState?.state === 'NOT_TRANSFERED') addToOrder(h.case, date, num(h.salesPrice) / 100);
  }
  for (const m of [...materials, ...expenses]) {
    if (m.transferState?.state !== 'NOT_TRANSFERED') continue;
    addToOrder(m.case, osloDay(m.materialDate ?? m.createdAt) || to, num(m.total) / 100);
  }
  rows.push(...orders.values());
  if (rows.length === 0) throw new HttpError(400, `${BRAND} returned no uninvoiced hours or materials for ${from} to ${to}.`);
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
 * Handles /app/ordrestyring/* routes.
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
        ${renderApiFetchCard({ basePath: BASE_PATH, targetId: `${SLUG}-output`, brand: BRAND, hint: 'Ask Ordrestyring support for an API token for your company. Rejected hours are skipped, and hours or materials already in an Ordrestyring invoice draft are not staged again.', fields: API_FIELDS, extraFields: html`<div class="mapping-grid"><div class="field"><label for="ordrestyring-region">Ordrestyring account</label><select id="ordrestyring-region" name="region"><option value="no" selected>Norway (system.ordrestyring.no)</option><option value="dk">Denmark (ordrestyring.dk)</option></select></div></div>${renderMappingFields(lists)}`, sampleAction: true })}
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
