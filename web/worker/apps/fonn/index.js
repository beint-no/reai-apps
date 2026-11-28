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

const SLUG = 'fonn';
const BASE_PATH = `/app/${SLUG}`;
const BRAND = 'Fonn';
const TITLE = 'Fonn Hours Sync';
const LEAD = 'Fetch Fonn time cards per project and log them as ReAI timesheet rows by employee and project.';
const MAX_PAGES = 50;
/** @type {import('../../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [{"name":"subscriptionKey","label":"Fonn API subscription key","type":"password","placeholder":"Ocp-Apim-Subscription-Key"},{"name":"accessToken","label":"Fonn access token","type":"password","placeholder":"Access token"},{"name":"organizationId","label":"Fonn organization ID (optional)","type":"text","placeholder":"Detected when empty","required":false},{"name":"projectNumber","label":"Fonn project number (optional)","type":"text","placeholder":"All projects","required":false},{"name":"fromDate","label":"From date","type":"date","defaultValue":"$MONTH_START"},{"name":"toDate","label":"To date","type":"date","defaultValue":"$TODAY"}];
/** @type {TradeRow[]} */
const SAMPLE_ROWS = [
  {
    "ref": "FONN-2026-11-02-1",
    "date": "2026-11-02",
    "customerName": "Bergen Bolig AS",
    "project": "Leilighetsbygg Damsgård",
    "employeeName": "Anders Snekker",
    "description": "Ordinær tid: Montering vinduer 3. etasje",
    "hours": 7.5,
    "amountExVat": 0
  },
  {
    "ref": "FONN-2026-11-03-2",
    "date": "2026-11-03",
    "customerName": "Bergen Bolig AS",
    "project": "Leilighetsbygg Damsgård",
    "employeeName": "Anders Snekker",
    "description": "Ordinær tid: Lekter og kledning",
    "hours": 8,
    "amountExVat": 0
  },
  {
    "ref": "FONN-2026-11-03-3",
    "date": "2026-11-03",
    "customerName": "Bergen Bolig AS",
    "project": "Leilighetsbygg Damsgård",
    "employeeName": "Mina Lærling",
    "description": "Overtid: Opprydding",
    "hours": 1.5,
    "amountExVat": 0
  }
];

const FONN_API = 'https://ws2.fonn.io/api';
const FONN_PAGE = 50;
const FONN_MAX_PROJECTS = 40;
const FONN_MAX_DAYS = 62;
const FONN_CONCURRENCY = 6;

/**
 * @param {string} path
 * @param {Record<string, string>} headers
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 * @returns {Promise<any>}
 */
function fonnGet(path, headers, fetchImpl) {
  return fetchJson(`${FONN_API}${path}`, { headers }, BRAND, fetchImpl);
}

/**
 * Runs async tasks with a small concurrency limit to respect Fonn's per subscription rate limit.
 * @template T, R
 * @param {T[]} items
 * @param {(item: T) => Promise<R>} task
 * @returns {Promise<R[]>}
 */
async function inBatches(items, task) {
  /** @type {R[]} */
  const out = [];
  for (let i = 0; i < items.length; i += FONN_CONCURRENCY) out.push(...(await Promise.all(items.slice(i, i + FONN_CONCURRENCY).map(task))));
  return out;
}

/** @param {string} day @param {number} days */
const addDays = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Finds the organization of the access token through a top level project (GET /projectsGroups, GET /projects/{id}).
 * @param {Record<string, string>} headers
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 * @returns {Promise<string>}
 */
async function discoverOrganization(headers, fetchImpl) {
  const top = await fonnGet(`/projectsGroups?page=1&limit=${FONN_PAGE}`, headers, fetchImpl);
  const first = (Array.isArray(top?.data) ? top.data : []).find((/** @type {any} */ p) => p.itemType === 'project');
  if (!first) throw new HttpError(400, 'Enter your Fonn organization ID: no top level project was found to detect it.');
  const project = await fonnGet(`/projects/${encodeURIComponent(first.id)}`, headers, fetchImpl);
  const id = String(project?.data?.organizationId?.id ?? '');
  if (!id) throw new HttpError(400, 'Enter your Fonn organization ID: it could not be detected.');
  return id;
}

