// @ts-check
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiRequest } from '../../lib/reai.js';
import { currentMonthIso, monthBounds } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/**
 * @typedef {{ date: string, hours: number, description: string, externalProject: string }} TimeRow
 * @typedef {{ id: number, name: string }} SimpleOption
 */

const SAMPLE_ROWS = [
  { date: '2026-10-12', hours: 7.5, externalProject: 'Byggprosjekt Nord', description: 'Montering og kontroll' },
  { date: '2026-10-13', hours: 8.0, externalProject: 'Byggprosjekt Nord', description: 'Ferdigstillelse etasje 2' },
  { date: '2026-10-14', hours: 4.25, externalProject: 'Serviceavtale', description: 'Feilsøking anlegg' },
];

const OSLO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' });
const OSLO_HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', hourCycle: 'h23' });

/** @param {number | string | Date} t */
function osloDay(t) {
  return OSLO_DAY.format(new Date(t));
}

/**
 * First instant of an Oslo calendar day, as RFC 3339 UTC.
 * @param {string} ymd
 */
function osloMidnightUtc(ymd) {
  const base = Date.parse(`${ymd}T00:00:00Z`);
  for (const offsetHours of [1, 2]) {
    const t = base - offsetHours * 3_600_000;
    if (osloDay(t) === ymd && OSLO_HOUR.format(new Date(t)) === '00') return new Date(t).toISOString().replace('.000Z', 'Z');
  }
  return new Date(base).toISOString().replace('.000Z', 'Z');
}

/**
 * Reads the token owner's time entries that start in [start, end) Oslo days.
 * One request: GET /api/v9/me/time_entries with RFC 3339 start_date/end_date and meta=true for project names.
 * Docs: https://engineering.toggl.com/docs/track/api/time_entries/ (quota and 402/429: https://engineering.toggl.com/docs/track/).
 * @param {FormData} form
 * @param {string} start
 * @param {string} end
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<TimeRow[]>}
 */
