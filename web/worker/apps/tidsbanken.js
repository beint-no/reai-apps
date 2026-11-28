// @ts-check
import { fetchJson, isoDate, num, pickList, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiRequest } from '../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/**
 * @typedef {{ date: string, hours: number, description: string, externalProject: string }} TimeRow
 * @typedef {{ id: number, name: string }} SimpleOption
 */

const SAMPLE_TIME_CSV = [
  'Dato;Timer;Prosjekt;Kommentar',
  '2026-10-12;7,50;Byggprosjekt Nord;Montering og kontroll',
  '2026-10-13;8,00;Byggprosjekt Nord;Ferdigstillelse etasje 2',
  '2026-10-14;4,25;Serviceavtale;Feilsøking anlegg',
].join('\n');

/**
 * Fetches shift/project hours from official Tidsbanken API v3 (developer.tidsbanken.net).
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<Array<{ date: string, hours: number, project: string, comment: string }>>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const subKey = (creds.subscriptionKey ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!token) throw new HttpError(400, 'Enter your Tidsbanken tidsbanken-key.');
  if (!subKey) throw new HttpError(400, 'Enter your Tidsbanken Subscription-Key.');
  const url = `https://api.tidsbanken.net/api/v3/timelinje?fom=${from}&tom=${to}`;
  const data = await fetchJson(url, { headers: { 'subscription-key': subKey, 'tidsbanken-key': token, accept: 'application/json' } }, 'Tidsbanken', fetchImpl);
  const rows = pickList(data)
    .map((r) => {
      const hours = num(r.hours ?? r.quantity ?? r.timer ?? r.durationHours ?? num(r.minutes) / 60);
      return {
        date: isoDate(r.date ?? r.eventDate ?? r.dato ?? r.startDateTime, to),
        hours: Number(hours.toFixed(2)),
        project: String(r.projectName ?? r.project?.name ?? r.departmentName ?? r.prosjekt ?? '—'),
        comment: String(r.comment ?? r.description ?? r.kommentar ?? 'Tidsbanken shift'),
      };
    })
    .filter((x) => x.hours >= 0.01 && x.hours <= 24);
  if (rows.length === 0) throw new HttpError(400, `Tidsbanken returned 0 hour entries for ${from}–${to}.`);
  return rows;
}

/** @param {string} csvText @returns {TimeRow[]} */
function parseTimeCsv(csvText) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const dateIdx = norm.findIndex((h) => h.includes('dato') || h.includes('date'));
  const hoursIdx = norm.findIndex((h) => h.includes('timer') || h.includes('hour') || h.includes('antall'));
  const projIdx = norm.findIndex((h) => h.includes('prosjekt') || h.includes('project'));
  const descIdx = norm.findIndex((h) => h.includes('kommentar') || h.includes('beskrivelse') || h.includes('note') || h.includes('desc'));
  if (dateIdx < 0 || hoursIdx < 0) throw new HttpError(400, 'CSV must contain Date/Dato and Hours/Timer columns.');
  return doc.rows
    .map((r) => ({
      date: (r[dateIdx] ?? '').trim().slice(0, 10),
      hours: Number(Number((r[hoursIdx] ?? '').replace(',', '.').replace(/[^0-9.]/g, '')).toFixed(2)),
      externalProject: projIdx >= 0 ? (r[projIdx] ?? '').trim() || '—' : '—',
      description: descIdx >= 0 ? (r[descIdx] ?? '').trim() || 'Imported hours' : 'Imported hours',
    }))
    .filter((r) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(r.date) && r.hours >= 0.01 && r.hours <= 24);
}

/** @param {{ rows: TimeRow[], employeeId: number, projectId: number, isSample?: boolean }} state */
function renderTimeTable(state) {
  const totalHours = state.rows.reduce((s, r) => s + r.hours, 0);
  return reaiCard({
    eyebrow: 'TIDSBANKEN → REAI TIMESHEETS',
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
              : html`<form hx-post="/app/tidsbanken/import" hx-target="#tm-row-${idx}" hx-swap="outerHTML">
                  <input type="hidden" name="employeeId" value="${state.employeeId}"><input type="hidden" name="projectId" value="${state.projectId}">
                  <input type="hidden" name="date" value="${r.date}"><input type="hidden" name="hours" value="${r.hours.toFixed(2)}">
                  <input type="hidden" name="comment" value="[Tidsbanken] ${r.description}">
                  <button type="submit" class="button primary">Post to ReAI</button>
                </form>`}</td>
          </tr>`,
        )}</tbody>
      </table></div>
    `,
  });
}

