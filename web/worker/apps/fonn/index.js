// @ts-check
import { fetchJson, isoDate, num, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiRequest } from '../../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/** @typedef {{ ref: string, date: string, customerName: string, project: string, employeeName: string, description: string, hours: number }} TradeRow */
/** @typedef {{ id: number, name: string }} SimpleRef */
/** @typedef {{ employees: SimpleRef[], projects: SimpleRef[] }} ReaiLists */

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
    "ref": "FONN-2026-11-02-1a2b3c4d",
    "date": "2026-11-02",
    "customerName": "Bergen Bolig AS",
    "project": "Leilighetsbygg Damsgård",
    "employeeName": "Anders Snekker",
    "description": "Ordinær tid: Montering vinduer 3. etasje",
    "hours": 7.5
  },
  {
    "ref": "FONN-2026-11-03-5e6f7a8b",
    "date": "2026-11-03",
    "customerName": "Bergen Bolig AS",
    "project": "Leilighetsbygg Damsgård",
    "employeeName": "Anders Snekker",
    "description": "Ordinær tid: Lekter og kledning",
    "hours": 8
  },
  {
    "ref": "FONN-2026-11-03-9c0d1e2f",
    "date": "2026-11-03",
    "customerName": "Bergen Bolig AS",
    "project": "Leilighetsbygg Damsgård",
    "employeeName": "Mina Lærling",
    "description": "Overtid: Opprydding",
    "hours": 1.5
  }
];

const FONN_API = 'https://ws2.fonn.io/api';
const FONN_PAGE = 50;
/** Time card calls are one per project and week, so the period and project count share one budget. */
const FONN_MAX_CARD_CALLS = 30;
/** Total Fonn calls per fetch, well under the Workers subrequest limit. Name lookups use what is left. */
const FONN_BUDGET = 45;
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

/**
 * Short FNV-1a hash so a time card keeps the same reference across fetches (Fonn time cards have no id).
 * @param {string} text
 */
function stableHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
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
  let used = 0;
  /** @type {import('../../lib/api-http.js').FetchLike} */
  const counted = (input, init) => { used += 1; return fetchImpl(input, init); };
  let organizationId = (creds.organizationId ?? '').trim();
  if (!organizationId) organizationId = await discoverOrganization(headers, counted);
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) throw new HttpError(400, 'The Fonn organization ID must be a UUID.');

  /** @type {Array<{ id: string, name: string }>} */
  const projects = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams({ page: String(page), limit: String(FONN_PAGE) });
    if (projectNumber) q.set('projectNumber', projectNumber);
    const res = await fonnGet(`/organizations/${encodeURIComponent(organizationId)}/projects?${q}`, headers, counted);
    const batch = Array.isArray(res?.data) ? res.data : [];
    projects.push(...batch.map((/** @type {any} */ p) => ({ id: String(p.id), name: String(p.name ?? '') })));
    const pg = res?.meta?.pagination;
    if (batch.length < FONN_PAGE || !pg || !(Number(pg.nextPage) > Number(pg.currentPage))) break;
  }
  if (projects.length === 0) throw new HttpError(400, projectNumber ? `No Fonn project has number ${projectNumber}.` : 'The access token has no Fonn projects.');

  // GET /projects/{projectId}/time-cards/{periodFrom} returns the seven days starting at periodFrom
  // (documented example: periodFrom 2022-10-23 returns 23 to 29 October), so one call per project and week.
  /** @type {string[]} */
  const weeks = [];
  for (let d = from; d <= to; d = addDays(d, 7)) weeks.push(d);
  if (projects.length * weeks.length > FONN_MAX_CARD_CALLS) {
    throw new HttpError(400, `${projects.length} Fonn projects over ${weeks.length} weeks needs ${projects.length * weeks.length} time card requests (limit ${FONN_MAX_CARD_CALLS}). Enter a project number or choose a shorter period.`);
  }
  const jobs = projects.flatMap((p) => weeks.map((w) => ({ p, w })));
  const cardsPerJob = await inBatches(jobs, async ({ p, w }) => {
    const res = await fonnGet(`/projects/${encodeURIComponent(p.id)}/time-cards/${w}`, headers, counted);
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
  // Name lookups are optional: they use the budget left after the time card calls, members and client first.
  const activeProjects = projects.filter((p) => [...cards.values()].some((c) => c._project.id === p.id)).slice(0, Math.max(0, Math.floor((FONN_BUDGET - used) / 2)));
  /** @type {Map<string, string>} */ const userName = new Map();
  /** @type {Map<string, string>} */ const clientName = new Map();
  await inBatches(activeProjects, async (p) => {
    const [members, client] = await Promise.all([
      fonnGet(`/projects/${encodeURIComponent(p.id)}/members?page=1&limit=100`, headers, counted).catch(() => null),
      fonnGet(`/projects/${encodeURIComponent(p.id)}/client`, headers, counted).catch(() => null),
    ]);
    for (const m of Array.isArray(members?.data) ? members.data : []) userName.set(String(m.id), [m.firstName, m.lastName].filter(Boolean).join(' ') || String(m.username ?? ''));
    if (client?.data?.clientName) clientName.set(p.id, String(client.data.clientName));
  });
  /** @type {Map<string, string>} */ const classification = new Map();
  /** @type {Map<string, string>} */ const classProject = new Map();
  for (const c of cards.values()) if (c.timeClassificationId && !classProject.has(String(c.timeClassificationId))) classProject.set(String(c.timeClassificationId), c._project.id);
  const classKeys = [...classProject].map(([cid, pid]) => `${pid}|${cid}`).slice(0, Math.max(0, FONN_BUDGET - used));
  await inBatches(classKeys, async (k) => {
    const [pid, cid] = k.split('|');
    const res = await fonnGet(`/projects/${encodeURIComponent(pid ?? '')}/time-classifications/${encodeURIComponent(cid ?? '')}`, headers, counted).catch(() => null);
    if (res?.data?.name) classification.set(String(cid), String(res.data.name));
  });
  const rows = [...cards.entries()].map(([k, c]) => ({
    ref: `FONN-${c.date}-${stableHash(k)}`,
    date: c.date,
    customerName: clientName.get(c._project.id) ?? '—',
    project: c._project.name || '—',
    employeeName: userName.get(String(c.userId)) ?? '—',
    description: [classification.get(String(c.timeClassificationId)), String(c.note ?? '').trim()].filter(Boolean).join(': ') || `${BRAND} time card`,
    hours: Math.round(num(c.seconds) / 36) / 100,
  })).sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length === 0) throw new HttpError(400, `${BRAND} returned no time cards for ${from} to ${to}.`);
  return rows;
}

/**
 * Loads the ReAI employees and active projects used for mapping.
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {import('../../lib/types.d.ts').SessionData | null} session
 * @returns {Promise<ReaiLists>}
 */
async function loadReaiLists(env, session) {
  if (!session || session.tenantId <= 0) return { employees: [], projects: [] };
  const auth = { token: session.accessToken, tenantId: session.tenantId };
  const [e, p] = await Promise.all([
    reaiRequest(env, '/api/employees', auth).catch(() => []),
    reaiAll(env, '/api/projects', { ...auth, query: { archived: 'false' } }).catch(() => []),
  ]);
  return {
    employees: Array.isArray(e) ? /** @type {SimpleRef[]} */ (e) : [],
    projects: /** @type {SimpleRef[]} */ (p),
  };
}

/** @param {string} s */
const key = (s) => s.trim().toLowerCase();