/**
 * Fetches time cards per project and week from the Fonn API.
 * Docs: https://api-developer.fonn.io/getting-started (keys and headers) and the API Reference on
 * https://api-developer.fonn.io (operations "Returns organization projects", "Returns time cards",
 * "Returns project members", "Returns project client data", "Returns time classifications").
 * Auth: Ocp-Apim-Subscription-Key: <subscription key> and Authorization: <access token> (no Bearer prefix).
 * Endpoints: GET /organizations/{organizationId}/projects (page, limit, projectNumber),
 * GET /projects/{projectId}/time-cards/{periodFrom}, GET /projects/{projectId}/members,
 * GET /projects/{projectId}/client, GET /projects/{projectId}/time-classifications/{id}.
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<TradeRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const subscriptionKey = (creds.subscriptionKey ?? '').trim();
  const accessToken = (creds.accessToken ?? '').trim();
  const projectNumber = (creds.projectNumber ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!subscriptionKey || !accessToken) throw new HttpError(400, 'Enter your Fonn subscription key and access token.');
  if (from > to) throw new HttpError(400, 'From date must be on or before to date.');
  if (Date.parse(to) - Date.parse(from) > FONN_MAX_DAYS * 86_400_000) throw new HttpError(400, `Choose a period of at most ${FONN_MAX_DAYS} days.`);
  const headers = { 'Ocp-Apim-Subscription-Key': subscriptionKey, authorization: accessToken, accept: 'application/json' };
  let organizationId = (creds.organizationId ?? '').trim();
  if (!organizationId) organizationId = await discoverOrganization(headers, fetchImpl);
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) throw new HttpError(400, 'The Fonn organization ID must be a UUID.');

  /** @type {Array<{ id: string, name: string }>} */
  const projects = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams({ page: String(page), limit: String(FONN_PAGE) });
    if (projectNumber) q.set('projectNumber', projectNumber);
    const res = await fonnGet(`/organizations/${encodeURIComponent(organizationId)}/projects?${q}`, headers, fetchImpl);
    const batch = Array.isArray(res?.data) ? res.data : [];
    projects.push(...batch.map((/** @type {any} */ p) => ({ id: String(p.id), name: String(p.name ?? '') })));
    const pg = res?.meta?.pagination;
    if (batch.length < FONN_PAGE || !pg || !(Number(pg.nextPage) > Number(pg.currentPage))) break;
  }
  if (projects.length === 0) throw new HttpError(400, projectNumber ? `No Fonn project has number ${projectNumber}.` : 'The access token has no Fonn projects.');
  if (projects.length > FONN_MAX_PROJECTS) throw new HttpError(400, `Found ${projects.length} Fonn projects. Enter a project number to fetch one project at a time (limit ${FONN_MAX_PROJECTS}).`);

  /** @type {string[]} */
  const weeks = [];
  for (let d = from; d <= to; d = addDays(d, 7)) weeks.push(d);
  const jobs = projects.flatMap((p) => weeks.map((w) => ({ p, w })));
  const cardsPerJob = await inBatches(jobs, async ({ p, w }) => {
    const res = await fonnGet(`/projects/${encodeURIComponent(p.id)}/time-cards/${w}`, headers, fetchImpl);
    const list = Array.isArray(res?.data) ? res.data : Array.isArray(res?.data?.timeCards) ? res.data.timeCards : [];
    return list.map((/** @type {any} */ c) => ({ ...c, _project: p }));
  });
  /** @type {Map<string, any>} */
  const cards = new Map();
  for (const c of cardsPerJob.flat()) {
    const date = isoDate(c.date, '');
    if (!date || date < from || date > to || !(num(c.seconds) > 0)) continue;
    cards.set([c._project.id, c.userId, date, c.timeClassificationId, c.checklistItemId ?? ''].join('|'), { ...c, date });
  }
  const activeProjects = projects.filter((p) => [...cards.values()].some((c) => c._project.id === p.id));
  /** @type {Map<string, string>} */ const userName = new Map();
  /** @type {Map<string, string>} */ const clientName = new Map();
  await inBatches(activeProjects, async (p) => {
    const [members, client] = await Promise.all([
      fonnGet(`/projects/${encodeURIComponent(p.id)}/members?page=1&limit=100`, headers, fetchImpl).catch(() => null),
      fonnGet(`/projects/${encodeURIComponent(p.id)}/client`, headers, fetchImpl).catch(() => null),
    ]);
    for (const m of Array.isArray(members?.data) ? members.data : []) userName.set(String(m.id), [m.firstName, m.lastName].filter(Boolean).join(' ') || String(m.username ?? ''));
    if (client?.data?.clientName) clientName.set(p.id, String(client.data.clientName));
  });
  /** @type {Map<string, string>} */ const classification = new Map();
  const classKeys = [...new Set([...cards.values()].filter((c) => c.timeClassificationId).map((c) => `${c._project.id}|${c.timeClassificationId}`))];
  await inBatches(classKeys, async (k) => {
    const [pid, cid] = k.split('|');
    const res = await fonnGet(`/projects/${encodeURIComponent(pid ?? '')}/time-classifications/${encodeURIComponent(cid ?? '')}`, headers, fetchImpl).catch(() => null);
    if (res?.data?.name) classification.set(String(cid), String(res.data.name));
  });
  const rows = [...cards.values()].map((c, i) => ({
    ref: `FONN-${c.date}-${i + 1}`,
    date: c.date,
    customerName: clientName.get(c._project.id) ?? '—',
    project: c._project.name || '—',
    employeeName: userName.get(String(c.userId)) ?? '—',
    description: [classification.get(String(c.timeClassificationId)), String(c.note ?? '').trim()].filter(Boolean).join(': ') || `${BRAND} time card`,
    hours: Number((num(c.seconds) / 3600).toFixed(2)),
    amountExVat: 0,
  })).sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length === 0) throw new HttpError(400, `${BRAND} returned no time cards for ${from} to ${to}.`);
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
 * Handles /app/fonn/* routes.
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
        ${renderApiFetchCard({ basePath: BASE_PATH, targetId: `${SLUG}-output`, brand: BRAND, hint: 'You need an active subscription on the Fonn API developer portal (Profile → Subscription key) and an access token from Fonn: ORGANIZATION → Integrations → API → Generate token. Leave the organization ID empty to detect it. Periods up to 62 days.', fields: API_FIELDS, extraFields: html`${renderMappingFields(lists)}`, sampleAction: true })}
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
