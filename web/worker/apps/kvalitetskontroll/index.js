// @ts-check
import { isoDate, num, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiRequest } from '../../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/** @typedef {{ ref: string, date: string, project: string, projectName: string, employeeName: string, description: string, hours: number }} TradeRow */
/** @typedef {{ id: number, name: string }} SimpleRef */
/** @typedef {{ employees: SimpleRef[], projects: SimpleRef[] }} ReaiLists */

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
  { ref: 'KS-10421', date: '2026-11-03', project: '2041 Rehabilitering bad Solveien', projectName: 'Rehabilitering bad Solveien', employeeName: 'Ola Tømrer', description: 'Ordinær tid: Riving og membran', hours: 7.5 },
  { ref: 'KS-10422', date: '2026-11-03', project: '2041 Rehabilitering bad Solveien', projectName: 'Rehabilitering bad Solveien', employeeName: 'Kari Lærling', description: 'Ordinær tid: Bæring og rydding', hours: 7.5 },
  { ref: 'KS-10437', date: '2026-11-04', project: '2050 Tilbygg Haugen', projectName: 'Tilbygg Haugen', employeeName: 'Ola Tømrer', description: 'Overtid 50%: Forskaling', hours: 2 },
];

const KS_API = 'https://api.kvalitetskontroll.no';
const KS_PAGE = 100;
const OSLO_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * One authenticated GET against the KS API. KS answers an invalid token with a 302 to its JWKS page.
 * @param {URL} url
 * @param {string} token
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 * @returns {Promise<any>}
 */
async function ksGet(url, token, fetchImpl) {
  const res = await fetchImpl(url.toString(), {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
    throw new HttpError(400, `${BRAND} rejected the token. Create a new personal access token at api.kvalitetskontroll.no/admin with a user that can see hours, employees and projects.`);
  }
  if (res.status === 429) throw new HttpError(429, `${BRAND} is rate limiting this token. Wait a minute and try again.`);
  if (!res.ok) throw new HttpError(400, `${BRAND} API returned HTTP ${res.status}.`);
  return res.json();
}

/**
 * Reads every page of a Kvalitetskontroll list endpoint (offset/limit). The maximum limit is not
 * documented, so the offset advances by the rows received and paging stops on an empty page or a
 * page without new ids.
 * @param {string} path
 * @param {Record<string, string>} query
 * @param {string} token
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 * @returns {Promise<any[]>}
 */
async function ksList(path, query, token, fetchImpl) {
  /** @type {Map<unknown, any>} */
  const byId = new Map();
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(path, KS_API);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(KS_PAGE));
    const payload = await ksGet(url, token, fetchImpl);
    const batch = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
    const before = byId.size;
    for (const item of batch) byId.set(item?.id ?? `${offset}:${byId.size}`, item);
    if (batch.length === 0 || byId.size === before) return [...byId.values()];
    offset += batch.length;
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
  const registrations = await ksList('/timetracking/registrations', { from_date: `${from}T00:00:00`, to_date: `${to}T23:59:59`, is_approved: '1' }, token, fetchImpl);
  const inPeriod = registrations.filter((r) => !r.deleted_at && r.is_approved !== false && osloDate(r.registration_date) >= from && osloDate(r.registration_date) <= to);
  if (inPeriod.length === 0) throw new HttpError(400, `${BRAND} returned no approved hours for ${from} to ${to}.`);
  const [employees, projects, hourTypes] = await Promise.all([
    ksList('/employees', {}, token, fetchImpl),
    inPeriod.some((r) => r.project?.id) ? ksList('/projects', {}, token, fetchImpl) : Promise.resolve([]),
    ksList('/timetracking/hourtypes', {}, token, fetchImpl),
  ]);
  const employeeName = new Map(employees.map((e) => [e.id, String(e.name ?? [e.first_name, e.last_name].filter(Boolean).join(' '))]));
  const project = new Map(projects.map((p) => [p.id, { label: `${p.project_no ? `${p.project_no} ` : ''}${p.name ?? ''}`.trim(), name: String(p.name ?? '') }]));
  const hourType = new Map(hourTypes.map((h) => [h.id, String(h.title ?? '')]));
  /** @type {TradeRow[]} */
  const rows = inPeriod
    .map((r) => {
      const type = hourType.get(r.hour_type?.id) ?? '';
      const comment = String(r.comment ?? '').trim();
      const p = project.get(r.project?.id);
      return {
        ref: `KS-${r.id}`,
        date: osloDate(r.registration_date),
        project: p?.label || String(r.temp_project_label ?? '') || '—',
        projectName: p?.name ?? '',
        employeeName: employeeName.get(r.user?.id) ?? '—',
        description: [type, comment].filter(Boolean).join(': ') || `${BRAND} hours`,
        hours: Math.round((num(r.duration) * 100) / 60) / 100,
      };
    })
    .filter((x) => x.date && x.hours > 0)
    .sort((x, y) => x.date.localeCompare(y.date) || x.employeeName.localeCompare(y.employeeName));
  if (rows.length === 0) throw new HttpError(400, `${BRAND} returned no approved hours for ${from} to ${to}.`);
  return rows;
}

