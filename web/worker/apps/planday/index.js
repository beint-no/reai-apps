// @ts-check
import { fetchJson, isoDate, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiRequest } from '../../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard } from '../../lib/ui.js';

/** @typedef {{ date: string, hours: number, project: string, comment: string }} HoursRow */
/** @typedef {{ id: number, name: string }} SimpleOpt */

const BRAND = 'Planday';
const TITLE = 'Planday Shift & Hours Sync';
const LEAD = 'Fetch approved Planday shifts for one employee through the Planday Open API and post the hours to ReAI Timesheets.';
const API_HINT = 'A Planday administrator creates an API application under Settings → Integrations → API Access, gives it the shift:read and department:read scopes, and authorizes it. Paste the App ID and the refresh token shown there, and the Planday employee id whose shifts you want.';
const ID_URL = 'https://id.planday.com/connect/token';
const API = 'https://openapi.planday.com';

/** @type {HoursRow[]} */
const SAMPLE_ROWS = [
  { date: '2026-10-14', hours: 7.5, project: 'Avdeling Sentrum', comment: 'Dagvakt' },
  { date: '2026-10-15', hours: 8, project: 'Avdeling Sentrum', comment: 'Kveldsvakt' },
];

/**
 * Fetches approved shifts for one Planday employee and converts them to worked hours.
 * Docs: https://openapi.planday.com/gettingstarted/authorization/ (refresh token → POST https://id.planday.com/connect/token,
 * then Authorization: Bearer + X-ClientId on every call), https://openapi.planday.com/api/schedule
 * (GET /scheduling/v1.0/shifts with from, to, employeeId, shiftStatus, limit, offset; spec at
 * https://openapi.planday.com/scheduling/swagger/v1.0/swagger.json) and https://openapi.planday.com/api/hr
 * (GET /hr/v1.0/departments). Hours are endDateTime minus startDateTime minus unpaid manualBreaks.
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<HoursRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const appId = (creds.appId ?? '').trim();
  const refreshToken = (creds.refreshToken ?? '').trim();
  const employeeId = (creds.plandayEmployeeId ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!appId || !refreshToken) throw new HttpError(400, 'Enter the Planday App ID and refresh token.');
  if (!/^[0-9]+$/.test(employeeId)) throw new HttpError(400, 'Enter the numeric Planday employee id.');
  if (from > to) throw new HttpError(400, 'The from date must be on or before the to date.');
  const login = await fetchJson(ID_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ client_id: appId, grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
  }, BRAND, fetchImpl);
  const accessToken = typeof login?.access_token === 'string' ? login.access_token : '';
  if (!accessToken) throw new HttpError(400, 'Planday did not return an access token. Check the App ID and refresh token.');
  const headers = { authorization: `Bearer ${accessToken}`, 'x-clientid': appId, accept: 'application/json' };

  /** @type {Map<number, string>} */
  const departments = new Map();
  for (let offset = 0; offset < 5000; offset += 500) {
    const page = await fetchJson(`${API}/hr/v1.0/departments?${new URLSearchParams({ limit: '500', offset: String(offset) })}`, { headers }, BRAND, fetchImpl);
    /** @type {any[]} */ const data = Array.isArray(page?.data) ? page.data : [];
    for (const d of data) departments.set(Number(d.id), String(d.name ?? '').trim());
    if (data.length < 500 || offset + data.length >= Number(page?.paging?.total ?? 0)) break;
  }

  /** @type {any[]} */ const shifts = [];
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const query = new URLSearchParams({ from, to, employeeId, shiftStatus: 'Approved', limit: '1000', offset: String(offset) });
    const page = await fetchJson(`${API}/scheduling/v1.0/shifts?${query}`, { headers }, BRAND, fetchImpl);
    /** @type {any[]} */ const data = Array.isArray(page?.data) ? page.data : [];
    shifts.push(...data);
    if (data.length < 1000 || offset + data.length >= Number(page?.paging?.total ?? 0)) break;
  }

  /** @param {unknown} a @param {unknown} b */
  const minutes = (a, b) => (Date.parse(String(b)) - Date.parse(String(a))) / 60_000;
  const rows = shifts
    .filter((sh) => String(sh.employeeId) === employeeId && sh.startDateTime && sh.endDateTime)
    .map((sh) => {
      /** @type {any[]} */ const breaks = Array.isArray(sh.manualBreaks) ? sh.manualBreaks : [];
      const unpaid = breaks.filter((br) => br && br.isPaidBreak === false).reduce((t, br) => t + Math.max(0, minutes(br.startDateTime, br.endDateTime) || 0), 0);
      const worked = minutes(sh.startDateTime, sh.endDateTime) - unpaid;
      return {
        date: isoDate(sh.date ?? sh.startDateTime, from),
        hours: Number((worked / 60).toFixed(2)),
        project: departments.get(Number(sh.departmentId)) || (sh.departmentId ? `Department ${sh.departmentId}` : '—'),
        comment: String(sh.comment ?? '').trim() || `${BRAND} shift ${sh.id}`,
      };
    })
    .filter((x) => x.hours >= 0.01 && x.hours <= 24)
    .sort((x, y) => x.date.localeCompare(y.date));
  if (rows.length === 0) throw new HttpError(400, `${BRAND} has no approved shifts for employee ${employeeId} from ${from} to ${to}.`);
  return rows;
}

