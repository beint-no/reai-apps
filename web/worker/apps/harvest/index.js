// @ts-check
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { fetchJson } from '../../lib/api-http.js';
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

/**
 * Fetches finished Harvest time entries for a period.
 * Docs: https://help.getharvest.com/api-v2/authentication-api/authentication/authentication/ (Bearer token,
 * Harvest-Account-Id and User-Agent headers) and
 * https://help.getharvest.com/api-v2/timesheets-api/timesheets/time-entries/ (GET /v2/time_entries with
 * from, to, user_id, is_running, page and per_page up to 2000; next_page in the response).
 * @param {Record<string, string>} creds `apiToken`, `accountId`, optional `userId`, `start` and `end` (exclusive), both YYYY-MM-DD
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<TimeRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const accountId = (creds.accountId ?? '').trim();
  const userId = (creds.userId ?? '').trim();
  if (!token || !/^[0-9]+$/.test(accountId)) throw new HttpError(400, 'Enter both your Harvest Personal Access Token and numeric Account ID.');
  if (userId && !/^[0-9]+$/.test(userId)) throw new HttpError(400, 'The Harvest user ID must be a number.');
  const lastDay = new Date(Date.parse(`${creds.end}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const headers = { authorization: `Bearer ${token}`, 'harvest-account-id': accountId, 'user-agent': 'ReAI Apps (apps.reai.no)', accept: 'application/json' };
  /** @type {any[]} */ const entries = [];
  for (let page = 1; page <= 10; page++) {
    const url = new URL('https://api.harvestapp.com/v2/time_entries');
    url.searchParams.set('from', String(creds.start));
    url.searchParams.set('to', lastDay);
    url.searchParams.set('is_running', 'false');
    if (userId) url.searchParams.set('user_id', userId);
    url.searchParams.set('page', String(page));
    url.searchParams.set('per_page', '2000');
    const body = await fetchJson(url.toString(), { headers }, 'Harvest', fetchImpl);
    entries.push(...(Array.isArray(body?.time_entries) ? body.time_entries : []));
    if (!body?.next_page) break;
  }
  return entries
    .map((e) => ({
      date: String(e.spent_date ?? '').slice(0, 10),
      hours: Number(Number(e.hours ?? 0).toFixed(2)),
      description: String(e.notes ?? '').trim() || String(e.task?.name ?? '').trim() || 'Harvest entry',
      externalProject: [e.project?.name, e.user?.name].filter(Boolean).join(' · ') || '—',
    }))
    .filter((r) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(r.date) && r.hours >= 0.01 && r.hours <= 24);
}

/** @param {{ rows: TimeRow[], employeeId: number, projectId: number, isSample?: boolean }} state */
function renderTimeTable(state) {
  const totalHours = state.rows.reduce((s, r) => s + r.hours, 0);
  return reaiCard({
    eyebrow: 'HARVEST → REAI TIMESHEETS',
    title: `${state.rows.length} time entries ready`,
    badge: state.isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${totalHours.toFixed(2)} h total`, tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Entries', value: String(state.rows.length), detail: 'Running timers are skipped' })}
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
              : html`<form hx-post="/app/harvest/import" hx-target="#tm-row-${idx}" hx-swap="outerHTML">
                  <input type="hidden" name="employeeId" value="${state.employeeId}"><input type="hidden" name="projectId" value="${state.projectId}">
                  <input type="hidden" name="date" value="${r.date}"><input type="hidden" name="hours" value="${r.hours.toFixed(2)}">
                  <input type="hidden" name="comment" value="[Harvest] ${r.description}">
                  <button type="submit" class="button primary">Post to ReAI</button>
                </form>`}</td>
          </tr>`,
        )}</tbody>
      </table></div>
    `,
  });
}

/**
 * Handles /app/harvest/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/harvest';
  const title = "Harvest Timesheet Sync";
  const lead = "Sync logged project hours from Harvest API v2 directly into ReAI Timesheets for invoicing and project tracking.";

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
        ${renderConnectPanel(session, { clientId: 'reai-harvest-web', clientName: 'ReAI Harvest Sync (Web)' })}
        ${reaiCard({
          eyebrow: 'CONNECT HARVEST',
          title: 'Load Harvest time entries',
          body: html`<p class="muted-note">Create a Personal Access Token at id.getharvest.com/developers and copy the token and Account ID. Running timers are skipped.</p>
            <form class="stack" hx-post="${basePath}/preview" hx-target="#tm-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="tm-tok">Harvest Personal Access Token</label><input id="tm-tok" name="apiToken" type="password" autocomplete="off" required placeholder="Harvest token"></div>
                <div class="field"><label for="tm-acc">Harvest Account ID</label><input id="tm-acc" name="accountId" type="text" inputmode="numeric" required placeholder="1234567"></div>
                <div class="field"><label for="tm-user">Harvest user ID (optional)</label><input id="tm-user" name="userId" type="text" inputmode="numeric" placeholder="All users the token can see"></div>
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
      return htmlResponse(renderTimeTable({ rows: await fetchApi({ apiToken: String(form.get('apiToken') ?? ''), accountId: String(form.get('accountId') ?? ''), userId: String(form.get('userId') ?? ''), start: bounds.start, end: bounds.end }), employeeId, projectId }));
    }
    if (pathname === `${basePath}/import`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const employeeId = Number(form.get('employeeId') ?? '0');
      const projectId = Number(form.get('projectId') ?? '0');
      const date = String(form.get('date') ?? '').trim();
      const hours = Number(form.get('hours') ?? '0');
      const comment = String(form.get('comment') ?? '').trim().slice(0, 1000);
      if (employeeId <= 0 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || hours < 0.01 || hours > 24) throw new HttpError(400, 'Valid employee, date and hours (0.01 to 24) are required.');
      const created = /** @type {{ id: number }} */ (
        await reaiRequest(env, '/api/timesheets', {
          token: session.accessToken, tenantId: session.tenantId, method: 'POST',
          body: { employeeId, date, hours: Number(hours.toFixed(2)), ...(projectId > 0 ? { projectId } : {}), ...(comment ? { comment } : {}) },
        })
      );
      return htmlResponse(html`<tr><td class="mono">${date}</td><td>${projectId > 0 ? `Project #${projectId}` : '—'}</td><td>${comment}</td><td class="num">${hours.toFixed(2)}</td><td>${reaiBadge({ text: `Logged #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Harvest error', body: err instanceof Error ? err.message : 'Import failed.' }));
  }
  return errorResponse('Unknown time tracking route.', 404);
}