/**
 * Loads the ReAI employees and active projects used for mapping (one employee call, projects at 200 per page).
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {import('../../lib/types.d.ts').SessionData | null} session
 * @returns {Promise<ReaiLists>}
 */
async function loadReaiLists(env, session) {
  if (!session || session.tenantId <= 0) return { employees: [], projects: [] };
  const auth = { token: session.accessToken, tenantId: session.tenantId };
  const [e, p] = await Promise.all([
    reaiRequest(env, '/api/employees', auth).catch(() => []),
    reaiAll(env, '/api/projects', { ...auth, query: { archived: 'false', hierarchy: 'all' } }).catch(() => []),
  ]);
  return {
    employees: Array.isArray(e) ? /** @type {SimpleRef[]} */ (e) : [],
    projects: /** @type {SimpleRef[]} */ (p),
  };
}

/** @param {string} s */
const key = (s) => s.trim().toLowerCase();

/**
 * Finds the ReAI project for a KS project: exact name match on "project_no name" or name, else the chosen project.
 * @param {Map<string, number>} projectByName
 * @param {TradeRow} row
 * @param {number} fallback
 */
function projectFor(projectByName, row, fallback) {
  return projectByName.get(key(row.project)) ?? (row.projectName ? projectByName.get(key(row.projectName)) : undefined) ?? fallback;
}

