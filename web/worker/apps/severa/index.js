// @ts-check
import { assertPublicHttpsUrl, fetchJson, isoDate, num, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiRequest } from '../../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/** @typedef {{ ref: string, date: string, hours: number, person: string, project: string, comment: string }} HoursRow */
/** @typedef {{ id: number, name: string }} SimpleOpt */

const SLUG = 'severa';
const BRAND = 'Severa';
const BASE_PATH = '/app/severa';
const TITLE = 'Severa Timesheet Sync';
const EYEBROW = 'PROFESSIONAL SERVICES · TIME';
const LEAD = 'Fetch work hours from the Severa REST API and post them to ReAI Timesheets for one employee and project.';
const API_HINT = 'Create client credentials in Severa under Settings → REST API (needs the REST API add-on and an administrator). The client needs the hours:read scope.';
const API = 'https://api.severa.visma.com/rest-api/v1.0';
const MAX_DAYS = 93;
const MAX_PAGES = 45;

/** @type {import('../../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [
  { name: 'clientId', label: 'Client ID' },
  { name: 'clientSecret', label: 'Client secret', type: 'password' },
  { name: 'person', label: 'Severa user name (optional)', required: false, placeholder: 'All users' },
  { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
  { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
];

/** @type {HoursRow[]} */
const SAMPLE_ROWS = [
  { ref: 'sample-1', date: '2026-10-12', hours: 7.5, person: 'Kari Nordmann', project: 'ERP rådgivning · Analyse', comment: 'Workshop og spesifikasjon' },
  { ref: 'sample-2', date: '2026-10-13', hours: 6, person: 'Kari Nordmann', project: 'ERP rådgivning · Leveranse', comment: 'Teknisk leveranse' },
];

/** @param {string} from @param {string} to */
function assertRange(from, to) {
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (!(days >= 0)) throw new HttpError(400, 'The to date must be on or after the from date.');
  if (days > MAX_DAYS) throw new HttpError(400, `Choose a period of at most ${MAX_DAYS} days.`);
}

/**
 * Fetches work hours from the Severa REST API.
 * Docs: https://api.severa.visma.com/rest-api-doc (POST /token with client_Id, client_Secret and scope, Bearer token,
 * NextPageToken header with pageToken paging) and the specification at
 * https://api.severa.visma.com/psapublicrest/openapidocs/v1.0/doc.json (GET /v1/workhours with eventDateStart,
 * eventDateEnd and rowCount; WorkHourOutputModel fields eventDate, quantity, description, user, project, phase).
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<HoursRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const clientId = (creds.clientId ?? '').trim();
  const clientSecret = (creds.clientSecret ?? '').trim();
  if (!clientId || !clientSecret) throw new HttpError(400, 'Enter the Severa client ID and client secret.');
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  assertRange(from, to);
  const login = await fetchJson(`${API}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_Id: clientId, client_Secret: clientSecret, scope: 'hours:read' }),
  }, BRAND, fetchImpl);
  const token = typeof login?.access_token === 'string' ? login.access_token : '';
  if (!token) throw new HttpError(400, 'Severa did not return an access token. Check the client credentials.');

  /** @type {any[]} */ const items = [];
  let pageToken = '';
  for (let page = 0; ; page++) {
    if (page === MAX_PAGES) throw new HttpError(400, `Severa has more than ${MAX_PAGES * 100} work hour entries in this period. Choose a shorter period.`);
    const query = new URLSearchParams({ eventDateStart: from, eventDateEnd: to, rowCount: '100' });
    if (pageToken) query.set('pageToken', pageToken);
    const url = `${API}/workhours?${query}`;
    assertPublicHttpsUrl(url);
    const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    if (res.status === 429) throw new HttpError(429, 'Severa rate limit reached (10 calls per second, 100,000 per day for each API client). Wait a moment and try again.');
    if (!res.ok) throw new HttpError(400, `Severa API ${res.status === 401 || res.status === 403 ? 'rejected the token. Check that the client has the hours:read scope' : `returned HTTP ${res.status}`}.`);
    const data = await res.json();
    if (Array.isArray(data)) items.push(...data);
    pageToken = res.headers.get('NextPageToken') ?? '';
    if (!pageToken) break;
  }

  const wanted = (creds.person ?? '').trim().toLowerCase();
  const rows = items.map((w) => {
    const person = String(w.user?.name ?? [w.user?.firstName, w.user?.lastName].filter(Boolean).join(' ')).trim();
    const project = [w.project?.name, w.phase?.name].filter(Boolean).join(' · ');
    return {
      ref: String(w.guid ?? ''),
      date: isoDate(w.eventDate, ''),
      hours: Number(num(w.quantity).toFixed(2)),
      person: person || '—',
      project: project || '—',
      comment: String(w.description || w.workType?.name || '').trim() || 'Severa work hours',
    };
  }).filter((r) => r.date && r.hours >= 0.01 && r.hours <= 24 && (!wanted || r.person.toLowerCase().includes(wanted)));
  if (rows.length === 0) throw new HttpError(400, `Severa has no work hours from ${from} to ${to}${wanted ? ` for "${creds.person}"` : ''}.`);
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
          : html`<form hx-post="${BASE_PATH}/import" hx-target="#${SLUG}-h-${idx}" hx-swap="outerHTML"><input type="hidden" name="employeeId" value="${empId}"><input type="hidden" name="projectId" value="${projId}"><input type="hidden" name="date" value="${r.date}"><input type="hidden" name="hours" value="${r.hours.toFixed(2)}"><input type="hidden" name="comment" value="[${BRAND}] ${r.project} · ${r.comment}"><input type="hidden" name="ref" value="${r.ref}"><button type="submit" class="button primary">Post to ReAI</button></form>`}</td></tr>`)}</tbody>
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
 * Handles /app/severa/* routes.
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
      const ref = String(form.get('ref') ?? '').trim();
      if (!/^[0-9a-f-]{36}$/i.test(ref)) throw new HttpError(400, 'The Severa work hour id is missing. Fetch the hours again.');
      const marker = `(Severa ${ref})`;
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const cells = html`<td class="mono">${date}</td><td>—</td><td>${projectId > 0 ? `Project #${projectId}` : '—'}</td><td>${comment}</td><td class="num">${hours.toFixed(2)}</td>`;
      const existing = /** @type {Array<{ id: number, comment?: string | null }>} */ (await reaiRequest(env, '/api/timesheets', { ...auth, query: { employeeId: String(employeeId), startDate: date, endDate: date } }));
      const dup = existing.find((t) => typeof t.comment === 'string' && t.comment.includes(marker));
      if (dup) return htmlResponse(html`<tr>${cells}<td>${reaiBadge({ text: `Already logged #${dup.id}`, tone: 'neutral' })}</td></tr>`);
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/timesheets', { ...auth, method: 'POST', body: { employeeId, date, hours: Number(hours.toFixed(2)), ...(projectId > 0 ? { projectId } : {}), comment: `${comment.slice(0, 940)} ${marker}` } }));
      return htmlResponse(html`<tr>${cells}<td>${reaiBadge({ text: `Logged #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
