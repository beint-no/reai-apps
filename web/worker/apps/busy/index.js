// @ts-check
import { isoDate, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiRequest } from '../../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard } from '../../lib/ui.js';

/** @typedef {{ id: string, date: string, hours: number, project: string, user: string, userEmail: string, comment: string, approved: boolean }} HoursRow */
/** @typedef {{ id: number, name: string, email?: string }} SimpleOpt */

const BRAND = 'Finago Busy';
const TITLE = 'Finago Busy Timesheet Sync';
const LEAD = 'Fetch hour entries from the Finago Busy API and post them to ReAI Timesheets by employee and project.';
const API = 'https://api.busy.no/v2';
const LIMIT = 100;
const MAX_ENTRY_PAGES = 30;
const MAX_PROJECT_LOOKUPS = 10;

/** @type {HoursRow[]} */
const SAMPLE_ROWS = [
  { id: '1552', date: '2026-10-15', hours: 6.5, project: '1042 Rådgivning Q4', user: 'Demo Consultant', userEmail: '', comment: 'Design og arkitekturworkshop', approved: true },
  { id: '1573', date: '2026-10-16', hours: 7.5, project: '1042 Rådgivning Q4', user: 'Demo Consultant', userEmail: '', comment: 'Implementering og test', approved: true },
];

