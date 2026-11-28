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

/** @type {Record<string, string>} */
const REGION_HOSTS = { global: 'https://api.clockify.me', euc1: 'https://euc1.clockify.me', use2: 'https://use2.clockify.me', euw2: 'https://euw2.clockify.me', apse2: 'https://apse2.clockify.me' };

/** @param {string} iso */
function parseIsoDurationHours(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  return Number(m[1] ?? '0') + Number(m[2] ?? '0') / 60 + Number(m[3] ?? '0') / 3600;
}

/** @param {string} iso */
function osloDate(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

/**
 * Fetches the API key owner's finished time entries for a period from the Clockify API v1.
 * Docs: https://docs.clockify.me/ (X-Api-Key header; regional prefixes euc1, use2, euw2, apse2;
 * GET /v1/user for activeWorkspace and id; GET /v1/workspaces/{workspaceId}/user/{userId}/time-entries
 * with start, end, page and page-size; GET /v1/workspaces/{workspaceId}/projects for project names).
 * @param {Record<string, string>} creds `apiKey`, `region`, `start` (YYYY-MM-DD) and `end` (exclusive YYYY-MM-DD)
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<TimeRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const apiKey = (creds.apiKey ?? '').trim();
  if (!apiKey) throw new HttpError(400, 'Enter your Clockify API key.');
  const host = REGION_HOSTS[creds.region ?? 'global'] ?? REGION_HOSTS.global;
  const start = String(creds.start ?? '');
  const end = String(creds.end ?? '');
  const headers = { 'x-api-key': apiKey, accept: 'application/json' };
  const user = /** @type {{ id: string, activeWorkspace?: string, defaultWorkspace?: string }} */ (await fetchJson(`${host}/api/v1/user`, { headers }, 'Clockify', fetchImpl));
  const ws = user.activeWorkspace || user.defaultWorkspace;
  if (!ws) throw new HttpError(400, 'No active Clockify workspace found.');
  const dayMs = 86_400_000;
  /** @type {any[]} */ const entries = [];
  for (let page = 1; page <= 20; page++) {
    const url = new URL(`${host}/api/v1/workspaces/${encodeURIComponent(ws)}/user/${encodeURIComponent(user.id)}/time-entries`);
    url.searchParams.set('start', `${new Date(Date.parse(`${start}T00:00:00Z`) - dayMs).toISOString().slice(0, 10)}T00:00:00Z`);
    url.searchParams.set('end', `${new Date(Date.parse(`${end}T00:00:00Z`) + dayMs).toISOString().slice(0, 10)}T00:00:00Z`);
    url.searchParams.set('page', String(page));
    url.searchParams.set('page-size', '200');
    const batch = await fetchJson(url.toString(), { headers }, 'Clockify', fetchImpl);
    const items = Array.isArray(batch) ? batch : [];
    entries.push(...items);
    if (items.length < 200) break;
  }
  /** @type {Map<string, string>} */ const projectNames = new Map();
  if (entries.some((e) => e.projectId)) {
    for (let page = 1; page <= 10; page++) {
      const url = new URL(`${host}/api/v1/workspaces/${encodeURIComponent(ws)}/projects`);
      url.searchParams.set('page', String(page));
      url.searchParams.set('page-size', '200');
      const batch = await fetchJson(url.toString(), { headers }, 'Clockify', fetchImpl);
      const items = Array.isArray(batch) ? batch : [];
      for (const p of items) projectNames.set(String(p.id), String(p.name ?? p.id));
      if (items.length < 200) break;
    }
  }
  return entries
    .filter((e) => e.timeInterval?.end)
    .map((e) => {
      const s = Date.parse(String(e.timeInterval.start ?? ''));
      const f = Date.parse(String(e.timeInterval.end ?? ''));
      const hours = Number.isFinite(s) && Number.isFinite(f) ? (f - s) / 3_600_000 : parseIsoDurationHours(String(e.timeInterval.duration ?? ''));
      return {
        date: osloDate(String(e.timeInterval.start ?? '')),
        hours: Number(hours.toFixed(2)),
        description: String(e.description ?? '').trim() || 'Clockify entry',
        externalProject: e.projectId ? (projectNames.get(String(e.projectId)) ?? `Project ${String(e.projectId)}`) : '—',
      };
    })
    .filter((r) => r.date >= start && r.date < end && r.hours >= 0.01 && r.hours <= 24);
}

/** @param {{ rows: TimeRow[], employeeId: number, projectId: number, isSample?: boolean }} state */
function renderTimeTable(state) {
  const totalHours = state.rows.reduce((s, r) => s + r.hours, 0);
  return reaiCard({
    eyebrow: 'CLOCKIFY → REAI TIMESHEETS',
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
              : html`<form hx-post="/app/clockify/import" hx-target="#tm-row-${idx}" hx-swap="outerHTML">
                  <input type="hidden" name="employeeId" value="${state.employeeId}"><input type="hidden" name="projectId" value="${state.projectId}">
                  <input type="hidden" name="date" value="${r.date}"><input type="hidden" name="hours" value="${r.hours.toFixed(2)}">
                  <input type="hidden" name="comment" value="[Clockify] ${r.description}">
                  <button type="submit" class="button primary">Post to ReAI</button>
                </form>`}</td>
          </tr>`,
        )}</tbody>
      </table></div>
    `,
  });
}

/**
 * Handles /app/clockify/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/clockify';
  const title = "Clockify Timesheet Sync";
  const lead = "Fetch monthly Clockify time entries via the Clockify API and import them into ReAI Timesheets by employee and project.";

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
        ${renderConnectPanel(session, { clientId: 'reai-clockify-web', clientName: 'ReAI Clockify Sync (Web)' })}
        ${reaiCard({
          eyebrow: 'CONNECT CLOCKIFY',
          title: 'Load Clockify time entries',
          body: html`<p class="muted-note">Generate an API key in Clockify under your profile → Preferences → Advanced → Manage API keys. The integration reads your own finished time entries in the active workspace.</p>
            <form class="stack" hx-post="${basePath}/preview" hx-target="#tm-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="tm-key">Clockify API key</label><input id="tm-key" name="apiKey" type="password" autocomplete="off" required placeholder="Clockify X-Api-Key"></div>
                <div class="field"><label for="tm-region">Workspace data region</label><select id="tm-region" name="region"><option value="global">Global</option><option value="euc1">EU (Germany)</option><option value="use2">USA</option><option value="euw2">UK</option><option value="apse2">Australia</option></select></div>
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
      return htmlResponse(renderTimeTable({ rows: await fetchApi({ apiKey: String(form.get('apiKey') ?? ''), region: String(form.get('region') ?? 'global'), start: bounds.start, end: bounds.end }), employeeId, projectId }));
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
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Clockify error', body: err instanceof Error ? err.message : 'Import failed.' }));
  }
  return errorResponse('Unknown time tracking route.', 404);
}
