// @ts-check
import { fetchJson, isoDate } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiRequest } from '../../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/**
 * @typedef {{ shiftId: string, date: string, employeeName: string, email: string, department: string, hours: number, approved: boolean }} ShiftRow
 * @typedef {{ id: number, name: string, email?: string | null }} ReaiEmployee
 * @typedef {{ id: number, name: string, archived?: boolean }} ReaiProject
 */

const BRAND = 'Workfeed';
const TITLE = 'Workfeed Shift Hours';
const LEAD = 'Fetch worked Workfeed shifts for a period and post the hours to ReAI Timesheets per employee, as the basis for payroll and project billing.';
const API_BASE = 'https://europe-west1-production-eu-327a3.cloudfunctions.net/api';
const MAX_ROWS = 1000;

/** @param {string} iso @returns {string} Calendar day in Norwegian time. */
function osloDay(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
}

/** @param {string} day @param {number} offset */
function addDays(day, offset) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/**
 * Fetches shifts from the Workfeed open API.
 * Docs: https://docs.workfeed.io/ (Postman collection: GET /companies/{companyID}/shifts?startFrom&startTo,
 * GET /companies/{companyID}/employees, GET /companies/{companyID}/departments; header `Authorization: <API key>`),
 * key setup: https://help.workfeed.io/en/articles/15956343-how-to-get-access-to-our-api
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<ShiftRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const apiKey = (creds.apiKey ?? '').trim();
  const companyId = (creds.companyId ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  const approvedOnly = creds.approvedOnly === 'on' || creds.approvedOnly === 'true';
  if (!apiKey || !companyId) throw new HttpError(400, 'Enter your Workfeed API key and company ID.');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(companyId)) throw new HttpError(400, 'The Workfeed company ID contains unexpected characters.');
  if (from > to) throw new HttpError(400, 'From date must be on or before to date.');
  const init = { headers: { authorization: apiKey, accept: 'application/json' } };
  const base = `${API_BASE}/companies/${encodeURIComponent(companyId)}`;
  // Oslo is UTC+1 or UTC+2, so start one day early in UTC and filter on the local calendar day below.
  const shiftsUrl = `${base}/shifts?startFrom=${encodeURIComponent(`${addDays(from, -1)}T00:00:00.000Z`)}&startTo=${encodeURIComponent(`${addDays(to, 1)}T00:00:00.000Z`)}`;
  const [shifts, employees, departments] = await Promise.all([
    fetchJson(shiftsUrl, init, BRAND, fetchImpl),
    fetchJson(`${base}/employees`, init, BRAND, fetchImpl),
    fetchJson(`${base}/departments`, init, BRAND, fetchImpl),
  ]);
  /** @type {Map<string, { name: string, email: string }>} */
  const empById = new Map((Array.isArray(employees) ? employees : []).map((e) => [String(e.id), { name: [e.firstname, e.lastname].filter(Boolean).join(' ').trim(), email: String(e.email ?? '').trim() }]));
  /** @type {Map<string, string>} */
  const deptById = new Map((Array.isArray(departments) ? departments : []).map((d) => [String(d.id), String(d.name ?? '')]));
  const rows = (Array.isArray(shifts) ? shifts : [])
    .filter((s) => s && s.employeeID && (!approvedOnly || s.approval))
    .map((s) => {
      const ms = new Date(String(s.end)).getTime() - new Date(String(s.start)).getTime();
      const breakHours = Number(s.customBreak?.duration ?? 0) || 0;
      const emp = empById.get(String(s.employeeID));
      return {
        shiftId: String(s.id),
        date: osloDay(String(s.start)),
        employeeName: emp?.name || String(s.employeeID),
        email: emp?.email ?? '',
        department: deptById.get(String(s.departmentID)) ?? '',
        hours: Number((ms / 3_600_000 - breakHours).toFixed(2)),
        approved: Boolean(s.approval),
      };
    })
    .filter((r) => r.date >= from && r.date <= to && r.hours >= 0.01 && r.hours <= 24)
    .sort((a, b) => a.date.localeCompare(b.date) || a.employeeName.localeCompare(b.employeeName));
  if (rows.length === 0) throw new HttpError(400, `Workfeed returned 0 ${approvedOnly ? 'approved ' : ''}shifts with an employee for ${from} to ${to}.`);
  return rows.slice(0, MAX_ROWS);
}

const SAMPLE_ROWS = /** @type {ShiftRow[]} */ ([
  { shiftId: 'demo-1', date: '2026-10-12', employeeName: 'Freja Lindqvist (Demo)', email: 'freja@demo.invalid', department: 'Kitchen', hours: 7.5, approved: true },
  { shiftId: 'demo-2', date: '2026-10-12', employeeName: 'Mikkel Sorensen (Demo)', email: 'mikkel@demo.invalid', department: 'Bar', hours: 6, approved: true },
  { shiftId: 'demo-3', date: '2026-10-13', employeeName: 'Freja Lindqvist (Demo)', email: 'freja@demo.invalid', department: 'Kitchen', hours: 8.25, approved: true },
]);

