// @ts-check
import { fetchJson, isoDate, num, pickList, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiRequest } from '../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/** @typedef {{ date: string, hours: number, project: string, comment: string }} HoursRow */
/** @typedef {{ id: number, name: string }} SimpleOpt */

const BRAND = "Visma Severa";
const TITLE = "Visma Severa Consulting Hours Sync";
const LEAD = "Import approved billable project hours from Visma Severa straight into ReAI Timesheets.";
const SAMPLE_CSV = "Dato;Timer;Prosjekt;Kommentar\n2026-10-12;7,50;Prosjekt ERP-r\u00e5dgivning;Workshop og spesifikasjon\n2026-10-13;8,00;Prosjekt ERP-r\u00e5dgivning;Teknisk leveranse";

/**
 * Fetches approved shift / project hours from Visma Severa REST API.
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<HoursRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!token) throw new HttpError(400, `Enter your ${BRAND} API token.`);
  const data = await fetchJson(`https://api.severa.visma.com/rest-api/v1.0/workhours?startDate=${from}&endDate=${to}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, 'Visma Severa', fetchImpl);
  const rows = pickList(data).map((r) => ({
    date: isoDate(r.date ?? r.eventDate ?? r.dato ?? r.startDateTime, to),
    hours: Number(num(r.hours ?? r.quantity ?? r.timer ?? r.durationHours ?? (num(r.minutes) / 60)).toFixed(2)),
    project: String(r.projectName ?? r.project?.name ?? r.departmentName ?? r.prosjekt ?? '—'),
    comment: String(r.comment ?? r.description ?? r.kommentar ?? `${BRAND} shift`),
  })).filter((x) => x.hours >= 0.01 && x.hours <= 24);
  if (rows.length === 0) throw new HttpError(400, `${BRAND} returned 0 hour entries for ${from}–${to}.`);
  return rows;
}

/** @param {string} csvText @returns {HoursRow[]} */
function parseHoursCsv(csvText) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const dIdx = norm.findIndex((h) => h.includes('dato') || h.includes('date'));
  const hIdx = norm.findIndex((h) => h.includes('timer') || h.includes('hour'));
  const pIdx = norm.findIndex((h) => h.includes('prosjekt') || h.includes('project') || h.includes('avdeling'));
  const cIdx = norm.findIndex((h) => h.includes('kommentar') || h.includes('note') || h.includes('desc'));
  if (dIdx < 0 || hIdx < 0) throw new HttpError(400, 'CSV must include Dato/Date and Timer/Hours columns.');
  return doc.rows.map((r) => ({
    date: (r[dIdx] ?? '').trim().slice(0, 10),
    hours: Number(num(r[hIdx]).toFixed(2)),
    project: pIdx >= 0 ? (r[pIdx] ?? '').trim() || '—' : '—',
    comment: cIdx >= 0 ? (r[cIdx] ?? '').trim() || 'Imported shift' : 'Imported shift',
  })).filter((x) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x.date) && x.hours >= 0.01 && x.hours <= 24);
}

/** @param {HoursRow[]} rows @param {number} empId @param {number} projId @param {boolean} isSample */
function renderHours(rows, empId, projId, isSample) {
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI TIMESHEETS`,
    title: `${rows.length} entries (${rows.reduce((s, r) => s + r.hours, 0).toFixed(2)} h)`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Ready', tone: 'success' }),
    body: html`<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Date</th><th>Project / Unit</th><th>Comment</th><th class="num">Hours</th><th>Action</th></tr></thead>
      <tbody>${rows.map((r, idx) => html`<tr id="wf-h-${idx}"><td class="mono">${r.date}</td><td>${r.project}</td><td>${r.comment}</td><td class="num">${r.hours.toFixed(2)}</td><td>${isSample || empId <= 0 ? html`<span class="muted-note">${isSample ? 'Demo only' : 'Select employee above'}</span>` : html`<form hx-post="/app/severa/import" hx-target="#wf-h-${idx}" hx-swap="outerHTML"><input type="hidden" name="employeeId" value="${empId}"><input type="hidden" name="projectId" value="${projId}"><input type="hidden" name="date" value="${r.date}"><input type="hidden" name="hours" value="${r.hours.toFixed(2)}"><input type="hidden" name="comment" value="[${BRAND}] ${r.comment}"><button type="submit" class="button primary">Post to ReAI</button></form>`}</td></tr>`)}</tbody>
    </table></div>`,
  });
}

/**
 * Handles /app/severa/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/severa';
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
        ${renderConnectPanel(session, { clientId: 'reai-severa-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({ basePath, targetId: 'wfm-output', brand: BRAND, hint: "Connect Visma Severa Public REST API v1.0 (GET /workhours) with your Bearer token.", fields: [{"name": "apiToken", "label": "Severa REST API Bearer token", "type": "password", "placeholder": "Bearer token"}, {"name": "fromDate", "label": "From date", "type": "date", "defaultValue": "$MONTH_START"}, {"name": "toDate", "label": "To date", "type": "date", "defaultValue": "$TODAY"}], sampleAction: true })}
        ${reaiCard({
          eyebrow: `CSV IMPORT · ${BRAND.toUpperCase()}`,
          title: `Or upload ${BRAND} hours CSV`,
          body: html`<form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#wfm-output" hx-swap="innerHTML">
            <div class="mapping-grid">
              <div class="field"><label for="wf-emp">ReAI employee</label><select id="wf-emp" name="employeeId"><option value="0">${employees.length > 0 ? 'Select employee…' : 'Connect to ReAI first'}</option>${employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}</select></div>
              <div class="field"><label for="wf-proj">ReAI project (optional)</label><select id="wf-proj" name="projectId"><option value="0">No project</option>${projects.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></div>
            </div>
            ${reaiDropzone({ inputId: 'wf-csv', name: 'file', accept: '.csv,text/csv,text/plain', label: `Choose ${BRAND} CSV`, hint: 'CSV with Dato, Timer, Prosjekt and Kommentar.' })}
            <div class="inline-row"><button type="submit" class="button primary">Preview CSV</button></div>
          </form>`,
        })}
        <div id="wfm-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${basePath}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) return htmlResponse(renderHours(parseHoursCsv(SAMPLE_CSV), 1, 0, true));
  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderHours(await fetchApi(creds), 0, 0, false));
    }
    if (pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a CSV file first.');
      return htmlResponse(renderHours(parseHoursCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer()))), Number(form.get('employeeId') ?? '0'), Number(form.get('projectId') ?? '0'), false));
    }
    if (pathname === `${basePath}/import`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const employeeId = Number(form.get('employeeId') ?? '0');
      const projectId = Number(form.get('projectId') ?? '0');
      const date = String(form.get('date') ?? '').slice(0, 10);
      const hours = Number(form.get('hours') ?? '0');
      const comment = String(form.get('comment') ?? BRAND).slice(0, 1000);
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/timesheets', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { employeeId, date, hours: Number(hours.toFixed(2)), ...(projectId > 0 ? { projectId } : {}), comment } }));
      return htmlResponse(html`<tr><td class="mono">${date}</td><td>${projectId > 0 ? `Project #${projectId}` : '—'}</td><td>${comment}</td><td class="num">${hours.toFixed(2)}</td><td>${reaiBadge({ text: `Logged #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
