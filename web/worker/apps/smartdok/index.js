// @ts-check
import { fetchJson, isoDate, num, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiRequest } from '../../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/** @typedef {{ id: string, date: string, hours: number, person: string, project: string, comment: string }} HoursRow */
/** @typedef {{ id: number, name: string }} SimpleOpt */

const SLUG = 'smartdok';
const BRAND = 'SmartDok';
const BASE_PATH = '/app/smartdok';
const TITLE = 'SmartDok Hours Sync';
const EYEBROW = 'CONSTRUCTION · HOURS';
const LEAD = 'Fetch attested work hours from the SmartDok API and post them to ReAI Timesheets for one employee and project.';
const API_HINT = 'Generate an API access token in SmartDok under Company settings → API administration (needs API access on your SmartDok plan and an administrator).';
const API = 'https://api.smartdok.no';
/** /WorkHours allows at most 93 days between fromDate and toDate; toDate is sent as the end of that day. */
const MAX_DAYS = 93;

/** @type {import('../../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [
  { name: 'apiToken', label: 'SmartDok API access token', type: 'password' },
  { name: 'person', label: 'SmartDok employee name or number (optional)', required: false, placeholder: 'All employees' },
  { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
  { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
];

/** @type {HoursRow[]} */
const SAMPLE_ROWS = [
  { id: '90001', date: '2026-10-14', hours: 7.5, person: 'Ola Hansen', project: '1042 Bane Nord · Etappe 2', comment: 'Grunnarbeid' },
  { id: '90002', date: '2026-10-15', hours: 8, person: 'Ola Hansen', project: '1042 Bane Nord · Etappe 2', comment: 'Rørlegging og inspeksjon' },
];

/** @param {string} from @param {string} to */
function assertRange(from, to) {
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (!(days >= 0)) throw new HttpError(400, 'The to date must be on or after the from date.');
  if (days + 1 > MAX_DAYS) throw new HttpError(400, `Choose a period of at most ${MAX_DAYS} days.`);
}

/**
 * Fetches attested work hours from the SmartDok API.
 * Docs: https://api.smartdok.no/api-docs/ (spec https://api.smartdok.no/docs/v1): POST /Authorize/ApiToken with
 * { Token } returns the session token used as Bearer; GET /Users (Items with Id, Name, EmployeeNo); GET /WorkHours
 * with fromDate, toDate (at most 93 days), onlyAttested, includeExported and absence=false returns all matching Items of
 * WorkHourOutput (WorkHourID, UserID, EmployeeNo, Date, NetHours, OrdinaryHours, WageName, ProjectNumber, ProjectName,
 * SubProjectName, Comment) in one response. /WorkHours/v2 is paged but returns only ids and clock times, so v1 is used.
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<HoursRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const apiToken = (creds.apiToken ?? '').trim();
  if (!apiToken) throw new HttpError(400, 'Enter the SmartDok API access token.');
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  assertRange(from, to);
  const session = await fetchJson(`${API}/Authorize/ApiToken`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ Token: apiToken }),
  }, BRAND, fetchImpl);
  const bearer = typeof session === 'string' ? session.trim() : '';
  if (!bearer) throw new HttpError(400, 'SmartDok did not return a session token. Check the API access token.');
  const headers = { authorization: `Bearer ${bearer}`, accept: 'application/json' };

  const query = new URLSearchParams({ fromDate: from, toDate: `${to}T23:59:59`, onlyAttested: 'true', includeExported: 'true', absence: 'false' });
  const [users, data] = await Promise.all([
    fetchJson(`${API}/Users?${new URLSearchParams({ all: 'true' })}`, { headers }, BRAND, fetchImpl),
    fetchJson(`${API}/WorkHours?${query}`, { headers }, BRAND, fetchImpl),
  ]);
  /** @type {Map<string, { name: string, no: string }>} */ const byId = new Map();
  for (const u of Array.isArray(users?.Items) ? users.Items : []) byId.set(String(u.Id), { name: String(u.Name ?? '').trim(), no: String(u.EmployeeNo ?? '').trim() });
  /** @type {any[]} */ const items = Array.isArray(data?.Items) ? data.Items : [];
  const wanted = (creds.person ?? '').trim().toLowerCase();
  const rows = items
    .filter((w) => !w.WageAddition && !w.UnitAddition && !w.Diet && !w.MachineHourId)
    .map((w) => {
      const user = byId.get(String(w.UserID));
      const no = String(w.EmployeeNo ?? user?.no ?? '').trim();
      const project = [[w.ProjectNumber, w.ProjectName].filter(Boolean).join(' '), w.SubProjectName].filter(Boolean).join(' · ');
      const hours = w.NetHours != null ? num(w.NetHours) : num(w.OrdinaryHours);
      return {
        id: String(w.WorkHourID ?? ''),
        date: isoDate(w.Date, ''),
        hours: Number(hours.toFixed(2)),
        person: user?.name || no || '—',
        no,
        project: project || '—',
        comment: [w.WageName, w.Comment].map((x) => String(x ?? '').trim()).filter(Boolean).join(' · ') || 'SmartDok hours',
      };
    })
    .filter((r) => r.date && r.hours >= 0.01 && r.hours <= 24 && (!wanted || r.person.toLowerCase().includes(wanted) || r.no.toLowerCase() === wanted))
    .map((r) => ({ id: r.id, date: r.date, hours: r.hours, person: r.person, project: r.project, comment: r.comment }));
  if (rows.length === 0) throw new HttpError(400, `SmartDok has no attested hours from ${from} to ${to}${wanted ? ` for "${creds.person}"` : ''}.`);
  return rows;
}