/** @param {ShiftRow} row @param {ReaiEmployee[]} employees */
function matchEmployee(row, employees) {
  const email = row.email.toLowerCase();
  const name = row.employeeName.toLowerCase();
  return employees.find((e) => (email && String(e.email ?? '').toLowerCase() === email) || e.name.trim().toLowerCase() === name)?.id ?? 0;
}

/** @param {ShiftRow} r */
function commentFor(r) {
  return `[Workfeed] ${r.department ? `${r.department} · ` : ''}shift ${r.shiftId}`.slice(0, 1000);
}

/** @param {{ rows: Array<{ row: ShiftRow, employeeId: number }>, projectId: number, isSample: boolean }} state */
function renderShifts(state) {
  const total = state.rows.reduce((s, r) => s + r.row.hours, 0);
  const matched = state.rows.filter((r) => r.employeeId > 0);
  const people = new Set(state.rows.map((r) => r.row.employeeName)).size;
  return reaiCard({
    eyebrow: 'WORKFEED → REAI TIMESHEETS',
    title: `${state.rows.length} shifts · ${total.toFixed(2)} h`,
    badge: state.isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${matched.length} matched`, tone: matched.length === state.rows.length ? 'success' : 'warn' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Shifts', value: String(state.rows.length), detail: 'Shift length minus registered break' })}
        ${reaiMetric({ label: 'Employees', value: String(people), detail: 'Matched to ReAI by email or name' })}
        ${reaiMetric({ label: 'Total hours', value: `${total.toFixed(2)} h`, detail: state.projectId > 0 ? `Project #${state.projectId}` : 'No project linked' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Employee</th><th>Department</th><th class="num">Hours</th><th>Action</th></tr></thead>
        <tbody>${state.rows.map(({ row, employeeId }, idx) => html`<tr id="wfd-row-${idx}">
          <td class="mono">${row.date}</td><td><strong>${row.employeeName}</strong>${row.approved ? '' : html` ${reaiBadge({ text: 'Not approved', tone: 'warn' })}`}</td><td>${row.department || '—'}</td><td class="num">${row.hours.toFixed(2)}</td>
          <td>${state.isSample || employeeId <= 0
            ? html`<span class="muted-note">${state.isSample ? 'Demo only' : 'No matching ReAI employee'}</span>`
            : html`<form hx-post="/app/workfeed/import" hx-target="#wfd-row-${idx}" hx-swap="outerHTML">
                <input type="hidden" name="employeeId" value="${employeeId}"><input type="hidden" name="projectId" value="${state.projectId}">
                <input type="hidden" name="date" value="${row.date}"><input type="hidden" name="hours" value="${row.hours.toFixed(2)}">
                <input type="hidden" name="employeeName" value="${row.employeeName}"><input type="hidden" name="comment" value="${commentFor(row)}">
                <button type="submit" class="button primary">Post to ReAI</button>
              </form>`}</td>
        </tr>`)}</tbody>
      </table></div>
      ${!state.isSample && matched.length > 0
        ? html`<form class="stack-sm confirm-box" hx-post="/app/workfeed/import-all" hx-target="#wfd-bulk" hx-swap="innerHTML">
            <input type="hidden" name="projectId" value="${state.projectId}">
            <input type="hidden" name="rowsJson" value="${JSON.stringify(matched.map(({ row, employeeId }) => ({ employeeId, date: row.date, hours: row.hours, comment: commentFor(row) })))}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I checked these hours. Post ${matched.length} matched shifts to ReAI Timesheets.</label>
            <div><button type="submit" class="button primary">Post all matched shifts</button></div>
          </form><div id="wfd-bulk" class="stack-sm"></div>`
        : state.isSample ? reaiCallout({ tone: 'info', body: 'Sample shifts loaded. Connect to ReAI and fetch from Workfeed to post real hours.' }) : ''}
    `,
  });
}

/** @param {import('../../lib/types.d.ts').Env} env @param {{ accessToken: string, tenantId: number }} session @param {{ employeeId: number, date: string, hours: number, projectId: number, comment: string }} e */
async function postTimesheet(env, session, e) {
  if (e.employeeId <= 0 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(e.date) || !(e.hours >= 0.01 && e.hours <= 24)) throw new HttpError(400, 'Valid employee, date and hours (0.01 to 24) are required.');
  return /** @type {{ id: number }} */ (await reaiRequest(env, '/api/timesheets', {
    token: session.accessToken, tenantId: session.tenantId, method: 'POST',
    body: { employeeId: e.employeeId, date: e.date, hours: Number(e.hours.toFixed(2)), ...(e.projectId > 0 ? { projectId: e.projectId } : {}), ...(e.comment ? { comment: e.comment.slice(0, 1000) } : {}) },
  }));
}

/**
 * Handles /app/workfeed/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/workfeed';
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    /** @type {ReaiProject[]} */ let projects = [];
    if (session && session.tenantId > 0) {
      try { projects = /** @type {ReaiProject[]} */ (await reaiAll(env, '/api/projects', { token: session.accessToken, tenantId: session.tenantId })).filter((p) => !p.archived); } catch { projects = []; }
    }
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro"><p class="eyebrow">SHIFT PLANNING & PAYROLL BASIS</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-workfeed-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${reaiCard({
          eyebrow: 'LIVE WORKFEED API',
          title: 'Fetch shifts from Workfeed',
          body: html`<p class="muted-note">Create a key in Workfeed under Settings → Integrations → Workfeed API (Pro+ plan). Workfeed keys can also change data, so this page only reads shifts, employees and departments. The key is used for this single request and never stored.</p>
            <form class="stack" hx-post="${basePath}/fetch-api" hx-target="#wfd-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="wfd-key">Workfeed API key</label><input id="wfd-key" name="apiKey" type="password" autocomplete="off" required placeholder="Workfeed API key"></div>
                <div class="field"><label for="wfd-company">Workfeed company ID</label><input id="wfd-company" name="companyId" type="text" required placeholder="Company ID"></div>
                <div class="field"><label for="wfd-from">From date</label><input id="wfd-from" name="fromDate" type="date" value="${today.slice(0, 7)}-01" required></div>
                <div class="field"><label for="wfd-to">To date</label><input id="wfd-to" name="toDate" type="date" value="${today}" required></div>
                <div class="field"><label for="wfd-proj">ReAI project (optional)</label><select id="wfd-proj" name="projectId"><option value="0">No project</option>${projects.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></div>
              </div>
              <label class="check-row"><input type="checkbox" name="approvedOnly" checked> Approved shifts only (recommended for payroll)</label>
              <div class="inline-row">
                <button type="submit" class="button primary">Fetch from Workfeed API</button>
                <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#wfd-output" hx-swap="innerHTML">Load sample preview</button>
              </div>
            </form>`,
        })}
        <div id="wfd-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${basePath}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) return htmlResponse(renderShifts({ rows: SAMPLE_ROWS.map((row) => ({ row, employeeId: 1 })), projectId: 0, isSample: true }));
  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      const rows = await fetchApi(creds);
      const session = await readSession(env, request);
      /** @type {ReaiEmployee[]} */ let employees = [];
      if (session && session.tenantId > 0) {
        const res = await reaiRequest(env, '/api/employees', { token: session.accessToken, tenantId: session.tenantId });
        employees = Array.isArray(res) ? /** @type {ReaiEmployee[]} */ (res) : [];
      }
      return htmlResponse(renderShifts({ rows: rows.map((row) => ({ row, employeeId: matchEmployee(row, employees) })), projectId: Number(creds.projectId ?? '0') || 0, isSample: false }));
    }
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    if (pathname === `${basePath}/import`) {
      const entry = { employeeId: Number(form.get('employeeId') ?? '0'), date: String(form.get('date') ?? '').trim(), hours: Number(form.get('hours') ?? '0'), projectId: Number(form.get('projectId') ?? '0'), comment: String(form.get('comment') ?? '').trim() };
      const created = await postTimesheet(env, session, entry);
      return htmlResponse(html`<tr><td class="mono">${entry.date}</td><td><strong>${String(form.get('employeeName') ?? '')}</strong></td><td>${entry.comment}</td><td class="num">${entry.hours.toFixed(2)}</td><td>${reaiBadge({ text: `Logged #${created.id}`, tone: 'success' })}</td></tr>`);
    }
    if (pathname === `${basePath}/import-all`) {
      if (form.get('confirm') !== 'on') throw new HttpError(400, 'Confirm the hours first.');
      const projectId = Number(form.get('projectId') ?? '0');
      const entries = /** @type {Array<{ employeeId: number, date: string, hours: number, comment: string }>} */ (JSON.parse(String(form.get('rowsJson') ?? '[]'))).slice(0, MAX_ROWS);
      let ok = 0;
      /** @type {string[]} */ const failed = [];
      for (const e of entries) {
        try { await postTimesheet(env, session, { ...e, projectId }); ok++; } catch (err) { failed.push(`${e.date} employee #${e.employeeId}: ${err instanceof Error ? err.message : 'failed'}`); }
      }
      return htmlResponse(reaiCallout({ tone: failed.length ? 'warn' : 'success', title: `Posted ${ok} of ${entries.length} shifts to ReAI Timesheets`, body: failed.length ? html`<ul>${failed.slice(0, 20).map((f) => html`<li>${f}</li>`)}</ul>` : 'Review them under Timesheets in ReAI before approval and payroll.' }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
