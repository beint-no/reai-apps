// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiRequest } from '../lib/reai.js';
import { currentMonthIso, monthBounds } from '../lib/reconcile.js';
import { WFM_HR_API_UI, fetchWfmHoursApi, renderApiFetchCard } from '../lib/provider-api.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/**
 * @typedef {'toggl' | 'clockify' | 'harvest' | 'tidsbanken'} TimeSlug
 * @typedef {{ date: string, hours: number, description: string, externalProject: string }} TimeRow
 * @typedef {{ id: number, name: string }} SimpleOption
 */

/** @type {Record<TimeSlug, { brand: string, title: string, lead: string, hint: string, mode: 'api' | 'csv' }>} */
const TIME_CONFIGS = {
  toggl: {
    brand: 'Toggl Track',
    title: 'Toggl Track Timesheet Sync',
    lead: 'Pull worked hours from Toggl Track API v9 and post them straight into ReAI Timesheets for payroll and customer invoicing.',
    hint: 'Copy your Toggl Track API token from Profile Settings → API Token. Used only for this request and never stored.',
    mode: 'api',
  },
  clockify: {
    brand: 'Clockify',
    title: 'Clockify Timesheet Sync',
    lead: 'Fetch monthly Clockify time entries via the Clockify API and import them into ReAI Timesheets by employee and project.',
    hint: 'Copy your Clockify API key from Preferences → Advanced → API Key.',
    mode: 'api',
  },
  harvest: {
    brand: 'Harvest',
    title: 'Harvest Timesheet Sync',
    lead: 'Sync logged project hours from Harvest API v2 directly into ReAI Timesheets for invoicing and project tracking.',
    hint: 'Create a Personal Access Token in Harvest Developers (id.getharvest.com/developers) and copy both Token and Account ID.',
    mode: 'api',
  },
  tidsbanken: {
    brand: 'Tidsbanken & SmartDok',
    title: 'Tidsbanken / SmartDok Hours Import',
    lead: 'Import exported shift and project hours CSVs from Tidsbanken, SmartDok or Busy straight into ReAI Timesheets.',
    hint: 'Upload a CSV with Date (Dato), Hours (Timer) and optional Project / Description columns, or load the synthetic sample.',
    mode: 'csv',
  },
};

const SAMPLE_TIME_CSV = [
  'Dato;Timer;Prosjekt;Kommentar',
  '2026-10-12;7,50;Byggprosjekt Nord;Montering og kontroll',
  '2026-10-13;8,00;Byggprosjekt Nord;Ferdigstillelse etasje 2',
  '2026-10-14;4,25;Serviceavtale;Feilsøking anlegg',
].join('\n');

/**
 * Parses an ISO-8601 duration like PT1H30M0S into decimal hours.
 * @param {string} iso
 */
function parseIsoDurationHours(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) {
    return 0;
  }
  const h = Number(m[1] ?? '0');
  const min = Number(m[2] ?? '0');
  const sec = Number(m[3] ?? '0');
  return Number((h + min / 60 + sec / 3600).toFixed(2));
}

/**
 * @param {TimeSlug} slug
 * @param {FormData} form
 * @param {string} start
 * @param {string} end
 * @returns {Promise<TimeRow[]>}
 */
