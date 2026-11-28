// @ts-check
import { fetchJson } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiRequest } from '../../lib/reai.js';
import { currentMonthIso, monthBounds } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/**
 * @typedef {{ id: string, date: string, hours: number, project: string, task: string, customer: string, comment: string, billable: boolean }} TimeRow
 * @typedef {{ email: string, name: string, rows: TimeRow[], skippedAbsence: number }} TimeLogPeriod
 * @typedef {{ id: number, name: string, email?: string | null }} ReaiEmployee
 * @typedef {{ id: number, name: string, archived?: boolean }} ReaiProject
 */

const SLUG = 'timelog';
const BRAND = 'TimeLog';
const BASE_PATH = `/app/${SLUG}`;
const TITLE = 'TimeLog Hours to ReAI';
const LEAD = 'Fetch your TimeLog time registrations for a month through the TimeLog REST API and post them to ReAI Timesheets, matched to your ReAI employee and projects.';
const HOST_RE = /^app[0-9]*\.timelog\.com$/i;

/** @type {TimeLogPeriod} */
const SAMPLE = {
  email: 'kari@example.no',
  name: 'Kari Nordmann',
  skippedAbsence: 1,
  rows: [
    { id: '90101', date: '2026-10-05', hours: 6.5, project: 'Nettbutikk relansering', task: 'Design', customer: 'Fjord Sko AS', comment: 'Skisser forside', billable: true },
    { id: '90102', date: '2026-10-06', hours: 7.5, project: 'Nettbutikk relansering', task: 'Utvikling', customer: 'Fjord Sko AS', comment: 'Produktliste', billable: true },
    { id: '90103', date: '2026-10-07', hours: 1.25, project: 'Intern', task: 'Administrasjon', customer: '', comment: 'Ukemøte', billable: false },
  ],
};

/**
 * Validates the account API URL shown in TimeLog under System Administration → Integrations and API → Transactional API settings.
 * @param {string} raw
 */
export function timelogBase(raw) {
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HttpError(400, 'Enter your TimeLog URL, for example https://app4.timelog.com/youraccount.');
  }
  const account = url.pathname.split('/').filter(Boolean)[0] ?? '';
  if (url.protocol !== 'https:' || !HOST_RE.test(url.hostname) || !/^[A-Za-z0-9_-]+$/.test(account)) {
    throw new HttpError(400, 'Enter your TimeLog URL as https://app[x].timelog.com/[account name]. You find it in TimeLog under System Administration → Integrations and API → Transactional API settings.');
  }
  return `https://${url.hostname.toLowerCase()}/${account}/api/v1`;
}

/**
 * Unwraps a TimeLog response that is either a plain model or a TAFSingle/TAFList envelope.
 * Docs: https://api.timelog.com/rest (TAF: Properties, Entities[].Properties, TotalPage).
 * @param {any} payload
 * @returns {{ items: any[], totalPages: number }}
 */
function unwrapList(payload) {
  if (Array.isArray(payload)) return { items: payload, totalPages: 1 };
  if (payload && Array.isArray(payload.Entities)) {
    return { items: payload.Entities.map((/** @type {any} */ e) => e?.Properties ?? e), totalPages: Math.max(1, Number(payload.Properties?.TotalPage ?? 1) || 1) };
  }
  return { items: [], totalPages: 1 };
}

/** @param {any} payload */
function unwrapSingle(payload) {
  return payload && typeof payload === 'object' && payload.Properties && !Array.isArray(payload.Entities) ? payload.Properties : payload;
}