/** @param {HoursRow[]} rows @param {number} empId @param {number} projId @param {boolean} isSample */
function renderHours(rows, empId, projId, isSample) {
  const total = rows.reduce((s, r) => s + r.hours, 0);
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI TIMESHEETS`,
    title: `${rows.length} entries (${total.toFixed(2)} h)`,
    badge: isSample ? reaiBadge({ text: 'Sample', tone: 'accent' }) : reaiBadge({ text: 'Ready', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Total hours', value: `${total.toFixed(2)} h` })}
        ${reaiMetric({ label: 'ReAI employee', value: empId > 0 ? `#${empId}` : 'Not chosen', detail: projId > 0 ? `Project #${projId}` : 'No project' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>User</th><th>Project</th><th>Comment</th><th class="num">Hours</th><th>Action</th></tr></thead>
        <tbody>${rows.map((r, idx) => html`<tr id="${SLUG}-h-${idx}"><td class="mono">${r.date}</td><td>${r.person}</td><td>${r.project}</td><td>${r.comment}</td><td class="num">${r.hours.toFixed(2)}</td><td>${isSample || empId <= 0
          ? html`<span class="muted-note">${isSample ? 'Sample only' : 'Choose a ReAI employee above'}</span>`
          : html`<form hx-post="${BASE_PATH}/import" hx-target="#${SLUG}-h-${idx}" hx-swap="outerHTML"><input type="hidden" name="employeeId" value="${empId}"><input type="hidden" name="projectId" value="${projId}"><input type="hidden" name="date" value="${r.date}"><input type="hidden" name="hours" value="${r.hours.toFixed(2)}"><input type="hidden" name="comment" value="[${BRAND}${r.id ? ` #${r.id}` : ''}] ${r.project} · ${r.comment}"><button type="submit" class="button primary">Post to ReAI</button></form>`}</td></tr>`)}</tbody>
      </table></div>`,
  });
}

/** @param {SimpleOpt[]} employees @param {SimpleOpt[]} projects */
function reaiTargetFields(employees, projects) {
  return html`<div class="mapping-grid">
    <div class="field"><label for="${SLUG}-emp">ReAI employee</label><select id="${SLUG}-emp" name="employeeId"><option value="0">${employees.length > 0 ? 'Choose employee…' : 'Connect to ReAI first'}</option>${employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}</select></div>
    <div class="field"><label for="${SLUG}-proj">ReAI project (optional)</label><select id="${SLUG}-proj" name="projectId"><option value="0">No project</option>${projects.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></div>
  </div>`;
}

/**
 * Handles /app/smartdok/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE_PATH && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE_PATH}/`, request.url), 301);
  if (pathname === `${BASE_PATH}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    /** @type {SimpleOpt[]} */ let employees = [];
    /** @type {SimpleOpt[]} */ let projects = [];
    if (session && session.tenantId > 0) {
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const [e, p] = await Promise.all([
        reaiRequest(env, '/api/employees', auth).catch(() => []),
        reaiAll(env, '/api/projects', { ...auth, query: { archived: 'false' } }).catch(() => []),
      ]);
      employees = Array.isArray(e) ? /** @type {SimpleOpt[]} */ (e) : [];
      projects = /** @type {SimpleOpt[]} */ (p);
    }
    const body = html`
      <section class="app-intro"><p class="eyebrow">${EYEBROW}</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${SLUG}-web`, clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({ basePath: BASE_PATH, targetId: `${SLUG}-output`, brand: BRAND, hint: API_HINT, fields: API_FIELDS, extraFields: reaiTargetFields(employees, projects), sampleAction: true })}
        <div id="${SLUG}-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderHours(SAMPLE_ROWS, 1, 0, true));
  try {
    const form = await request.formData();
    if (pathname === `${BASE_PATH}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderHours(await fetchApi(creds), Number(creds.employeeId ?? '0'), Number(creds.projectId ?? '0'), false));
    }
    if (pathname === `${BASE_PATH}/import`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const employeeId = Number(form.get('employeeId') ?? '0');
      const projectId = Number(form.get('projectId') ?? '0');
      const date = String(form.get('date') ?? '').trim();
      const hours = Number(form.get('hours') ?? '0');
      const comment = String(form.get('comment') ?? BRAND).trim().slice(0, 1000);
      if (!(employeeId > 0) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !(hours >= 0.01 && hours <= 24)) throw new HttpError(400, 'A ReAI employee, a date and 0.01 to 24 hours are required.');
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const tag = /^\[SmartDok #[0-9]+\]/.exec(comment)?.[0];
      const existing = tag
        ? /** @type {Array<{ id: number | null, comment?: string | null }>} */ (await reaiRequest(env, '/api/timesheets', { ...auth, query: { employeeId: String(employeeId), startDate: date, endDate: date } })).find((t) => typeof t.comment === 'string' && t.comment.startsWith(tag))
        : undefined;
      const created = existing ?? /** @type {{ id: number }} */ (await reaiRequest(env, '/api/timesheets', { ...auth, method: 'POST', body: { employeeId, date, hours: Number(hours.toFixed(2)), ...(projectId > 0 ? { projectId } : {}), comment } }));
      return htmlResponse(html`<tr><td class="mono">${date}</td><td>—</td><td>${projectId > 0 ? `Project #${projectId}` : '—'}</td><td>${comment}</td><td class="num">${hours.toFixed(2)}</td><td>${reaiBadge({ text: existing ? `Already logged #${existing.id}` : `Logged #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
