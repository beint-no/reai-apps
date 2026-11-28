// @ts-check
import { fetchJson, isoDate, num, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiRequest } from '../../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/** @typedef {{ date: string, hours: number, person: string, project: string, comment: string }} HoursRow */
/** @typedef {{ id: number, name: string }} SimpleOpt */

const SLUG = 'tidsbanken';
const BRAND = 'Tidsbanken';
const BASE_PATH = '/app/tidsbanken';
const TITLE = 'Tidsbanken Timesheet Sync';
const EYEBROW = 'TIME & ATTENDANCE';
const LEAD = 'Fetch approved hours from the Tidsbanken API and post them to ReAI Timesheets for one employee and project.';
const API_HINT = 'Get the subscription key by subscribing to the Public product on developer.tidsbanken.net. Get the tb-key in Tidsbanken as an administrator: wrench icon → Integrasjon → API-nøkkel → Hent API-nøkkel.';
const API = 'https://api.tidsbanken.net';
const API_VERSION = '3.0';
const MAX_DAYS = 93;

/** @type {import('../../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [
  { name: 'subscriptionKey', label: 'Subscription key (Ocp-Apim-Subscription-Key)', type: 'password' },
  { name: 'tbKey', label: 'tb-key', type: 'password' },
  { name: 'person', label: 'Tidsbanken employee name (optional)', required: false, placeholder: 'All employees' },
  { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
  { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
];

/** @type {HoursRow[]} */
const SAMPLE_ROWS = [
  { date: '2026-10-12', hours: 7.5, person: 'Kari Nordmann', project: 'Byggprosjekt Nord', comment: 'Montering og kontroll' },
  { date: '2026-10-13', hours: 8, person: 'Kari Nordmann', project: 'Byggprosjekt Nord', comment: 'Ferdigstillelse etasje 2' },
];

/** @param {string} from @param {string} to */
function assertRange(from, to) {
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  if (!(days >= 0)) throw new HttpError(400, 'The to date must be on or after the from date.');
  if (days > MAX_DAYS) throw new HttpError(400, `Choose a period of at most ${MAX_DAYS} days.`);
}

/** Timetype values that are allowances or units rather than worked hours (GetTimelinjeModel.Timetype). */
const NON_HOUR_TYPES = new Set(['tillegg', 'enhetstillegg']);
const OSLO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * Europe/Oslo day of a Tidsbanken date. The docs warn that date fields can carry a wrong time zone shift, so a value
 * with an offset or Z is converted to the Oslo calendar day.
 * @param {unknown} v
 */
function osloDay(v) {
  const s = String(v ?? '').trim();
  if (!/(Z|[+-][0-9]{2}:?[0-9]{2})$/i.test(s)) return isoDate(s, '');
  const t = Date.parse(s);
  return Number.isNaN(t) ? '' : OSLO_DAY.format(t);
}

/** @param {string} day @param {number} delta */
function shiftDay(day, delta) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Follows OData @odata.nextLink pages on api.tidsbanken.net (10,000 rows per page).
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 * @returns {Promise<any[]>}
 */
async function odataAll(url, headers, fetchImpl) {
  /** @type {any[]} */ const out = [];
  let next = url;
  for (let page = 0; page < 10 && next; page++) {
    const data = await fetchJson(next, { headers }, BRAND, fetchImpl);
    out.push(...(Array.isArray(data) ? data : Array.isArray(data?.value) ? data.value : []));
    const link = typeof data?.['@odata.nextLink'] === 'string' ? data['@odata.nextLink'] : '';
    next = link && new URL(link, API).origin === API ? new URL(link, API).toString() : '';
  }
  if (next) throw new HttpError(400, 'Tidsbanken returned more hours than one fetch can read. Choose a shorter period.');
  return out;
}