/**
 * Reads the token owner's time registrations for a period.
 * Docs: https://api.timelog.com/rest/personalaccesstokens (PAT as Bearer token),
 * https://api.timelog.com/rest/method/user_getcurrentuser (GET /api/v1/user/me),
 * https://api.timelog.com/rest/method/timetrackingitem_getbydate (GET /api/v1/time-tracking-item/get-by-date?startDate&endDate).
 * @param {Record<string, string>} creds `apiUrl`, `token`, `start` and `end` (inclusive, YYYY-MM-DD)
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<TimeLogPeriod>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const base = timelogBase(creds.apiUrl ?? '');
  const token = (creds.token ?? '').trim();
  if (!token) throw new HttpError(400, 'Enter your TimeLog personal access token.');
  const start = String(creds.start ?? '');
  const end = String(creds.end ?? '');
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(start) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(end)) throw new HttpError(400, 'Choose a valid month.');
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const me = unwrapSingle(await fetchJson(`${base}/user/me`, { headers }, BRAND, fetchImpl));
  /** @type {any[]} */ const items = [];
  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, 20); page++) {
    const q = new URLSearchParams({ startDate: start, endDate: end });
    if (page > 1) q.set('$page', String(page));
    const res = unwrapList(await fetchJson(`${base}/time-tracking-item/get-by-date?${q}`, { headers }, BRAND, fetchImpl));
    items.push(...res.items);
    totalPages = res.totalPages;
  }
  let skippedAbsence = 0;
  /** @type {TimeRow[]} */ const rows = [];
  for (const it of items) {
    if (Number(it?.AbsenceCodeID ?? 0) > 0) {
      skippedAbsence += 1;
      continue;
    }
    const id = String(it?.TimeRegistrationID ?? '').trim();
    const date = String(it?.Date ?? '').slice(0, 10);
    const decimal = Number(it?.Hours ?? 0);
    const hours = Number((decimal > 0 ? decimal : Number(it?.Minutes ?? 0) / 60).toFixed(2));
    if (!/^[0-9]+$/.test(id) || id === '0' || date < start || date > end || !(hours >= 0.01 && hours <= 24)) continue;
    rows.push({
      id,
      date,
      hours,
      project: String(it?.ProjectName ?? '').trim(),
      task: String(it?.TaskName ?? '').trim(),
      customer: String(it?.CustomerName ?? '').trim(),
      comment: String(it?.Comment ?? '').trim(),
      billable: Boolean(it?.IsBillable),
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const name = [me?.FirstName, me?.LastName].filter(Boolean).join(' ').trim();
  return { email: String(me?.Email ?? '').trim(), name, rows, skippedAbsence };
}

/** @param {string} s */
const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** @param {TimeRow} r */
function timesheetComment(r) {
  const what = [r.project, r.task].filter(Boolean).join(' · ');
  return `[${BRAND} ${r.id}] ${what}${r.comment ? `: ${r.comment}` : ''}`.slice(0, 1000);
}

/**
 * @param {{ period: TimeLogPeriod, employees: ReaiEmployee[], projects: ReaiProject[], employeeId: number, isSample?: boolean }} state
 */
function renderPreview(state) {
  const { period } = state;
  const matched = state.employeeId > 0
    ? state.employees.find((e) => e.id === state.employeeId)
    : state.employees.find((e) => period.email && norm(String(e.email ?? '')) === norm(period.email)) ?? state.employees.find((e) => period.name && norm(e.name) === norm(period.name));
  const employeeId = state.isSample ? 1 : matched?.id ?? 0;
  const total = period.rows.reduce((s, r) => s + r.hours, 0);
  /** @param {TimeRow} r */
  const projectFor = (r) => state.projects.find((p) => r.project && norm(p.name) === norm(r.project));
  return reaiCard({
    eyebrow: 'TIMELOG → REAI TIMESHEETS',
    title: `${period.rows.length} time registrations`,
    badge: state.isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${total.toFixed(2)} h total`, tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'TimeLog user', value: period.name || period.email || 'Token owner', detail: period.email })}
        ${reaiMetric({ label: 'ReAI employee', value: state.isSample ? 'Sample' : matched ? matched.name : 'No match', detail: matched || state.isSample ? 'Matched by email or name' : 'Choose the employee above and fetch again' })}
        ${reaiMetric({ label: 'Total hours', value: `${total.toFixed(2)} h`, detail: period.skippedAbsence ? `${period.skippedAbsence} absence registrations left out` : 'No absence in this month' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Project</th><th>Task and comment</th><th>ReAI project</th><th class="num">Hours</th><th>Action</th></tr></thead>
        <tbody>${period.rows.map((r, idx) => {
          const project = projectFor(r);
          return html`<tr id="${SLUG}-row-${idx}">
            <td class="mono">${r.date}</td><td>${r.project || '—'}${r.customer ? html`<div class="muted-note">${r.customer}</div>` : ''}</td>
            <td>${[r.task, r.comment].filter(Boolean).join(': ')}${r.billable ? '' : html` ${reaiBadge({ text: 'Not billable' })}`}</td>
            <td>${project ? project.name : state.isSample ? 'Matched by name' : 'None'}</td>
            <td class="num">${r.hours.toFixed(2)}</td>
            <td>${state.isSample || employeeId <= 0
              ? html`<span class="muted-note">${state.isSample ? 'Demo only' : 'Choose employee'}</span>`
              : html`<form hx-post="${BASE_PATH}/import" hx-target="#${SLUG}-row-${idx}" hx-swap="outerHTML">
                  <input type="hidden" name="employeeId" value="${employeeId}"><input type="hidden" name="projectId" value="${project?.id ?? 0}">
                  <input type="hidden" name="date" value="${r.date}"><input type="hidden" name="hours" value="${r.hours.toFixed(2)}">
                  <input type="hidden" name="comment" value="${timesheetComment(r)}">
                  <button type="submit" class="button primary">Post to ReAI</button>
                </form>`}</td>
          </tr>`;
        })}</tbody>
      </table></div>
      <p class="muted-note">Each row is checked against the ReAI timesheet for that employee and day, so a registration that is already posted is not posted again. Projects are matched by name.</p>
    `,
  });
}

/**
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {import('../../lib/types.d.ts').SessionData} session
 */
async function loadReai(env, session) {
  const auth = { token: session.accessToken, tenantId: session.tenantId };
  const [employees, projects] = await Promise.all([
    reaiRequest(env, '/api/employees', auth),
    reaiAll(env, '/api/projects', { ...auth, query: { hierarchy: 'all' } }),
  ]);
  return {
    employees: Array.isArray(employees) ? /** @type {ReaiEmployee[]} */ (employees) : [],
    projects: /** @type {ReaiProject[]} */ (projects).filter((p) => !p.archived),
  };
}

/**
 * Handles /app/timelog/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE_PATH && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE_PATH}/`, request.url), 301);
  if (pathname === `${BASE_PATH}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    /** @type {ReaiEmployee[]} */ let employees = [];
    if (session && session.tenantId > 0) {
      try {
        const res = await reaiRequest(env, '/api/employees', { token: session.accessToken, tenantId: session.tenantId });
        employees = Array.isArray(res) ? /** @type {ReaiEmployee[]} */ (res) : [];
      } catch {
        employees = [];
      }
    }
    const body = html`
      <section class="app-intro"><p class="eyebrow">PROJECTS & TIME TRACKING</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${SLUG}-web`, clientName: `ReAI ${BRAND} (Web)` })}
        ${reaiCard({
          eyebrow: 'LIVE TIMELOG REST API',
          title: 'Fetch TimeLog time registrations',
          body: html`<p class="muted-note">Create a personal access token at login.timelog.com/personaltoken while signed in to TimeLog. Your TimeLog URL is shown under System Administration → Integrations and API → Transactional API settings. The token is used only for these requests and is never stored.</p>
            <form class="stack" hx-post="${BASE_PATH}/fetch-api" hx-target="#${SLUG}-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="tl-url">TimeLog URL</label><input id="tl-url" name="apiUrl" type="url" required placeholder="https://app4.timelog.com/youraccount"></div>
                <div class="field"><label for="tl-token">Personal access token</label><input id="tl-token" name="token" type="password" autocomplete="off" required></div>
                <div class="field"><label for="tl-month">Month</label><input id="tl-month" name="month" type="text" pattern="[0-9]{4}-[0-9]{2}" value="${currentMonthIso()}" required></div>
                <div class="field"><label for="tl-emp">ReAI employee</label><select id="tl-emp" name="employeeId"><option value="0">${employees.length ? 'Match by email' : 'Connect to ReAI to load employees'}</option>${employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}</select></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Fetch from TimeLog</button>
                <button type="button" class="button secondary" hx-post="${BASE_PATH}/sample" hx-target="#${SLUG}-output" hx-swap="innerHTML">Load sample preview</button>
              </div>
            </form>`,
        })}
        <div id="${SLUG}-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE_PATH}/sample`) {
    return htmlResponse(renderPreview({ period: SAMPLE, employees: [], projects: [{ id: 10, name: 'Nettbutikk relansering' }], employeeId: 1, isSample: true }));
  }
  try {
    const form = await request.formData();
    if (pathname === `${BASE_PATH}/fetch-api`) {
      const session = await readSession(env, request);
      const bounds = monthBounds(String(form.get('month') ?? currentMonthIso()).trim());
      const period = await fetchApi({ apiUrl: String(form.get('apiUrl') ?? ''), token: String(form.get('token') ?? ''), start: bounds.start, end: bounds.lastDay });
      if (period.rows.length === 0) throw new HttpError(400, `TimeLog has no project hours for ${bounds.month} for this user.`);
      const ref = session && session.tenantId > 0 ? await loadReai(env, session) : { employees: [], projects: [] };
      return htmlResponse(renderPreview({ period, ...ref, employeeId: Number(form.get('employeeId') ?? '0') }));
    }
    if (pathname === `${BASE_PATH}/import`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const employeeId = Number(form.get('employeeId') ?? '0');
      const projectId = Number(form.get('projectId') ?? '0');
      const date = String(form.get('date') ?? '').trim();
      const hours = Number(form.get('hours') ?? '0');
      const comment = String(form.get('comment') ?? '').trim().slice(0, 1000);
      const marker = comment.match(/^\[TimeLog [0-9]+\]/)?.[0] ?? '';
      if (employeeId <= 0 || !marker || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !(hours >= 0.01 && hours <= 24)) throw new HttpError(400, 'Valid employee, date, hours (0.01 to 24) and TimeLog reference are required.');
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const logged = /** @type {Array<{ id: number, comment?: string | null }>} */ (await reaiRequest(env, '/api/timesheets', { ...auth, query: { employeeId: String(employeeId), startDate: date, endDate: date } }));
      const dup = Array.isArray(logged) ? logged.find((t) => typeof t.comment === 'string' && t.comment.startsWith(marker)) : undefined;
      const cells = html`<td class="mono">${date}</td><td colspan="3">${comment}</td><td class="num">${hours.toFixed(2)}</td>`;
      if (dup) return htmlResponse(html`<tr>${cells}<td>${reaiBadge({ text: `Already logged #${dup.id}`, tone: 'warn' })}</td></tr>`);
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/timesheets', { ...auth, method: 'POST', body: { employeeId, date, hours: Number(hours.toFixed(2)), ...(projectId > 0 ? { projectId } : {}), comment } }));
      return htmlResponse(html`<tr>${cells}<td>${reaiBadge({ text: `Logged #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
