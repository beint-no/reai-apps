// @ts-check
import { fetchJson, isoDate, num, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiRequest } from '../../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard } from '../../lib/ui.js';

/** @typedef {{ id: string, date: string, hours: number, project: string, user: string, comment: string }} HoursRow */
/** @typedef {{ id: number, name: string }} SimpleOpt */

const BRAND = 'EG HoltePortalen';
const TITLE = 'EG HoltePortalen Timesheet Sync';
const LEAD = 'Fetch time registrations from the HoltePortalen API and post them to ReAI Timesheets by employee and project.';
const API = 'https://smartapizulu.holte.no';
const PAGE = 500;

/** @type {HoursRow[]} */
const SAMPLE_ROWS = [
  { id: '5f0c2a91', date: '2026-10-14', hours: 7.5, project: '2207 Rehabilitering Storgata 12', user: 'Demo Tømrer', comment: 'Riving og bæring' },
  { id: '7b13e4c0', date: '2026-10-15', hours: 8, project: '2207 Rehabilitering Storgata 12', user: 'Demo Tømrer', comment: 'Montering av bjelkelag' },
];

/** @param {any} payload @returns {any[]} */
function odataList(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.value) ? payload.value : [];
}

const OSLO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * Returns the Oslo calendar day of an OData date-time. A value at midnight is taken as that day;
 * a UTC instant such as 2026-10-13T22:00:00Z becomes 2026-10-14.
 * @param {unknown} value
 */
function osloDay(value) {
  const s = String(value ?? '').trim();
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}(T00:00(:00(\.0+)?)?([+-][0-9]{2}:?[0-9]{2}|Z)?)?$/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  return Number.isNaN(t) ? '' : OSLO_DAY.format(new Date(t));
}

/** @param {string} day @param {number} delta */
function addDays(day, delta) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Reads an OData collection with $count, $orderby and $top/$skip, following @odata.nextLink when the
 * server pages on its own.
 * @param {string} path
 * @param {Record<string, string>} params
 * @param {Record<string, string>} headers
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 * @returns {Promise<any[]>}
 */
async function odataAll(path, params, headers, fetchImpl) {
  /** @type {Map<string, any>} */ const byId = new Map();
  let skip = 0;
  for (let page = 0; page < 15; page++) {
    const query = new URLSearchParams({ ...params, $orderby: 'id', $count: 'true', $top: String(PAGE), $skip: String(skip) });
    const payload = await fetchJson(`${API}${path}?${query}`, { headers }, BRAND, fetchImpl);
    const items = odataList(payload);
    const before = byId.size;
    for (const item of items) byId.set(String(item.id), item);
    skip += items.length;
    const total = Number(payload?.['@odata.count']);
    const more = Number.isFinite(total) ? skip < total : items.length === PAGE || typeof payload?.['@odata.nextLink'] === 'string';
    if (!more || items.length === 0 || byId.size === before) return [...byId.values()];
  }
  throw new HttpError(400, `${BRAND} returned more than 7,500 rows. Enter a user email or choose a shorter period.`);
}

/**
 * Fetches project time registrations from the HoltePortalen API.
 * Docs: https://smartapizulu.holte.no/index.html (Swagger at /swagger/1.0/swagger.json: OData collections
 * /odata/Registration with date, totalHours, projectId, userId, comment, absenceCodeId; /odata/Project with
 * projectName and projectNumber; /odata/User with firstName, lastName, email) and
 * https://smartapizulu.holte.no/Documentation/Tokens.pdf (API token from HoltePortalen settings, sent in the
 * X-Holte-Token header, not as a bearer token). Filtering uses standard OData $filter, $select, $orderby,
 * $count, $top and $skip. Usually 3 subrequests (users, registrations, projects), at most 45.
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
  const headers = { 'x-holte-token': token, accept: 'application/json' };
  // One extra day on each side catches dates stored as UTC instants; the Oslo day is checked below.
  const start = addDays(from, -1);
  const next = addDays(to, 2);
  const users = await odataAll('/odata/User', { $select: 'id,firstName,lastName,email' }, headers, fetchImpl);
  const email = (creds.userEmail ?? '').trim().toLowerCase();
  let filter = `date ge ${start}T00:00:00Z and date lt ${next}T00:00:00Z and absenceCodeId eq null and isNegative eq false`;
  if (email) {
    const user = users.find((u) => String(u.email ?? '').trim().toLowerCase() === email);
    if (!user) throw new HttpError(400, `No ${BRAND} user has the email ${creds.userEmail}.`);
    filter += ` and userId eq ${String(user.id).replace(/[^0-9a-f-]/gi, '')}`;
  }
  const registrations = (await odataAll('/odata/Registration', { $filter: filter, $select: 'id,date,totalHours,projectId,userId,comment,absenceCodeId,isNegative' }, headers, fetchImpl))
    .filter((r) => r.projectId && !r.absenceCodeId && !r.isNegative);
  /** @type {Map<string, string>} */ const userNames = new Map(users.map((u) => [String(u.id), [u.firstName, u.lastName].filter(Boolean).join(' ')]));
  /** @type {Map<string, string>} */ const projectNames = new Map();
  if (registrations.length > 0) {
    for (const p of await odataAll('/odata/Project', { $select: 'id,projectName,projectNumber' }, headers, fetchImpl)) {
      projectNames.set(String(p.id), [p.projectNumber, p.projectName].filter(Boolean).join(' '));
    }
  }
  const rows = registrations
    .map((r) => ({
      id: String(r.id ?? '').slice(0, 8),
      date: osloDay(r.date),
      hours: Number(num(r.totalHours).toFixed(2)),
      project: projectNames.get(String(r.projectId)) ?? 'Project',
      user: userNames.get(String(r.userId)) ?? '',
      comment: String(r.comment ?? '').trim() || `${BRAND} hours`,
    }))
    .filter((r) => r.date >= from && r.date <= to && r.hours >= 0.01 && r.hours <= 24);
  if (rows.length === 0) throw new HttpError(400, `${BRAND} returned no project hours for ${from} to ${to}.`);
  return rows;
}

