// @ts-check
import { fetchJson, isoDate, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiRequest } from '../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard } from '../lib/ui.js';

/** @typedef {{ date: string, hours: number, project: string, comment: string }} HoursRow */
/** @typedef {{ id: number, name: string }} SimpleOpt */

const BRAND = 'Quinyx';
const TITLE = 'Quinyx Shift & Hours Sync';
const LEAD = 'Fetch the scheduled Quinyx shifts of one employee through the Quinyx API and post the hours to ReAI Timesheets.';
const API_HINT = 'An account manager creates Version 3 credentials in Quinyx under Account settings → Access rights → Integration credentials, with read access to Shifts. Paste the client ID and secret, and the badge number of the employee whose shifts you want.';

/** @type {HoursRow[]} */
const SAMPLE_ROWS = [
  { date: '2026-10-14', hours: 7.5, project: 'Group 42', comment: 'Morning shift' },
  { date: '2026-10-15', hours: 8, project: 'Group 42', comment: 'Evening shift' },
];

/**
 * Fetches the scheduled shifts of one Quinyx employee and converts them to hours.
 * Docs: https://developer.quinyx.com/api/v3/specs/quinyx-public-api-v3 (servers https://api.{eu|na}.quinyx.com,
 * POST /oauth/v3/token client_credentials, GET /schedule/v3/shifts with employeeIdIn, beginGte, beginLte, pageSize,
 * pageToken; spec https://developer.quinyx.com/_bundle/api/v3/specs/quinyx-public-api-v3.yaml) and
 * https://quinyx.helpdocs.io/l/en/article/msqoict4gl-integration-credentials-intro (credentials in Account settings).
 * Hours are end minus begin minus breaks; free days, deleted shifts and shifts that do not count as worked hours are skipped.
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<HoursRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const clientId = (creds.clientId ?? '').trim();
  const clientSecret = (creds.clientSecret ?? '').trim();
  const region = (creds.region ?? 'eu').trim().toLowerCase();
  const rawEmployee = (creds.employee ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!clientId || !clientSecret) throw new HttpError(400, 'Enter the Quinyx client ID and client secret.');
  if (region !== 'eu' && region !== 'na') throw new HttpError(400, 'Quinyx region must be eu or na.');
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(rawEmployee)) throw new HttpError(400, 'Enter the Quinyx badge number of the employee.');
  const employee = `badgeNumber:${rawEmployee}`;
  if (from > to) throw new HttpError(400, 'The from date must be on or before the to date.');
  const api = `https://api.${region}.quinyx.com`;
  const login = await fetchJson(`${api}/oauth/v3/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: 'schedule:shifts:read' }).toString(),
  }, BRAND, fetchImpl);
  const accessToken = typeof login?.access_token === 'string' ? login.access_token : '';
  if (!accessToken) throw new HttpError(400, 'Quinyx did not return an access token. Check the client ID and secret.');
  const headers = { authorization: `Bearer ${accessToken}`, accept: 'application/json', prefer: 'timezone=Europe/Oslo' };

  /** @type {any[]} */ const shifts = [];
  let pageToken = '';
  for (let page = 0; page < 50; page++) {
    const query = new URLSearchParams({ employeeIdIn: employee, beginGte: `${from}T00:00:00Z`, beginLte: `${to}T23:59:59Z`, deleted: 'false', pageSize: '100', ...(pageToken ? { pageToken } : {}) });
    const res = await fetchJson(`${api}/schedule/v3/shifts?${query}`, { headers }, BRAND, fetchImpl);
    if (Array.isArray(res?.data)) shifts.push(...res.data);
    pageToken = typeof res?.pagination?.nextPageToken === 'string' ? res.pagination.nextPageToken : '';
    if (!pageToken) break;
  }

  /** @param {unknown} a @param {unknown} b */
  const minutes = (a, b) => (Date.parse(String(b)) - Date.parse(String(a))) / 60_000;
  const rows = shifts
    .filter((sh) => sh && !sh.deleted && !sh.freeDay && sh.countWorkedHours !== false && sh.begin && sh.end)
    .map((sh) => {
      /** @type {any[]} */ const breaks = Array.isArray(sh.breaks) ? sh.breaks : [];
      const pause = breaks.reduce((t, br) => t + Math.max(0, minutes(br?.begin, br?.end) || 0), 0);
      const worked = minutes(sh.begin, sh.end) - pause;
      return {
        date: isoDate(sh.begin, from),
        hours: Number((worked / 60).toFixed(2)),
        project: sh.groupId ? `Group ${sh.groupId}` : '—',
        comment: String(sh.comment ?? '').trim() || `${BRAND} shift ${sh.id}`,
      };
    })
    .filter((x) => x.hours >= 0.01 && x.hours <= 24 && x.date >= from && x.date <= to)
    .sort((x, y) => x.date.localeCompare(y.date));
  if (rows.length === 0) throw new HttpError(400, `${BRAND} has no shifts for ${rawEmployee} from ${from} to ${to}.`);
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
      <tbody>${rows.map((r, idx) => html`<tr id="wf-h-${idx}"><td class="mono">${r.date}</td><td>${r.project}</td><td>${r.comment}</td><td class="num">${r.hours.toFixed(2)}</td><td>${isSample || empId <= 0 ? html`<span class="muted-note">${isSample ? 'Demo only' : 'Select employee above'}</span>` : html`<form hx-post="/app/quinyx/import" hx-target="#wf-h-${idx}" hx-swap="outerHTML"><input type="hidden" name="employeeId" value="${empId}"><input type="hidden" name="projectId" value="${projId}"><input type="hidden" name="date" value="${r.date}"><input type="hidden" name="hours" value="${r.hours.toFixed(2)}"><input type="hidden" name="comment" value="[${BRAND}] ${r.comment}"><button type="submit" class="button primary">Post to ReAI</button></form>`}</td></tr>`)}</tbody>
    </table></div>`,
  });
}

/**
 * Handles /app/quinyx/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/quinyx';
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
        ${renderConnectPanel(session, { clientId: 'reai-quinyx-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({
          basePath,
          targetId: 'wfm-output',
          brand: BRAND,
          hint: API_HINT,
          fields: [
            { name: 'clientId', label: 'Quinyx client ID', placeholder: 'Client ID' },
            { name: 'clientSecret', label: 'Quinyx client secret', type: 'password', placeholder: 'Client secret' },
            { name: 'region', label: 'Quinyx region (eu or na)', defaultValue: 'eu' },
            { name: 'employee', label: 'Employee badge number', placeholder: '1001' },
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