/** @param {HoursRow[]} rows @param {number} empId @param {number} projId @param {boolean} isSample */
function renderHours(rows, empId, projId, isSample) {
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI TIMESHEETS`,
    title: `${rows.length} entries (${rows.reduce((s, r) => s + r.hours, 0).toFixed(2)} h)`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Ready', tone: 'success' }),
    body: html`<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Date</th><th>Project / Unit</th><th>Comment</th><th class="num">Hours</th><th>Action</th></tr></thead>
      <tbody>${rows.map((r, idx) => html`<tr id="wf-h-${idx}"><td class="mono">${r.date}</td><td>${r.project}</td><td>${r.comment}</td><td class="num">${r.hours.toFixed(2)}</td><td>${isSample || empId <= 0 ? html`<span class="muted-note">${isSample ? 'Demo only' : 'Select employee above'}</span>` : html`<form hx-post="/app/planday/import" hx-target="#wf-h-${idx}" hx-swap="outerHTML"><input type="hidden" name="employeeId" value="${empId}"><input type="hidden" name="projectId" value="${projId}"><input type="hidden" name="date" value="${r.date}"><input type="hidden" name="hours" value="${r.hours.toFixed(2)}"><input type="hidden" name="comment" value="[${BRAND}] ${r.comment}"><button type="submit" class="button primary">Post to ReAI</button></form>`}</td></tr>`)}</tbody>
    </table></div>`,
  });
}

/**
 * Handles /app/planday/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/planday';
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    /** @type {SimpleOpt[]} */ let employees = [];
    /** @type {SimpleOpt[]} */ let projects = [];
    if (session && session.tenantId > 0) {
      try {
        const [e, p] = await Promise.all([
          reaiRequest(env, '/api/employees', { token: session.accessToken, tenantId: session.tenantId }).catch(() => []),
          reaiAll(env, '/api/projects', { token: session.accessToken, tenantId: session.tenantId }).catch(() => []),
        ]);
        employees = Array.isArray(e) ? /** @type {SimpleOpt[]} */ (e) : [];
        projects = /** @type {Array<SimpleOpt & { archived?: boolean }>} */ (p).filter((x) => !x.archived);
      } catch { /* ignore */ }
    }
    const body = html`
      <section class="app-intro"><p class="eyebrow">WORKFORCE, SHIFTS & PROJECTS</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-planday-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({
          basePath,
          targetId: 'wfm-output',
          brand: BRAND,
          hint: API_HINT,
          fields: [
            { name: 'appId', label: 'Planday App ID', placeholder: 'App ID from API Access' },
            { name: 'refreshToken', label: 'Planday refresh token', type: 'password', placeholder: 'Refresh token' },
            { name: 'plandayEmployeeId', label: 'Planday employee id', placeholder: '123456' },
            { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
            { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
          ],
          extraFields: html`<div class="mapping-grid">
            <div class="field"><label for="wf-emp">ReAI employee</label><select id="wf-emp" name="employeeId"><option value="0">${employees.length > 0 ? 'Select employee…' : 'Connect to ReAI first'}</option>${employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}</select></div>
            <div class="field"><label for="wf-proj">ReAI project (optional)</label><select id="wf-proj" name="projectId"><option value="0">No project</option>${projects.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></div>
          </div>`,
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
      if (employeeId <= 0 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || hours < 0.01 || hours > 24) throw new HttpError(400, 'Valid employee, date and hours (0.01 to 24) are required.');
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/timesheets', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { employeeId, date, hours: Number(hours.toFixed(2)), ...(projectId > 0 ? { projectId } : {}), comment } }));
      return htmlResponse(html`<tr><td class="mono">${date}</td><td>${projectId > 0 ? `Project #${projectId}` : '—'}</td><td>${comment}</td><td class="num">${hours.toFixed(2)}</td><td>${reaiBadge({ text: `Logged #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