/** @param {HoursRow[]} rows @param {number} empId @param {number} projId @param {boolean} isSample */
function renderHours(rows, empId, projId, isSample) {
  return reaiCard({
    eyebrow: 'EG HOLTEPORTALEN → REAI TIMESHEETS',
    title: `${rows.length} registrations (${rows.reduce((s, r) => s + r.hours, 0).toFixed(2)} h)`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Ready', tone: 'success' }),
    body: html`<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Date</th><th>Project</th><th>Comment</th><th class="num">Hours</th><th>Action</th></tr></thead>
      <tbody>${rows.map((r, idx) => html`<tr id="ho-h-${idx}"><td class="mono">${r.date}</td><td>${r.project}${r.user ? html`<br><span class="muted-note">${r.user}</span>` : ''}</td><td>${r.comment}</td><td class="num">${r.hours.toFixed(2)}</td><td>${isSample || empId <= 0 ? html`<span class="muted-note">${isSample ? 'Demo only' : 'Select employee above'}</span>` : html`<form hx-post="/app/holte/import" hx-target="#ho-h-${idx}" hx-swap="outerHTML"><input type="hidden" name="employeeId" value="${empId}"><input type="hidden" name="projectId" value="${projId}"><input type="hidden" name="date" value="${r.date}"><input type="hidden" name="hours" value="${r.hours.toFixed(2)}"><input type="hidden" name="comment" value="[Holte ${r.id}] ${r.project}: ${r.comment}"><button type="submit" class="button primary">Post to ReAI</button></form>`}</td></tr>`)}</tbody>
    </table></div>`,
  });
}

/**
 * Handles /app/holte/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/holte';
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
      <div class="field"><label for="ho-emp">ReAI employee</label><select id="ho-emp" name="employeeId"><option value="0">${employees.length > 0 ? 'Select employee…' : 'Connect to ReAI first'}</option>${employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}</select></div>
      <div class="field"><label for="ho-proj">ReAI project (optional)</label><select id="ho-proj" name="projectId"><option value="0">No project</option>${projects.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></div>
    </div>`;
    const body = html`
      <section class="app-intro"><p class="eyebrow">CONSTRUCTION & TRADES</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-holte-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({
          basePath,
          targetId: 'ho-output',
          brand: BRAND,
          hint: 'Create an API token in HoltePortalen under Settings → API tokens. Enter a user email to fetch one person only. Absence and negative registrations are skipped.',
          fields: [
            { name: 'apiToken', label: 'HoltePortalen API token', type: 'password', placeholder: 'X-Holte-Token' },
            { name: 'userEmail', label: 'HoltePortalen user email (optional)', required: false },
            { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
            { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
          ],
          extraFields,
          sampleAction: true,
        })}
        <div id="ho-output" class="stack"></div>
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
      const marker = comment.match(/^\[Holte [0-9a-f]+\]/i)?.[0] ?? '';
      if (marker) {
        const logged = /** @type {Array<{ id: number, comment?: string | null }>} */ (await reaiRequest(env, '/api/timesheets', { token: session.accessToken, tenantId: session.tenantId, query: { employeeId: String(employeeId), startDate: date, endDate: date } }));
        const dup = Array.isArray(logged) ? logged.find((t) => typeof t.comment === 'string' && t.comment.startsWith(marker)) : undefined;
        if (dup) return htmlResponse(html`<tr><td class="mono">${date}</td><td>${projectId > 0 ? `Project #${projectId}` : '—'}</td><td>${comment}</td><td class="num">${hours.toFixed(2)}</td><td>${reaiBadge({ text: `Already logged #${dup.id}`, tone: 'warn' })}</td></tr>`);
      }
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/timesheets', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { employeeId, date, hours: Number(hours.toFixed(2)), ...(projectId > 0 ? { projectId } : {}), comment } }));
      return htmlResponse(html`<tr><td class="mono">${date}</td><td>${projectId > 0 ? `Project #${projectId}` : '—'}</td><td>${comment}</td><td class="num">${hours.toFixed(2)}</td><td>${reaiBadge({ text: `Logged #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