/** @param {{ rows: TradeRow[], lists: ReaiLists, defaultEmployeeId: number, projectId: number, isSample?: boolean }} state */
function renderPreview(state) {
  const employeeByName = new Map(state.lists.employees.map((e) => [key(e.name), e.id]));
  const projectByName = new Map(state.lists.projects.map((p) => [key(p.name), p.id]));
  const projectName = new Map(state.lists.projects.map((p) => [p.id, p.name]));
  const totalHours = state.rows.reduce((s, r) => s + Math.round(r.hours * 100), 0) / 100;
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI TIMESHEETS`,
    title: `${state.rows.length} approved registrations`,
    badge: state.isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Review before logging', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Rows', value: String(state.rows.length), detail: 'Each row is logged only when you click it' })}
        ${reaiMetric({ label: 'Hours', value: `${totalHours.toFixed(2)} h`, detail: 'Logged as ReAI timesheet rows' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Ref</th><th>Date</th><th>Project</th><th>Employee</th><th class="num">Hours</th><th>Action</th></tr></thead>
        <tbody>${state.rows.map((row, idx) => {
          const eid = employeeByName.get(key(row.employeeName)) ?? state.defaultEmployeeId;
          const pid = projectFor(projectByName, row, state.projectId);
          return html`<tr id="${SLUG}-r-${idx}">
            <td class="mono">${row.ref}</td><td class="mono">${row.date}</td>
            <td><strong>${row.project}</strong>${pid > 0 ? html`<br><span class="muted-note">ReAI: ${projectName.get(pid) ?? `#${pid}`}</span>` : ''}<br><span class="muted-note">${row.description}</span></td>
            <td>${row.employeeName}</td>
            <td class="num">${row.hours.toFixed(2)}</td>
            <td>${state.isSample
              ? html`<span class="muted-note">Demo only</span>`
              : eid > 0
                ? html`<form hx-post="${BASE_PATH}/log-hours" hx-target="#${SLUG}-r-${idx}" hx-swap="outerHTML"><input type="hidden" name="ref" value="${row.ref}"><input type="hidden" name="date" value="${row.date}"><input type="hidden" name="hours" value="${row.hours.toFixed(2)}"><input type="hidden" name="description" value="${row.description}"><input type="hidden" name="employeeId" value="${eid}"><input type="hidden" name="projectId" value="${pid}"><button type="submit" class="button secondary">Log hours</button></form>`
                : html`<span class="muted-note">No ReAI employee named ${row.employeeName}. Choose a fallback employee above.</span>`}</td>
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
    <div class="field"><label for="${SLUG}-proj">Fallback ReAI project (optional)</label><select id="${SLUG}-proj" name="projectId"><option value="0">Match by name or none</option>${lists.projects.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></div>
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
    return htmlResponse(renderPreview({ rows: SAMPLE_ROWS, lists: { employees: [], projects: [] }, defaultEmployeeId: 1, projectId: 0, isSample: true }));
  }

  try {
    const form = await request.formData();
    if (pathname === `${BASE_PATH}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) if (typeof v === 'string') creds[k] = v;
      const [rows, lists] = await Promise.all([fetchApi(creds), readSession(env, request).then((session) => loadReaiLists(env, session))]);
      return htmlResponse(renderPreview({ rows, lists, defaultEmployeeId: Number(creds.defaultEmployeeId ?? '0'), projectId: Number(creds.projectId ?? '0') }));
    }
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    const auth = { token: session.accessToken, tenantId: session.tenantId };
    const projectId = Number(form.get('projectId') ?? '0');
    if (pathname === `${BASE_PATH}/log-hours`) {
      const ref = String(form.get('ref') ?? '').trim();
      const date = isoDate(form.get('date'));
      const hours = Math.round(num(form.get('hours')) * 100) / 100;
      const employeeId = Number(form.get('employeeId') ?? '0');
      if (!/^KS-[0-9]+$/.test(ref) || employeeId <= 0 || hours < 0.01 || hours > 24) throw new HttpError(400, 'A KS registration, a ReAI employee and 0.01 to 24 hours are required.');
      const marker = `[${BRAND} ${ref}]`;
      const comment = `${marker} ${String(form.get('description') ?? '')}`.trim().slice(0, 1000);
      const existing = /** @type {Array<{ id: number | null, comment: string | null }>} */ (await reaiRequest(env, '/api/timesheets', { ...auth, query: { employeeId: String(employeeId), startDate: date, endDate: date } }));
      const dup = existing.find((t) => typeof t.comment === 'string' && t.comment.startsWith(marker));
      if (dup) return htmlResponse(html`<tr><td class="mono">${ref}</td><td class="mono">${date}</td><td>${comment}</td><td>—</td><td class="num">${hours.toFixed(2)}</td><td>${reaiBadge({ text: `Already logged #${dup.id ?? ''}`, tone: 'neutral' })}</td></tr>`);
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/timesheets', { ...auth, method: 'POST', body: { employeeId, date, hours, ...(projectId > 0 ? { projectId } : {}), comment } }));
      return htmlResponse(html`<tr><td class="mono">${ref}</td><td class="mono">${date}</td><td>${comment}</td><td>—</td><td class="num">${hours.toFixed(2)}</td><td>${reaiBadge({ text: `Logged #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