async function fetchTimeRows(slug, form, start, end) {
  if (slug === 'toggl') {
    const token = String(form.get('apiToken') ?? '').trim();
    if (!token) {
      throw new HttpError(400, 'Enter your Toggl Track API token.');
    }
    const url = new URL('https://api.track.toggl.com/api/v9/me/time_entries');
    url.searchParams.set('start_date', start);
    url.searchParams.set('end_date', end);
    const res = await fetch(url, {
      headers: { authorization: `Basic ${btoa(`${token}:api_token`)}`, accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      throw new HttpError(400, res.status === 403 ? 'Toggl rejected this API token.' : `Toggl returned HTTP ${res.status}.`);
    }
    const items = /** @type {Array<any>} */ (await res.json());
    return items
      .filter((e) => typeof e.duration === 'number' && e.duration > 0)
      .map((e) => ({
        date: String(e.start ?? '').slice(0, 10),
        hours: Math.min(24, Math.max(0.01, Number((e.duration / 3600).toFixed(2)))),
        description: String(e.description ?? 'Toggl entry').trim() || 'Toggl entry',
        externalProject: e.project_id ? `Project #${e.project_id}` : '—',
      }));
  }

  if (slug === 'clockify') {
    const apiKey = String(form.get('apiKey') ?? '').trim();
    if (!apiKey) {
      throw new HttpError(400, 'Enter your Clockify API key.');
    }
    const headers = { 'x-api-key': apiKey, accept: 'application/json' };
    const uRes = await fetch('https://api.clockify.me/api/v1/user', { headers, redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    if (!uRes.ok) {
      throw new HttpError(400, 'Clockify rejected this API key.');
    }
    const user = /** @type {{ id: string, activeWorkspace?: string, defaultWorkspace?: string }} */ (await uRes.json());
    const ws = user.activeWorkspace || user.defaultWorkspace;
    if (!ws) {
      throw new HttpError(400, 'No active Clockify workspace found.');
    }
    const url = new URL(`https://api.clockify.me/api/v1/workspaces/${encodeURIComponent(ws)}/user/${encodeURIComponent(user.id)}/time-entries`);
    url.searchParams.set('start', `${start}T00:00:00Z`);
    url.searchParams.set('end', `${end}T00:00:00Z`);
    url.searchParams.set('page-size', '100');
    const tRes = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    if (!tRes.ok) {
      throw new HttpError(400, `Clockify returned HTTP ${tRes.status}.`);
    }
    const entries = /** @type {Array<any>} */ (await tRes.json());
    return entries
      .map((e) => ({
        date: String(e.timeInterval?.start ?? '').slice(0, 10),
        hours: parseIsoDurationHours(String(e.timeInterval?.duration ?? '')),
        description: String(e.description ?? 'Clockify entry').trim() || 'Clockify entry',
        externalProject: e.projectId ? `Project ${String(e.projectId).slice(0, 8)}` : '—',
      }))
      .filter((r) => r.date && r.hours >= 0.01 && r.hours <= 24);
  }

  if (slug === 'harvest') {
    const token = String(form.get('apiToken') ?? '').trim();
    const accountId = String(form.get('accountId') ?? '').trim();
    if (!token || !accountId) {
      throw new HttpError(400, 'Enter both your Harvest Personal Access Token and Account ID.');
    }
    const lastDay = new Date(Date.parse(`${end}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const url = new URL('https://api.harvestapp.com/v2/time_entries');
    url.searchParams.set('from', start);
    url.searchParams.set('to', lastDay);
    url.searchParams.set('per_page', '100');
    const res = await fetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        'harvest-account-id': accountId,
        'user-agent': 'ReAI Apps (apps.reai.no)',
        accept: 'application/json',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      throw new HttpError(400, res.status === 401 ? 'Harvest rejected this token or Account ID.' : `Harvest returned HTTP ${res.status}.`);
    }
    const body = /** @type {{ time_entries?: Array<any> }} */ (await res.json());
    return (body.time_entries ?? [])
      .map((e) => ({
        date: String(e.spent_date ?? '').slice(0, 10),
        hours: Math.min(24, Math.max(0.01, Number(Number(e.hours ?? 0).toFixed(2)))),
        description: String(e.notes ?? e.task?.name ?? 'Harvest entry').trim() || 'Harvest entry',
        externalProject: String(e.project?.name ?? '—'),
      }))
      .filter((r) => r.date && r.hours >= 0.01);
  }

  // Tidsbanken / SmartDok CSV
  const file = form.get('file');
  let csvText = '';
  if (file && typeof file === 'object' && 'arrayBuffer' in file && file.size > 0) {
    csvText = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
  } else {
    throw new HttpError(400, 'Choose a Tidsbanken / SmartDok CSV file or click Load sample entries.');
  }
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const dateIdx = norm.findIndex((h) => h.includes('dato') || h.includes('date'));
  const hoursIdx = norm.findIndex((h) => h.includes('timer') || h.includes('hour') || h.includes('antall'));
  const projIdx = norm.findIndex((h) => h.includes('prosjekt') || h.includes('project'));
  const descIdx = norm.findIndex((h) => h.includes('kommentar') || h.includes('beskrivelse') || h.includes('note') || h.includes('desc'));
  if (dateIdx < 0 || hoursIdx < 0) {
    throw new HttpError(400, 'CSV must contain Date/Dato and Hours/Timer columns.');
  }
  return doc.rows
    .map((r) => {
      const rawH = (r[hoursIdx] ?? '').replace(',', '.').replace(/[^0-9.]/g, '');
      const hours = Number(Number(rawH).toFixed(2));
      return {
        date: (r[dateIdx] ?? '').trim().slice(0, 10),
        hours,
        externalProject: projIdx >= 0 ? (r[projIdx] ?? '').trim() || '—' : '—',
        description: descIdx >= 0 ? (r[descIdx] ?? '').trim() || 'Imported hours' : 'Imported hours',
      };
    })
    .filter((r) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(r.date) && r.hours >= 0.01 && r.hours <= 24);
}

/**
 * @param {TimeSlug} slug
 * @param {{ rows: TimeRow[], employeeId: number, projectId: number, isSample?: boolean }} state
 */
function renderTimeTable(slug, state) {
  const totalHours = state.rows.reduce((s, r) => s + r.hours, 0);
  const cfg = TIME_CONFIGS[slug];
  return html`
    ${reaiCard({
      eyebrow: `${cfg.brand.toUpperCase()} → REAI TIMESHEETS`,
      title: `${state.rows.length} time entries ready`,
      badge: state.isSample
        ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' })
        : reaiBadge({ text: `${totalHours.toFixed(2)} h total`, tone: 'success' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Entries', value: String(state.rows.length), detail: 'Validated 0.01–24.00 h/day' })}
          ${reaiMetric({ label: 'Total hours', value: `${totalHours.toFixed(2)} h`, detail: 'Ready for ReAI Timesheets' })}
          ${reaiMetric({ label: 'Target employee', value: state.employeeId > 0 ? `#${state.employeeId}` : 'Select above', detail: state.projectId > 0 ? `Project #${state.projectId}` : 'No project linked' })}
        </div>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Project</th>
                <th>Comment</th>
                <th class="num">Hours</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${state.rows.map(
                (r, idx) => html`<tr id="tm-row-${idx}">
                  <td class="mono">${r.date}</td>
                  <td>${r.externalProject}</td>
                  <td>${r.description}</td>
                  <td class="num">${r.hours.toFixed(2)}</td>
                  <td>
                    ${state.isSample || state.employeeId <= 0
                      ? html`<span class="muted-note">${state.isSample ? 'Demo only' : 'Select employee above'}</span>`
                      : html`<form hx-post="/app/${slug}/import" hx-target="#tm-row-${idx}" hx-swap="outerHTML">
                          <input type="hidden" name="employeeId" value="${state.employeeId}">
                          <input type="hidden" name="projectId" value="${state.projectId}">
                          <input type="hidden" name="date" value="${r.date}">
                          <input type="hidden" name="hours" value="${r.hours.toFixed(2)}">
                          <input type="hidden" name="comment" value="[${cfg.brand}] ${r.description}">
                          <button type="submit" class="button primary">Post to ReAI</button>
                        </form>`}
                  </td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>
      `,
    })}
  `;
}

/**
 * Handles /app/{toggl,clockify,harvest,tidsbanken}/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @param {TimeSlug} slug
 * @returns {Promise<Response>}
 */
export async function handleTimeTracking(request, env, slug) {
  const cfg = TIME_CONFIGS[slug];
  const { pathname } = new URL(request.url);
  const basePath = `/app/${slug}`;

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  }

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
      } catch {
        employees = [];
        projects = [];
      }
    }

    const defaultMonth = currentMonthIso();
    const body = html`
      <section class="app-intro">
        <p class="eyebrow">TIME TRACKING & PROJECTS</p>
        <h1>${cfg.title}</h1>
        <p class="lead">${cfg.lead}</p>
      </section>

      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${slug}-web`, clientName: `ReAI ${cfg.brand} Sync (Web)` })}
        ${slug === 'tidsbanken'
          ? renderApiFetchCard({
              basePath,
              targetId: 'tm-output',
              brand: WFM_HR_API_UI.tidsbanken.brand,
              hint: WFM_HR_API_UI.tidsbanken.hint,
              fields: WFM_HR_API_UI.tidsbanken.fields,
              sampleAction: true,
            })
          : ''}

        ${reaiCard({
          eyebrow: cfg.mode === 'csv' ? 'UPLOAD HOURS CSV' : `CONNECT ${cfg.brand.toUpperCase()}`,
          title: `Load ${cfg.brand} time entries`,
          body: html`
            <p class="muted-note">${cfg.hint}</p>
            <form class="stack" hx-post="${basePath}/preview" ${cfg.mode === 'csv' ? html`hx-encoding="multipart/form-data"` : ''} hx-target="#tm-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                ${slug === 'toggl'
                  ? html`<div class="field"><label for="tm-tok">Toggl Track API token</label><input id="tm-tok" name="apiToken" type="password" autocomplete="off" required placeholder="Toggl API token"></div>`
                  : slug === 'clockify'
                    ? html`<div class="field"><label for="tm-key">Clockify API key</label><input id="tm-key" name="apiKey" type="password" autocomplete="off" required placeholder="Clockify X-Api-Key"></div>`
                    : slug === 'harvest'
                      ? html`<div class="field"><label for="tm-tok">Harvest Personal Access Token</label><input id="tm-tok" name="apiToken" type="password" autocomplete="off" required placeholder="Harvest token"></div>
                             <div class="field"><label for="tm-acc">Harvest Account ID</label><input id="tm-acc" name="accountId" type="text" required placeholder="1234567"></div>`
                      : ''}
                ${cfg.mode === 'api'
                  ? html`<div class="field"><label for="tm-month">Month</label><input id="tm-month" name="month" type="text" pattern="[0-9]{4}-[0-9]{2}" value="${defaultMonth}" required></div>`
                  : ''}
                <div class="field">
                  <label for="tm-emp">ReAI employee</label>
                  <select id="tm-emp" name="employeeId">
                    <option value="0">${employees.length > 0 ? 'Select employee…' : 'Connect to ReAI to load employees'}</option>
                    ${employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}
                  </select>
                </div>
                <div class="field">
                  <label for="tm-proj">ReAI project (optional)</label>
                  <select id="tm-proj" name="projectId">
                    <option value="0">No project</option>
                    ${projects.map((p) => html`<option value="${p.id}">${p.name}</option>`)}
                  </select>
                </div>
              </div>
              ${cfg.mode === 'csv'
                ? reaiDropzone({
                    inputId: 'tm-csv',
                    name: 'file',
                    accept: '.csv,text/csv,text/plain',
                    label: 'Choose Tidsbanken / SmartDok CSV',
                    hint: 'Semicolon or comma separated CSV with Dato/Date and Timer/Hours columns.',
                  })
                : ''}
              <div class="inline-row">
                <button type="submit" class="button primary">Preview time entries</button>
                <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#tm-output" hx-swap="innerHTML">Load sample entries</button>
              </div>
            </form>
          `,
        })}

        <div id="tm-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: cfg.title, description: cfg.lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') {
    return errorResponse('Method not allowed.', 405);
  }
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  if (pathname === `${basePath}/sample`) {
    const doc = parseCsv(SAMPLE_TIME_CSV);
    const rows = doc.rows.map((r) => ({
      date: r[0] ?? '2026-10-12',
      hours: Number((r[1] ?? '7.5').replace(',', '.')),
      externalProject: r[2] ?? 'Client Project',
      description: r[3] ?? 'Billable consulting',
    }));
    return htmlResponse(renderTimeTable(slug, { rows, employeeId: 1, projectId: 10, isSample: true }));
  }

  try {
    const form = await request.formData();

    if (pathname === `${basePath}/fetch-api` && slug === 'tidsbanken') {
      /** @type {Record<string, string>} */
      const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      const rawRows = await fetchWfmHoursApi('tidsbanken', creds);
      const rows = rawRows.map((r) => ({ date: r.date, hours: r.hours, description: r.comment, externalProject: r.project }));
      return htmlResponse(renderTimeTable(slug, { rows, employeeId: 0, projectId: 0 }));
    }

    if (pathname === `${basePath}/preview`) {
      const employeeId = Number(form.get('employeeId') ?? '0');
      const projectId = Number(form.get('projectId') ?? '0');
      const bounds = cfg.mode === 'api' ? monthBounds(String(form.get('month') ?? currentMonthIso()).trim()) : { start: '', end: '' };
      const rows = await fetchTimeRows(slug, form, bounds.start, bounds.end);
      return htmlResponse(renderTimeTable(slug, { rows, employeeId, projectId }));
    }

    if (pathname === `${basePath}/import`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) {
        throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      }
      const employeeId = Number(form.get('employeeId') ?? '0');
      const projectId = Number(form.get('projectId') ?? '0');
      const date = String(form.get('date') ?? '').trim();
      const hours = Number(form.get('hours') ?? '0');
      const comment = String(form.get('comment') ?? '').trim().slice(0, 1000);
      if (employeeId <= 0 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || hours < 0.01 || hours > 24) {
        throw new HttpError(400, 'Valid employee, date and hours (0.01–24) are required.');
      }
      const created = /** @type {{ id: number }} */ (
        await reaiRequest(env, '/api/timesheets', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: {
            employeeId,
            date,
            hours: Number(hours.toFixed(2)),
            ...(projectId > 0 ? { projectId } : {}),
            ...(comment ? { comment } : {}),
          },
        })
      );
      return htmlResponse(html`<tr>
        <td class="mono">${date}</td>
        <td>${projectId > 0 ? `Project #${projectId}` : '—'}</td>
        <td>${comment}</td>
        <td class="num">${hours.toFixed(2)}</td>
        <td>${reaiBadge({ text: `Logged #${created.id}`, tone: 'success' })}</td>
      </tr>`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : `${cfg.brand} import failed.`;
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${cfg.brand} error`, body: msg }));
  }

  return errorResponse('Unknown time tracking route.', 404);
}
