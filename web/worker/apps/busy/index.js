// @ts-check
import { fetchJson, isoDate, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiRequest } from '../../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard } from '../../lib/ui.js';

/** @typedef {{ date: string, hours: number, project: string, user: string, comment: string, approved: boolean }} HoursRow */
/** @typedef {{ id: number, name: string }} SimpleOpt */

const BRAND = 'Finago Busy';
const TITLE = 'Finago Busy Timesheet Sync';
const LEAD = 'Fetch hour entries from the Finago Busy API and post them to ReAI Timesheets by employee and project.';
const API = 'https://api.busy.no/v2';

/** @type {HoursRow[]} */
const SAMPLE_ROWS = [
  { date: '2026-10-15', hours: 6.5, project: '1042 Rådgivning Q4', user: 'Demo Consultant', comment: 'Design og arkitekturworkshop', approved: true },
  { date: '2026-10-16', hours: 7.5, project: '1042 Rådgivning Q4', user: 'Demo Consultant', comment: 'Implementering og test', approved: true },
];

/** @param {string} iso */
function osloDate(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
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
    q.set('limit', '100');
    q.set('offset', String(page * 100));
    const data = await fetchJson(`${API}${path}?${q}`, { headers }, BRAND, fetchImpl);
    /** @type {any[]} */ const items = Array.isArray(data?.data) ? data.data : [];
    all.push(...items);
    if (items.length < 100) return all;
  }
  throw new HttpError(400, `${BRAND} returned too many records. Choose a shorter period or filter by user.`);
}

/**
 * Fetches hour entries from the Finago Busy public API v2.
 * Docs: https://api.busy.no (OpenAPI at https://api.busy.no/v2/openapi.json): Bearer token from
 * workspace settings under integrations; GET /v2/hourEntries/ (startTimeFrom, startTimeTo, userIdIn,
 * limit max 100, offset; scope hourEntries:read), GET /v2/users/ (users:read) and
 * GET /v2/projects/{projectId} (projects:read). Responses wrap results in { data }.
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
  const users = await busyList('/users/', new URLSearchParams({ isActive: 'all' }), headers, fetchImpl, 20);
  /** @type {Map<string, string>} */ const userNames = new Map(users.map((u) => [String(u.id), String(u.displayName ?? u.email ?? u.id)]));
  const email = (creds.userEmail ?? '').trim().toLowerCase();
  const query = new URLSearchParams({ startTimeFrom: from, startTimeTo: new Date(Date.parse(`${to}T00:00:00Z`) + 2 * 86_400_000).toISOString().slice(0, 10), orderBy: 'startTime', orderByDirection: 'asc' });
  if (email) {
    const user = users.find((u) => String(u.email ?? '').trim().toLowerCase() === email);
    if (!user) throw new HttpError(400, `No ${BRAND} user has the email ${creds.userEmail}.`);
    query.append('userIdIn', String(user.id));
  }
  const entries = await busyList('/hourEntries/', query, headers, fetchImpl, 50);
  const onlyApproved = creds.onlyApproved === 'on';
  /** @type {Map<string, string>} */ const projectNames = new Map();
  for (const id of [...new Set(entries.map((e) => e.projectId).filter((p) => p !== null && p !== undefined).map(String))].slice(0, 50)) {
    const res = await fetchJson(`${API}/projects/${encodeURIComponent(id)}`, { headers }, BRAND, fetchImpl);
    const p = res?.data;
    if (p) projectNames.set(id, [p.number, p.name].filter(Boolean).join(' '));
  }
  const rows = entries
    .filter((e) => e.isActive !== false && (!onlyApproved || e.approvalStatus === 'approved'))
    .map((e) => ({
      date: osloDate(String(e.startTime ?? '')),
      hours: Number((Math.max(0, Number(e.totalMinutes ?? 0) - Number(e.breakDeductionMinutes ?? 0)) / 60).toFixed(2)),
      project: e.projectId ? (projectNames.get(String(e.projectId)) ?? `Project ${e.projectId}`) : '',
      user: userNames.get(String(e.userId)) ?? '',
      comment: String(e.description ?? '').trim() || `${BRAND} hours`,
      approved: e.approvalStatus === 'approved',
    }))
    .filter((r) => r.date >= from && r.date <= to && r.hours >= 0.01 && r.hours <= 24);
  if (rows.length === 0) throw new HttpError(400, `${BRAND} returned no ${onlyApproved ? 'approved ' : ''}hour entries for ${from} to ${to}.`);
  return rows;
}

/** @param {HoursRow[]} rows @param {number} empId @param {number} projId @param {boolean} isSample */
function renderHours(rows, empId, projId, isSample) {
  return reaiCard({
    eyebrow: 'FINAGO BUSY → REAI TIMESHEETS',
    title: `${rows.length} entries (${rows.reduce((s, r) => s + r.hours, 0).toFixed(2)} h)`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Ready', tone: 'success' }),
    body: html`<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Date</th><th>Project</th><th>Comment</th><th class="num">Hours</th><th>Action</th></tr></thead>
      <tbody>${rows.map((r, idx) => html`<tr id="wf-h-${idx}"><td class="mono">${r.date}</td><td>${r.project || '—'}${r.user ? html`<br><span class="muted-note">${r.user}${r.approved ? '' : ' · not approved'}</span>` : ''}</td><td>${r.comment}</td><td class="num">${r.hours.toFixed(2)}</td><td>${isSample || empId <= 0 ? html`<span class="muted-note">${isSample ? 'Demo only' : 'Select employee above'}</span>` : html`<form hx-post="/app/busy/import" hx-target="#wf-h-${idx}" hx-swap="outerHTML"><input type="hidden" name="employeeId" value="${empId}"><input type="hidden" name="projectId" value="${projId}"><input type="hidden" name="date" value="${r.date}"><input type="hidden" name="hours" value="${r.hours.toFixed(2)}"><input type="hidden" name="comment" value="[Busy] ${r.comment}"><button type="submit" class="button primary">Post to ReAI</button></form>`}</td></tr>`)}</tbody>
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
  if (pathname === `${basePath}/sample`) return htmlResponse(renderHours(SAMPLE_ROWS, 1, 0, true));
  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderHours(await fetchApi(creds), Number(form.get('employeeId') ?? '0'), Number(form.get('projectId') ?? '0'), false));
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
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/timesheets', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { employeeId, date, hours: Number(hours.toFixed(2)), ...(projectId > 0 ? { projectId } : {}), comment } }));
      return htmlResponse(html`<tr><td class="mono">${date}</td><td>${projectId > 0 ? `Project #${projectId}` : '—'}</td><td>${comment}</td><td class="num">${hours.toFixed(2)}</td><td>${reaiBadge({ text: `Logged #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