/**
 * Fetches approved time lines from the Tidsbanken API.
 * Docs: https://developer.tidsbanken.net/apis . Timelinje API version 3.0 (x-api-version header; version 3.1 only adds
 * /timeeksport): GET /timelinje/TimelinjeBehandlet with $select, $filter, $top (max 10,000 per page, then
 * @odata.nextLink). Ansatt API 3.0: GET /ansatt/ansatt with Id, Fornavn, Etternavn. Prosjekt API 3.0: GET /prosjekt/Prosjekt
 * with Id, Navn. Headers tb-key, Ocp-Apim-Subscription-Key and x-api-version; rate limit 300 calls per 60 seconds.
 * OData syntax: https://developer.tidsbanken.net/odata ; paging: https://developer.tidsbanken.net/pagination ;
 * tb-key: https://developer.tidsbanken.net/find-your-tb-key .
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<HoursRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const subscriptionKey = (creds.subscriptionKey ?? '').trim();
  const tbKey = (creds.tbKey ?? '').trim();
  if (!subscriptionKey || !tbKey) throw new HttpError(400, 'Enter the Tidsbanken subscription key and tb-key.');
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  assertRange(from, to);
  const headers = { 'tb-key': tbKey, 'Ocp-Apim-Subscription-Key': subscriptionKey, 'x-api-version': API_VERSION, accept: 'application/json' };

  // One day of margin on each side absorbs the documented time zone shift; rows are then filtered by Oslo day.
  const lines = await odataAll(`${API}/timelinje/TimelinjeBehandlet?${new URLSearchParams({
    $select: 'Id,AnsattId,Dato,AntallTimer,ProsjektId,Notat,Godkjent,Timetype',
    $filter: `Dato ge ${shiftDay(from, -1)} and Dato le ${shiftDay(to, 1)} and Godkjent eq true`,
    $orderby: 'Dato',
    $top: '10000',
  })}`, headers, fetchImpl);
  const kept = lines
    .map((l) => ({ l, date: osloDay(l.Dato) }))
    .filter(({ l, date }) => date && date >= from && date <= to && !NON_HOUR_TYPES.has(String(l.Timetype ?? '').trim().toLowerCase()));
  const hasProjects = kept.some(({ l }) => String(l.ProsjektId ?? '').trim());
  // Names come from the Ansatt and Prosjekt APIs in parallel, once per fetch.
  const [people, projectList] = kept.length === 0 ? [[], []] : await Promise.all([
    odataAll(`${API}/ansatt/ansatt?${new URLSearchParams({ $select: 'Id,Fornavn,Etternavn', $top: '10000' })}`, headers, fetchImpl),
    hasProjects ? odataAll(`${API}/prosjekt/Prosjekt?${new URLSearchParams({ $select: 'Id,Navn', $top: '10000' })}`, headers, fetchImpl) : Promise.resolve([]),
  ]);
  /** @type {Map<string, string>} */ const names = new Map(people.map((a) => [String(a.Id), [a.Fornavn, a.Etternavn].filter(Boolean).join(' ').trim()]));
  /** @type {Map<string, string>} */ const projects = new Map(projectList.map((p) => [String(p.Id), String(p.Navn ?? '').trim()]));
  const wanted = (creds.person ?? '').trim().toLowerCase();
  const rows = kept
    .map(({ l, date }) => {
      const pid = String(l.ProsjektId ?? '').trim();
      const aid = l.AnsattId != null ? String(l.AnsattId) : '';
      return {
        date,
        hours: Math.round(num(l.AntallTimer) * 100) / 100,
        person: names.get(aid) || (aid ? `Ansatt ${aid}` : '—'),
        project: pid ? (projects.get(pid) || `Prosjekt ${pid}`) : '—',
        comment: String(l.Notat ?? '').trim() || 'Tidsbanken hours',
      };
    })
    .filter((r) => r.hours >= 0.01 && r.hours <= 24 && (!wanted || r.person.toLowerCase().includes(wanted)));
  if (rows.length === 0) throw new HttpError(400, `Tidsbanken has no approved hours from ${from} to ${to}${wanted ? ` for "${creds.person}"` : ''}.`);
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
          : html`<form hx-post="${BASE_PATH}/import" hx-target="#${SLUG}-h-${idx}" hx-swap="outerHTML"><input type="hidden" name="employeeId" value="${empId}"><input type="hidden" name="projectId" value="${projId}"><input type="hidden" name="date" value="${r.date}"><input type="hidden" name="hours" value="${r.hours.toFixed(2)}"><input type="hidden" name="comment" value="[${BRAND}] ${r.project} · ${r.comment}"><button type="submit" class="button primary">Post to ReAI</button></form>`}</td></tr>`)}</tbody>
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
 * Handles /app/tidsbanken/* routes.
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
      const existing = /** @type {Array<{ id?: number | null, hours: number, comment?: string | null, projectId?: number | null }>} */ (
        await reaiRequest(env, '/api/timesheets', { ...auth, query: { employeeId: String(employeeId), startDate: date, endDate: date } })
      );
      const dup = (Array.isArray(existing) ? existing : []).find((t) => Math.abs(Number(t.hours) - hours) < 0.005 && (t.comment ?? '') === comment && (t.projectId ?? 0) === (projectId > 0 ? projectId : 0));
      if (dup) return htmlResponse(html`<tr><td class="mono">${date}</td><td>—</td><td>${projectId > 0 ? `Project #${projectId}` : '—'}</td><td>${comment}</td><td class="num">${hours.toFixed(2)}</td><td>${reaiBadge({ text: `Already logged${dup.id ? ` #${dup.id}` : ''}`, tone: 'warn' })}</td></tr>`);
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/timesheets', { ...auth, method: 'POST', body: { employeeId, date, hours: Number(hours.toFixed(2)), ...(projectId > 0 ? { projectId } : {}), comment } }));
      return htmlResponse(html`<tr><td class="mono">${date}</td><td>—</td><td>${projectId > 0 ? `Project #${projectId}` : '—'}</td><td>${comment}</td><td class="num">${hours.toFixed(2)}</td><td>${reaiBadge({ text: `Logged #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