export async function fetchRows(form, start, end, fetchImpl = fetch) {
  const token = String(form.get('apiToken') ?? '').trim();
  if (!token) throw new HttpError(400, 'Enter your Toggl Track API token.');
  const url = new URL('https://api.track.toggl.com/api/v9/me/time_entries');
  url.searchParams.set('start_date', osloMidnightUtc(start));
  url.searchParams.set('end_date', osloMidnightUtc(end));
  url.searchParams.set('meta', 'true');
  const res = await fetchImpl(url, { headers: { authorization: `Basic ${btoa(`${token}:api_token`)}`, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    const wait = res.headers.get('x-toggl-quota-resets-in');
    throw new HttpError(400,
      res.status === 401 || res.status === 403 ? 'Toggl rejected this API token. Copy it again from Profile settings in Toggl Track.'
      : res.status === 402 ? `Toggl's hourly API quota for this user is used up.${wait ? ` Try again in ${Math.ceil(Number(wait) / 60)} minutes.` : ' Try again later.'}`
      : res.status === 429 ? 'Toggl is rate limiting requests. Wait a few seconds and try again.'
      : `Toggl returned HTTP ${res.status}.`);
  }
  const items = /** @type {Array<any>} */ (await res.json());
  if (!Array.isArray(items)) throw new HttpError(502, 'Toggl returned an unexpected response.');
  return items
    .filter((e) => typeof e.duration === 'number' && e.duration > 0 && !e.server_deleted_at && Number.isFinite(Date.parse(String(e.start ?? ''))))
    .map((e) => ({ e, date: osloDay(String(e.start ?? '')) }))
    .filter(({ date }) => date >= start && date < end)
    .map(({ e, date }) => ({
      date,
      hours: Math.min(24, Math.max(0.01, Math.round(e.duration / 36) / 100)),
      description: String(e.description ?? 'Toggl entry').trim() || 'Toggl entry',
      externalProject: typeof e.project_name === 'string' && e.project_name ? e.project_name : e.project_id ? `Project #${e.project_id}` : '—',
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** @param {{ rows: TimeRow[], employeeId: number, projectId: number, isSample?: boolean }} state */
function renderTimeTable(state) {
  const totalHours = state.rows.reduce((s, r) => s + r.hours, 0);
  return reaiCard({
    eyebrow: 'TOGGL TRACK → REAI TIMESHEETS',
    title: `${state.rows.length} time entries ready`,
    badge: state.isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${totalHours.toFixed(2)} h total`, tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Entries', value: String(state.rows.length), detail: 'Validated 0.01–24.00 h/day' })}
        ${reaiMetric({ label: 'Total hours', value: `${totalHours.toFixed(2)} h`, detail: 'Ready for ReAI Timesheets' })}
        ${reaiMetric({ label: 'Target employee', value: state.employeeId > 0 ? `#${state.employeeId}` : 'Select above', detail: state.projectId > 0 ? `Project #${state.projectId}` : 'No project linked' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Project</th><th>Comment</th><th class="num">Hours</th><th>Action</th></tr></thead>
        <tbody>${state.rows.map(
          (r, idx) => html`<tr id="tm-row-${idx}">
            <td class="mono">${r.date}</td><td>${r.externalProject}</td><td>${r.description}</td><td class="num">${r.hours.toFixed(2)}</td>
            <td>${state.isSample || state.employeeId <= 0
              ? html`<span class="muted-note">${state.isSample ? 'Demo only' : 'Select employee above'}</span>`
              : html`<form hx-post="/app/toggl/import" hx-target="#tm-row-${idx}" hx-swap="outerHTML">
                  <input type="hidden" name="employeeId" value="${state.employeeId}"><input type="hidden" name="projectId" value="${state.projectId}">
                  <input type="hidden" name="date" value="${r.date}"><input type="hidden" name="hours" value="${r.hours.toFixed(2)}">
                  <input type="hidden" name="comment" value="[Toggl Track] ${r.description}">
                  <button type="submit" class="button primary">Post to ReAI</button>
                </form>`}</td>
          </tr>`,
        )}</tbody>
      </table></div>
    `,
  });
}

/**
 * Handles /app/toggl/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/toggl';
  const title = "Toggl Track Timesheet Sync";
  const lead = "Pull worked hours from the Toggl Track API and post them to ReAI Timesheets for payroll and customer invoicing.";

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    /** @type {SimpleOption[]} */
    let employees = [];
    /** @type {SimpleOption[]} */
    let projects = [];
    if (session && session.tenantId > 0) {
      try {
        const [eRes, pRes] = await Promise.all([
          reaiRequest(env, '/api/employees', { token: session.accessToken, tenantId: session.tenantId }),
          reaiAll(env, '/api/projects', { token: session.accessToken, tenantId: session.tenantId }),
        ]);
        employees = Array.isArray(eRes) ? /** @type {SimpleOption[]} */ (eRes) : [];
        projects = /** @type {Array<SimpleOption & { archived?: boolean }>} */ (pRes).filter((p) => !p.archived);
      } catch { employees = []; projects = []; }
    }
    const defaultMonth = currentMonthIso();
    const body = html`
      <section class="app-intro"><p class="eyebrow">TIME TRACKING & PROJECTS</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-toggl-web', clientName: 'ReAI Toggl Track Sync (Web)' })}
        ${reaiCard({
          eyebrow: 'CONNECT TOGGL TRACK',
          title: 'Load Toggl Track time entries',
          body: html`<p class="muted-note">Copy your Toggl Track API token from Profile Settings → API Token. Used only for this request and never stored.</p>
            <form class="stack" hx-post="${basePath}/preview" hx-target="#tm-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="tm-tok">Toggl Track API token</label><input id="tm-tok" name="apiToken" type="password" autocomplete="off" required placeholder="Toggl API token"></div>
                <div class="field"><label for="tm-month">Month</label><input id="tm-month" name="month" type="text" pattern="[0-9]{4}-[0-9]{2}" value="${defaultMonth}" required></div>
                <div class="field"><label for="tm-emp">ReAI employee</label><select id="tm-emp" name="employeeId"><option value="0">${employees.length > 0 ? 'Select employee…' : 'Connect to ReAI to load employees'}</option>${employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}</select></div>
                <div class="field"><label for="tm-proj">ReAI project (optional)</label><select id="tm-proj" name="projectId"><option value="0">No project</option>${projects.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Preview time entries</button>
                <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#tm-output" hx-swap="innerHTML">Load sample entries</button>
              </div>
            </form>`,
        })}
        <div id="tm-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${basePath}/sample`) return htmlResponse(renderTimeTable({ rows: SAMPLE_ROWS, employeeId: 1, projectId: 10, isSample: true }));

  try {
    const form = await request.formData();
    if (pathname === `${basePath}/preview`) {
      const employeeId = Number(form.get('employeeId') ?? '0');
      const projectId = Number(form.get('projectId') ?? '0');
      const bounds = monthBounds(String(form.get('month') ?? currentMonthIso()).trim());
      return htmlResponse(renderTimeTable({ rows: await fetchRows(form, bounds.start, bounds.end), employeeId, projectId }));
    }
    if (pathname === `${basePath}/import`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const employeeId = Number(form.get('employeeId') ?? '0');
      const projectId = Number(form.get('projectId') ?? '0');
      const date = String(form.get('date') ?? '').trim();
      const hours = Number(form.get('hours') ?? '0');
      const comment = String(form.get('comment') ?? '').trim().slice(0, 1000);
      if (employeeId <= 0 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || hours < 0.01 || hours > 24) throw new HttpError(400, 'Valid employee, date and hours (0.01–24) are required.');
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const existing = /** @type {Array<{ id: number | null, hours: number, comment: string | null, projectId: number | null }>} */ (
        await reaiRequest(env, '/api/timesheets', { ...auth, query: { employeeId: String(employeeId), startDate: date, endDate: date } })
      );
      const dup = (Array.isArray(existing) ? existing : []).find((t) => Math.abs(Number(t.hours) - hours) < 0.005 && (t.comment ?? '') === comment && (t.projectId ?? 0) === projectId);
      if (dup) return htmlResponse(html`<tr><td class="mono">${date}</td><td>${projectId > 0 ? `Project #${projectId}` : '—'}</td><td>${comment}</td><td class="num">${hours.toFixed(2)}</td><td>${reaiBadge({ text: `Already logged${dup.id ? ` #${dup.id}` : ''}`, tone: 'warn' })}</td></tr>`);
      const created = /** @type {{ id: number }} */ (
        await reaiRequest(env, '/api/timesheets', {
          ...auth, method: 'POST',
          body: { employeeId, date, hours: Number(hours.toFixed(2)), ...(projectId > 0 ? { projectId } : {}), ...(comment ? { comment } : {}) },
        })
      );
      return htmlResponse(html`<tr><td class="mono">${date}</td><td>${projectId > 0 ? `Project #${projectId}` : '—'}</td><td>${comment}</td><td class="num">${hours.toFixed(2)}</td><td>${reaiBadge({ text: `Logged #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Toggl Track error', body: err instanceof Error ? err.message : 'Import failed.' }));
  }
  return errorResponse('Unknown time tracking route.', 404);
}