/** @param {{ rows: TradeRow[], lists: ReaiLists, defaultEmployeeId: number, projectId: number, isSample?: boolean }} state */
function renderPreview(state) {
  const employeeByName = new Map(state.lists.employees.map((e) => [key(e.name), e.id]));
  const totalHours = state.rows.reduce((s, r) => s + r.hours, 0);
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI TIMESHEETS`,
    title: `${state.rows.length} time cards fetched`,
    badge: state.isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Review before logging', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Time cards', value: String(state.rows.length), detail: 'Each row is logged only when you click it' })}
        ${reaiMetric({ label: 'Hours', value: `${totalHours.toFixed(2)} h`, detail: 'Logged as ReAI timesheet rows' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Ref</th><th>Date</th><th>Customer / project</th><th>Employee</th><th class="num">Hours</th><th>Action</th></tr></thead>
        <tbody>${state.rows.map((row, idx) => {
          const eid = employeeByName.get(key(row.employeeName)) ?? state.defaultEmployeeId;
          return html`<tr id="${SLUG}-r-${idx}">
            <td class="mono">${row.ref}</td><td class="mono">${row.date}</td>
            <td><strong>${row.customerName}</strong><br><span class="muted-note">${row.project} · ${row.description}</span></td>
            <td>${row.employeeName}</td>
            <td class="num">${row.hours.toFixed(2)}</td>
            <td>${state.isSample
              ? html`<span class="muted-note">Demo only</span>`
              : row.hours > 0 && eid > 0
                ? html`<form hx-post="${BASE_PATH}/log-hours" hx-target="#${SLUG}-r-${idx}" hx-swap="outerHTML"><input type="hidden" name="ref" value="${row.ref}"><input type="hidden" name="date" value="${row.date}"><input type="hidden" name="hours" value="${row.hours.toFixed(2)}"><input type="hidden" name="description" value="${row.description}"><input type="hidden" name="employeeId" value="${eid}"><input type="hidden" name="projectId" value="${state.projectId}"><button type="submit" class="button primary">Log hours</button></form>`
                : html`<span class="muted-note">Choose a ReAI employee above</span>`}</td>
          </tr>`;
        })}</tbody>
      </table></div>
    `,
  });
}

/** @param {ReaiLists} lists */
function renderMappingFields(lists) {
  return html`<div class="mapping-grid">
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
    return htmlResponse(renderPreview({ rows: SAMPLE_ROWS, lists: { employees: [], projects: [] }, defaultEmployeeId: 1, projectId: 0, isSample: true }));
  }

  try {
    const form = await request.formData();
    if (pathname === `${BASE_PATH}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) if (typeof v === 'string') creds[k] = v;
      const rows = await fetchApi(creds);
      const lists = await loadReaiLists(env, await readSession(env, request));
      return htmlResponse(renderPreview({ rows, lists, defaultEmployeeId: Number(creds.defaultEmployeeId ?? '0'), projectId: Number(creds.projectId ?? '0') }));
    }
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    const auth = { token: session.accessToken, tenantId: session.tenantId };
    const projectId = Number(form.get('projectId') ?? '0');
    if (pathname === `${BASE_PATH}/log-hours`) {
      const date = isoDate(form.get('date'));
      const hours = Number(num(form.get('hours')).toFixed(2));
      const employeeId = Number(form.get('employeeId') ?? '0');
      const ref = String(form.get('ref') ?? '').trim();
      if (employeeId <= 0 || hours < 0.01 || hours > 24 || !/^FONN-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9a-f]{8}$/.test(ref)) throw new HttpError(400, 'A Fonn reference, a ReAI employee and 0.01 to 24 hours are required.');
      const marker = `[${BRAND} ${ref}]`;
      const comment = `${marker} ${String(form.get('description') ?? '').trim()}`.slice(0, 1000);
      const existing = /** @type {Array<{ id: number, comment?: string | null }>} */ (await reaiRequest(env, '/api/timesheets', { ...auth, query: { employeeId: String(employeeId), startDate: date, endDate: date } }));
      const dup = (Array.isArray(existing) ? existing : []).find((t) => typeof t.comment === 'string' && t.comment.startsWith(marker));
      if (dup) return htmlResponse(html`<tr><td class="mono">${ref}</td><td class="mono">${date}</td><td>${comment}</td><td>—</td><td class="num">${hours.toFixed(2)}</td><td>${reaiBadge({ text: `Already logged #${dup.id}`, tone: 'warn' })}</td></tr>`);
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/timesheets', { ...auth, method: 'POST', body: { employeeId, date, hours, ...(projectId > 0 ? { projectId } : {}), comment } }));
      return htmlResponse(html`<tr><td class="mono">${ref}</td><td class="mono">${date}</td><td>${comment}</td><td>—</td><td class="num">${hours.toFixed(2)}</td><td>${reaiBadge({ text: `Logged #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