/** @param {string} iso */
function osloDate(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

/**
 * Returns the UTC instant of 00:00 Europe/Oslo on a calendar day.
 * @param {string} day yyyy-MM-dd
 */
function osloMidnightMs(day) {
  const utc = Date.parse(`${day}T00:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', hourCycle: 'h23' }).format(new Date(utc)));
  return utc - hour * 3_600_000;
}

/**
 * Performs one Finago Busy GET with the documented 429 handling.
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 * @returns {Promise<any>}
 */
async function busyGet(url, headers, fetchImpl) {
  const res = await fetchImpl(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  if (res.status === 429) {
    const wait = res.headers.get('retry-after') ?? res.headers.get('ratelimit-reset') ?? '60';
    throw new HttpError(429, `${BRAND} rate limit reached. Wait ${wait} seconds and fetch again.`);
  }
  if (res.status === 401) throw new HttpError(400, `${BRAND} rejected the API token. Check that it is valid and not expired.`);
  if (res.status === 403) throw new HttpError(400, `${BRAND} token lacks a scope. Give it hourEntries:read, users:read and projects:read.`);
  if (!res.ok) throw new HttpError(400, `${BRAND} API returned HTTP ${res.status}.`);
  return res.json();
}

/**
 * Reads every page of a Finago Busy list endpoint ({ data: [] }, limit/offset paging).
 * @param {string} path
 * @param {URLSearchParams} query
 * @param {Record<string, string>} headers
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 * @param {number} maxPages
 * @returns {Promise<any[]>}
 */
async function busyList(path, query, headers, fetchImpl, maxPages) {
  /** @type {any[]} */ const all = [];
  for (let page = 0; page < maxPages; page++) {
    const q = new URLSearchParams(query);
    q.set('limit', String(LIMIT));
    q.set('offset', String(page * LIMIT));
    const data = await busyGet(`${API}${path}?${q}`, headers, fetchImpl);
    /** @type {any[]} */ const items = Array.isArray(data?.data) ? data.data : [];
    all.push(...items);
    if (items.length < LIMIT) return all;
  }
  throw new HttpError(400, `${BRAND} returned too many records. Choose a shorter period or filter by user.`);
}

/**
 * Fetches hour entries from the Finago Busy public API v2.
 * Docs: https://api.busy.no (OpenAPI at https://api.busy.no/v2/openapi.json): Bearer token from
 * workspace settings under integrations; GET /v2/hourEntries/ (startTimeFrom, startTimeTo, userIdIn,
 * orderBy, limit max 100, offset; scope hourEntries:read), GET /v2/users/ (users:read) and
 * GET /v2/projects/ or /v2/projects/{projectId} (projects:read). Responses wrap results in { data }.
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<HoursRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!token) throw new HttpError(400, `Enter your ${BRAND} API token.`);
  if (to < from) throw new HttpError(400, 'The to date must be on or after the from date.');
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const email = (creds.userEmail ?? '').trim().toLowerCase();
  const dayAfter = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  // startTimeFrom/startTimeTo are inclusive datetimes; bound them to Oslo calendar days.
  const query = new URLSearchParams({
    startTimeFrom: new Date(osloMidnightMs(from)).toISOString(),
    startTimeTo: new Date(osloMidnightMs(dayAfter) - 1).toISOString(),
    orderBy: 'createdAt',
    orderByDirection: 'asc',
  });
  const usersPromise = busyList('/users/', new URLSearchParams({ isActive: 'all' }), headers, fetchImpl, 10);
  /** @type {any[]} */ let users;
  /** @type {any[]} */ let entries;
  if (email) {
    users = await usersPromise;
    const user = users.find((u) => String(u.email ?? '').trim().toLowerCase() === email);
    if (!user) throw new HttpError(400, `No ${BRAND} user has the email ${creds.userEmail}.`);
    query.append('userIdIn', String(user.id));
    entries = await busyList('/hourEntries/', query, headers, fetchImpl, MAX_ENTRY_PAGES);
  } else {
    [users, entries] = await Promise.all([usersPromise, busyList('/hourEntries/', query, headers, fetchImpl, MAX_ENTRY_PAGES)]);
  }
  /** @type {Map<string, any>} */ const usersById = new Map(users.map((u) => [String(u.id), u]));
  const unique = [...new Map(entries.map((e) => [String(e.id), e])).values()];
  const onlyApproved = creds.onlyApproved === 'on';
  const projectIds = [...new Set(unique.map((e) => e.projectId).filter((p) => p !== null && p !== undefined).map(String))];
  /** @type {Map<string, string>} */ const projectNames = new Map();
  /** @param {any} p */
  const label = (p) => [p.number, p.name].filter(Boolean).join(' ');
  if (projectIds.length > 0 && projectIds.length <= MAX_PROJECT_LOOKUPS) {
    const found = await Promise.all(projectIds.map((id) => busyGet(`${API}/projects/${encodeURIComponent(id)}`, headers, fetchImpl)));
    for (const res of found) if (res?.data) projectNames.set(String(res.data.id), label(res.data));
  } else if (projectIds.length > MAX_PROJECT_LOOKUPS) {
    const list = await busyList('/projects/', new URLSearchParams({ isActive: 'all' }), headers, fetchImpl, MAX_PROJECT_LOOKUPS).catch(() => []);
    for (const p of list) projectNames.set(String(p.id), label(p));
  }
  const rows = unique
    .filter((e) => e.isActive !== false && e.stopTime && (!onlyApproved || e.approvalStatus === 'approved'))
    .map((e) => {
      const u = usersById.get(String(e.userId));
      return {
        id: String(e.id),
        date: osloDate(String(e.startTime ?? '')),
        hours: Number((Math.max(0, Number(e.totalMinutes ?? 0) - Number(e.breakDeductionMinutes ?? 0)) / 60).toFixed(2)),
        project: e.projectId ? (projectNames.get(String(e.projectId)) ?? `Project ${e.projectId}`) : '',
        user: String(u?.displayName ?? u?.email ?? ''),
        userEmail: String(u?.email ?? '').trim().toLowerCase(),
        comment: String(e.description ?? '').trim() || `${BRAND} hours`,
        approved: e.approvalStatus === 'approved',
      };
    })
    .filter((r) => r.date >= from && r.date <= to && r.hours >= 0.01 && r.hours <= 24)
    .sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id));
  if (rows.length === 0) throw new HttpError(400, `${BRAND} returned no ${onlyApproved ? 'approved ' : ''}hour entries for ${from} to ${to}.`);
  return rows;
}

/**
 * Chooses the ReAI employee per row: same email as the Busy user, else the selected employee when all rows belong to one Busy user.
 * @param {HoursRow[]} rows
 * @param {SimpleOpt[]} employees
 * @param {number} selected
 * @returns {number[]}
 */
function employeeForRows(rows, employees, selected) {
  /** @type {Map<string, number>} */ const byEmail = new Map(employees.filter((e) => e.email).map((e) => [String(e.email).trim().toLowerCase(), e.id]));
  const singleUser = new Set(rows.map((r) => r.userEmail || r.user)).size <= 1;
  return rows.map((r) => (r.userEmail && byEmail.get(r.userEmail)) || (singleUser ? selected : 0));
}

/** @param {string} id @param {string} comment */
function tagged(id, comment) {
  return `[Busy #${id}] ${comment}`;
}

/** @param {HoursRow[]} rows @param {number[]} empIds @param {number} projId @param {boolean} isSample */
function renderHours(rows, empIds, projId, isSample) {
  return reaiCard({
    eyebrow: 'FINAGO BUSY → REAI TIMESHEETS',
    title: `${rows.length} entries (${rows.reduce((s, r) => s + r.hours, 0).toFixed(2)} h)`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Ready', tone: 'success' }),
    body: html`<p class="muted-note">Rows go to the ReAI employee with the same email as the Busy user. The selected employee is used when every row belongs to one Busy user.</p><div class="table-wrap"><table class="data-table">
      <thead><tr><th>Date</th><th>Project</th><th>Comment</th><th class="num">Hours</th><th>Action</th></tr></thead>
      <tbody>${rows.map((r, idx) => {
        const empId = empIds[idx] ?? 0;
        return html`<tr id="wf-h-${idx}"><td class="mono">${r.date}</td><td>${r.project || '—'}${r.user ? html`<br><span class="muted-note">${r.user}${r.approved ? '' : ' · not approved'}</span>` : ''}</td><td>${r.comment}</td><td class="num">${r.hours.toFixed(2)}</td><td>${isSample || empId <= 0 ? html`<span class="muted-note">${isSample ? 'Demo only' : r.userEmail ? `No ReAI employee with ${r.userEmail}` : 'Select employee above'}</span>` : html`<form hx-post="/app/busy/import" hx-target="#wf-h-${idx}" hx-swap="outerHTML"><input type="hidden" name="employeeId" value="${empId}"><input type="hidden" name="projectId" value="${projId}"><input type="hidden" name="date" value="${r.date}"><input type="hidden" name="hours" value="${r.hours.toFixed(2)}"><input type="hidden" name="comment" value="${tagged(r.id, r.comment)}"><button type="submit" class="button primary">Post to ReAI</button></form>`}</td></tr>`;
      })}</tbody>
    </table></div>`,
  });
}

/**
 * Handles /app/busy/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/busy';
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    /** @type {SimpleOpt[]} */ let employees = [];
    /** @type {SimpleOpt[]} */ let projects = [];
    if (session && session.tenantId > 0) {
      const [e, p] = await Promise.all([
        reaiRequest(env, '/api/employees', { token: session.accessToken, tenantId: session.tenantId }).catch(() => []),
        reaiAll(env, '/api/projects', { token: session.accessToken, tenantId: session.tenantId }).catch(() => []),
      ]);
      employees = Array.isArray(e) ? /** @type {SimpleOpt[]} */ (e) : [];
      projects = /** @type {Array<SimpleOpt & { archived?: boolean }>} */ (p).filter((x) => !x.archived);
    }
    const extraFields = html`<div class="mapping-grid">
      <div class="field"><label for="wf-emp">ReAI employee</label><select id="wf-emp" name="employeeId"><option value="0">${employees.length > 0 ? 'Select employee…' : 'Connect to ReAI first'}</option>${employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}</select></div>
      <div class="field"><label for="wf-proj">ReAI project (optional)</label><select id="wf-proj" name="projectId"><option value="0">No project</option>${projects.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></div>
    </div>
    <label class="check-row"><input type="checkbox" name="onlyApproved" checked> Only approved hour entries</label>`;
    const body = html`
      <section class="app-intro"><p class="eyebrow">TIME TRACKING & PROJECTS</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-busy-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({
          basePath,
          targetId: 'wfm-output',
          brand: BRAND,
          hint: 'An admin creates the API token in Finago Busy workspace settings under Integrations, with the scopes hourEntries:read, users:read and projects:read. Enter a user email to fetch one person only.',
          fields: [
            { name: 'apiToken', label: 'Finago Busy API token', type: 'password', placeholder: 'Bearer token' },
            { name: 'userEmail', label: 'Busy user email (optional)', required: false },
            { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
            { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
          ],
          extraFields,
          sampleAction: true,
        })}
        <div id="wfm-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${basePath}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) return htmlResponse(renderHours(SAMPLE_ROWS, SAMPLE_ROWS.map(() => 1), 0, true));
  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      const rows = await fetchApi(creds);
      const session = await readSession(env, request);
      /** @type {SimpleOpt[]} */ let employees = [];
      if (session && session.tenantId > 0) {
        const list = await reaiRequest(env, '/api/employees', { token: session.accessToken, tenantId: session.tenantId }).catch(() => []);
        employees = Array.isArray(list) ? /** @type {SimpleOpt[]} */ (list) : [];
      }
      return htmlResponse(renderHours(rows, employeeForRows(rows, employees, Number(form.get('employeeId') ?? '0')), Number(form.get('projectId') ?? '0'), false));
    }
    if (pathname === `${basePath}/import`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const employeeId = Number(form.get('employeeId') ?? '0');
      const projectId = Number(form.get('projectId') ?? '0');
      const date = String(form.get('date') ?? '').slice(0, 10);
      const hours = Number(form.get('hours') ?? '0');
      const comment = String(form.get('comment') ?? BRAND).slice(0, 1000);
      if (employeeId <= 0 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !(hours >= 0.01 && hours <= 24)) throw new HttpError(400, 'Valid employee, date and hours (0.01 to 24) are required.');
      const tag = /^\[Busy #\d+\]/.exec(comment)?.[0];
      if (tag) {
        const existing = /** @type {Array<{ id: number, comment?: string | null }>} */ (await reaiRequest(env, '/api/timesheets', { token: session.accessToken, tenantId: session.tenantId, query: { employeeId: String(employeeId), startDate: date, endDate: date } }));
        const hit = Array.isArray(existing) ? existing.find((t) => String(t.comment ?? '').startsWith(tag)) : undefined;
        if (hit) return htmlResponse(html`<tr><td class="mono">${date}</td><td>${projectId > 0 ? `Project #${projectId}` : '—'}</td><td>${comment}</td><td class="num">${hours.toFixed(2)}</td><td>${reaiBadge({ text: `Already in ReAI #${hit.id}`, tone: 'neutral' })}</td></tr>`);
      }
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/timesheets', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { employeeId, date, hours: Number(hours.toFixed(2)), ...(projectId > 0 ? { projectId } : {}), comment } }));
      return htmlResponse(html`<tr><td class="mono">${date}</td><td>${projectId > 0 ? `Project #${projectId}` : '—'}</td><td>${comment}</td><td class="num">${hours.toFixed(2)}</td><td>${reaiBadge({ text: `Logged #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