/**
 * Handles /app/tidsbanken/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/tidsbanken';
  const title = 'Tidsbanken Hours Sync & Import';
  const lead = 'Connect Tidsbanken API v3 (or upload exported shift and project hours CSVs) to post worked hours straight into ReAI Timesheets.';

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
    const body = html`
      <section class="app-intro"><p class="eyebrow">TIME TRACKING & PROJECTS</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-tidsbanken-web', clientName: 'ReAI Tidsbanken Sync (Web)' })}
        ${renderApiFetchCard({
          basePath,
          targetId: 'tm-output',
          brand: 'Tidsbanken',
          hint: 'Connect official Tidsbanken API v3 (developer.tidsbanken.net) using your Subscription-Key and tidsbanken-key.',
          fields: [
            { name: 'subscriptionKey', label: 'Subscription-Key', type: 'password', placeholder: 'Ocp-Apim-Subscription-Key' },
            { name: 'apiToken', label: 'tidsbanken-key', type: 'password', placeholder: 'Company tidsbanken-key' },
            { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
            { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
          ],
          sampleAction: true,
        })}
        ${reaiCard({
          eyebrow: 'UPLOAD HOURS CSV',
          title: 'Upload Tidsbanken hours CSV',
          body: html`<form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#tm-output" hx-swap="innerHTML">
            <div class="mapping-grid">
              <div class="field"><label for="tm-emp">ReAI employee</label><select id="tm-emp" name="employeeId"><option value="0">${employees.length > 0 ? 'Select employee…' : 'Connect to ReAI to load employees'}</option>${employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}</select></div>
              <div class="field"><label for="tm-proj">ReAI project (optional)</label><select id="tm-proj" name="projectId"><option value="0">No project</option>${projects.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></div>
            </div>
            ${reaiDropzone({ inputId: 'tm-csv', name: 'file', accept: '.csv,text/csv,text/plain', label: 'Choose Tidsbanken CSV', hint: 'Semicolon or comma separated CSV with Dato/Date and Timer/Hours columns.' })}
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

  if (pathname === `${basePath}/sample`) return htmlResponse(renderTimeTable({ rows: parseTimeCsv(SAMPLE_TIME_CSV), employeeId: 1, projectId: 10, isSample: true }));

  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */
      const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      const rawRows = await fetchApi(creds);
      const rows = rawRows.map((r) => ({ date: r.date, hours: r.hours, description: r.comment, externalProject: r.project }));
      return htmlResponse(renderTimeTable({ rows, employeeId: 0, projectId: 0 }));
    }
    if (pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a Tidsbanken CSV file or click Load sample entries.');
      const employeeId = Number(form.get('employeeId') ?? '0');
      const projectId = Number(form.get('projectId') ?? '0');
      return htmlResponse(renderTimeTable({ rows: parseTimeCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer()))), employeeId, projectId }));
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
      const created = /** @type {{ id: number }} */ (
        await reaiRequest(env, '/api/timesheets', {
          token: session.accessToken, tenantId: session.tenantId, method: 'POST',
          body: { employeeId, date, hours: Number(hours.toFixed(2)), ...(projectId > 0 ? { projectId } : {}), ...(comment ? { comment } : {}) },
        })
      );
      return htmlResponse(html`<tr><td class="mono">${date}</td><td>${projectId > 0 ? `Project #${projectId}` : '—'}</td><td>${comment}</td><td class="num">${hours.toFixed(2)}</td><td>${reaiBadge({ text: `Logged #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Tidsbanken error', body: err instanceof Error ? err.message : 'Tidsbanken import failed.' }));
  }
  return errorResponse('Unknown Tidsbanken route.', 404);
}
