// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiRequest } from '../lib/reai.js';
import { WFM_HR_API_UI, fetchHumaEmployeesApi, fetchWfmHoursApi, renderApiFetchCard } from '../lib/provider-api.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';
import { verifiedNorwegianAccount } from './recman-core.js';

/**
 * @typedef {'planday' | 'tamigo' | 'huma' | 'busy' | 'milient'} WfmSlug
 * @typedef {{ date: string, hours: number, project: string, comment: string }} WfmHoursRow
 * @typedef {{ name: string, email: string, startDate: string, bank: string, percent: number }} HumaEmpRow
 * @typedef {{ id: number, name: string, email?: string | null }} SimpleOpt
 */

/** @type {Record<WfmSlug, { brand: string, title: string, lead: string, mode: 'hours' | 'employees', sampleCsv: string }>} */
const WFMS = {
  planday: {
    brand: 'Planday',
    title: 'Planday Shift & Hours Sync',
    lead: 'Import approved Planday shift schedules and worked hours directly into ReAI Timesheets for Norwegian payroll and project tracking.',
    mode: 'hours',
    sampleCsv: 'Dato;Timer;Prosjekt;Kommentar\n2026-10-14;7,50;Avdeling Sentrum;Dagvakt godkjent Planday\n2026-10-15;8,00;Avdeling Sentrum;Kveldsvakt godkjent Planday',
  },
  tamigo: {
    brand: 'Tamigo',
    title: 'Tamigo Workforce & Shift Sync',
    lead: 'Import approved Tamigo retail and service shift hours directly into ReAI Timesheets ready for monthly Norwegian payroll.',
    mode: 'hours',
    sampleCsv: 'Dato;Timer;Prosjekt;Kommentar\n2026-10-12;7,50;Butikk Bergen;Skift godkjent i Tamigo\n2026-10-13;6,00;Butikk Bergen;Helgeskift godkjent i Tamigo',
  },
  huma: {
    brand: 'Huma HR',
    title: 'Huma HR Employee Sync',
    lead: 'Sync employee onboarding records (name, email, start date, position % and verified Mod11 Norwegian bank account) from Huma HR directly into ReAI Employees.',
    mode: 'employees',
    sampleCsv: 'Navn;Epost;Startdato;Stillingsprosent;Kontonummer\nAstrid Lind (Demo);astrid@example.no;2026-11-01;100;12345678903\nJonas Berg (Demo);jonas@example.no;2026-11-15;80;',
  },
  busy: {
    brand: 'Busy',
    title: 'Busy Time & Project Sync',
    lead: 'Import approved billable hours and project notes from Busy straight into ReAI Timesheets without double entry.',
    mode: 'hours',
    sampleCsv: 'Dato;Timer;Prosjekt;Kommentar\n2026-10-15;6,50;Rådgivning Q4;Design og arkitekturworkshop\n2026-10-16;7,50;Rådgivning Q4;Implementering og test',
  },
  milient: {
    brand: 'Milient (Moment)',
    title: 'Milient / Moment Project Hours Sync',
    lead: 'Bridge Milient (formerly Moment) architecture, engineering and consulting project hours cleanly into ReAI Timesheets.',
    mode: 'hours',
    sampleCsv: 'Dato;Timer;Prosjekt;Kommentar\n2026-10-13;8,00;Prosjekt 402 · Bygg B;BIM-modellering og detaljprosjektering\n2026-10-14;7,50;Prosjekt 402 · Bygg B;Byggemøte og oppfølging',
  },
};

/** @param {string} csvText @returns {WfmHoursRow[]} */
function parseHoursCsv(csvText) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const dIdx = norm.findIndex((h) => h.includes('dato') || h.includes('date'));
  const hIdx = norm.findIndex((h) => h.includes('timer') || h.includes('hour'));
  const pIdx = norm.findIndex((h) => h.includes('prosjekt') || h.includes('project') || h.includes('avdeling'));
  const cIdx = norm.findIndex((h) => h.includes('kommentar') || h.includes('note') || h.includes('desc'));
  if (dIdx < 0 || hIdx < 0) throw new HttpError(400, 'CSV must include Dato/Date and Timer/Hours columns.');
  return doc.rows
    .map((r) => ({
      date: (r[dIdx] ?? '').trim().slice(0, 10),
      hours: Number(Number((r[hIdx] ?? '').replace(',', '.').replace(/[^0-9.]/g, '')).toFixed(2)),
      project: pIdx >= 0 ? (r[pIdx] ?? '').trim() || '—' : '—',
      comment: cIdx >= 0 ? (r[cIdx] ?? '').trim() || 'Imported shift' : 'Imported shift',
    }))
    .filter((x) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x.date) && x.hours >= 0.01 && x.hours <= 24);
}

/** @param {string} csvText @returns {HumaEmpRow[]} */
function parseHumaCsv(csvText) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const nIdx = norm.findIndex((h) => h.includes('navn') || h.includes('name'));
  const eIdx = norm.findIndex((h) => h.includes('epost') || h.includes('email'));
  const sIdx = norm.findIndex((h) => h.includes('start') || h.includes('dato'));
  const pctIdx = norm.findIndex((h) => h.includes('prosent') || h.includes('percent'));
  const bIdx = norm.findIndex((h) => h.includes('konto') || h.includes('bank'));
  if (nIdx < 0) throw new HttpError(400, 'CSV must include Navn/Name column.');
  return doc.rows
    .map((r) => ({
      name: (r[nIdx] ?? '').trim(),
      email: eIdx >= 0 ? (r[eIdx] ?? '').trim() : '',
      startDate: sIdx >= 0 && /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test((r[sIdx] ?? '').trim()) ? (r[sIdx] ?? '').trim().slice(0, 10) : new Date().toISOString().slice(0, 10),
      percent: pctIdx >= 0 ? Math.min(100, Math.max(1, Number((r[pctIdx] ?? '100').replace(',', '.')) || 100)) : 100,
      bank: bIdx >= 0 ? verifiedNorwegianAccount(r[bIdx] ?? '') : '',
    }))
    .filter((x) => x.name.length > 0);
}

/**
 * Handles /app/{planday,tamigo,huma,busy,milient}/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @param {WfmSlug} slug
 * @returns {Promise<Response>}
 */
export async function handleWorkforce(request, env, slug) {
  const cfg = WFMS[slug];
  const { pathname } = new URL(request.url);
  const basePath = `/app/${slug}`;

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  }
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    /** @type {SimpleOpt[]} */
    let employees = [];
    /** @type {SimpleOpt[]} */
    let projects = [];
    if (session && session.tenantId > 0) {
      try {
        const [e, p] = await Promise.all([
          reaiRequest(env, '/api/employees', { token: session.accessToken, tenantId: session.tenantId }).catch(() => []),
          reaiAll(env, '/api/projects', { token: session.accessToken, tenantId: session.tenantId }).catch(() => []),
        ]);
        employees = Array.isArray(e) ? /** @type {SimpleOpt[]} */ (e) : [];
        projects = /** @type {Array<SimpleOpt & { archived?: boolean }>} */ (p).filter((x) => !x.archived);
      } catch {
        // ignore until connected
      }
    }
    const body = html`
      <section class="app-intro">
        <p class="eyebrow">${cfg.mode === 'employees' ? 'HR & EMPLOYEE ONBOARDING' : 'WORKFORCE, SHIFTS & PROJECTS'}</p>
        <h1>${cfg.title}</h1>
        <p class="lead">${cfg.lead}</p>
      </section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${slug}-web`, clientName: `ReAI ${cfg.brand} (Web)` })}
        ${renderApiFetchCard({
          basePath,
          targetId: 'wfm-output',
          brand: WFM_HR_API_UI[slug].brand,
          hint: WFM_HR_API_UI[slug].hint,
          fields: WFM_HR_API_UI[slug].fields,
          sampleAction: true,
        })}
        ${reaiCard({
          eyebrow: `IMPORT FROM ${cfg.brand.toUpperCase()}`,
          title: cfg.mode === 'employees' ? 'Upload Huma employee CSV' : `Upload ${cfg.brand} hours CSV`,
          body: html`
            <form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#wfm-output" hx-swap="innerHTML">
              ${cfg.mode === 'hours'
                ? html`<div class="mapping-grid">
                    <div class="field"><label for="wf-emp">ReAI employee</label><select id="wf-emp" name="employeeId"><option value="0">${employees.length > 0 ? 'Select employee…' : 'Connect to ReAI first'}</option>${employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}</select></div>
                    <div class="field"><label for="wf-proj">ReAI project (optional)</label><select id="wf-proj" name="projectId"><option value="0">No project</option>${projects.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></div>
                  </div>`
                : ''}
              ${reaiDropzone({
                inputId: 'wf-csv',
                name: 'file',
                accept: '.csv,text/csv,text/plain',
                label: `Choose ${cfg.brand} CSV`,
                hint: cfg.mode === 'employees'
                  ? 'CSV with Navn/Name, Epost/Email, Startdato, Stillingsprosent, Kontonummer.'
                  : 'CSV with Dato/Date, Timer/Hours, Prosjekt/Avdeling and Kommentar.',
              })}
              <div class="inline-row">
                <button type="submit" class="button primary">Preview</button>
                <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#wfm-output" hx-swap="innerHTML">Load sample export</button>
              </div>
            </form>
          `,
        })}
        <div id="wfm-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: cfg.title, description: cfg.lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  /**
   * @param {WfmHoursRow[]} rows
   * @param {number} employeeId
   * @param {number} projectId
   * @param {boolean} isSample
   */
  const renderHours = (rows, employeeId, projectId, isSample) => {
    const total = rows.reduce((s, r) => s + r.hours, 0);
    return reaiCard({
      eyebrow: `${cfg.brand.toUpperCase()} → REAI TIMESHEETS`,
      title: `${rows.length} entries (${total.toFixed(2)} h)`,
      badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Ready', tone: 'success' }),
      body: html`<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Department / Project</th><th>Comment</th><th class="num">Hours</th><th>Action</th></tr></thead>
        <tbody>${rows.map(
          (r, idx) => html`<tr id="wf-h-${idx}">
            <td class="mono">${r.date}</td>
            <td>${r.project}</td>
            <td>${r.comment}</td>
            <td class="num">${r.hours.toFixed(2)}</td>
            <td>${isSample || employeeId <= 0
              ? html`<span class="muted-note">${isSample ? 'Demo only' : 'Select employee above'}</span>`
              : html`<form hx-post="${basePath}/import" hx-target="#wf-h-${idx}" hx-swap="outerHTML">
                  <input type="hidden" name="employeeId" value="${employeeId}">
                  <input type="hidden" name="projectId" value="${projectId}">
                  <input type="hidden" name="date" value="${r.date}">
                  <input type="hidden" name="hours" value="${r.hours.toFixed(2)}">
                  <input type="hidden" name="comment" value="[${cfg.brand}] ${r.comment}">
                  <button type="submit" class="button primary">Post to ReAI</button>
                </form>`}</td>
          </tr>`,
        )}</tbody>
      </table></div>`,
    });
  };

  /**
   * @param {Array<{ emp: HumaEmpRow, existsId: number | null }>} rows
   * @param {boolean} isSample
   */
  const renderEmployees = (rows, isSample) =>
    reaiCard({
      eyebrow: 'HUMA HR → REAI EMPLOYEES',
      title: `${rows.length} employees parsed`,
      badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${rows.filter((x) => !x.existsId).length} new`, tone: 'success' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Employees', value: String(rows.length), detail: 'Matched by email or name' })}
          ${reaiMetric({ label: 'Mod11 verified bank', value: String(rows.filter((x) => Boolean(x.emp.bank)).length), detail: 'Validated 11-digit NO account' })}
          ${reaiMetric({ label: 'Safe sync', value: 'No invites', detail: 'Does not send user invites or A-melding' })}
        </div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Name</th><th>Email</th><th>Start date</th><th>%</th><th>Bank</th><th>Action</th></tr></thead>
          <tbody>${rows.map(
            ({ emp, existsId }, idx) => html`<tr id="wf-e-${idx}">
              <td><strong>${emp.name}</strong></td>
              <td>${emp.email || '—'}</td>
              <td class="mono">${emp.startDate}</td>
              <td class="num">${emp.percent}%</td>
              <td class="mono">${emp.bank || '—'}</td>
              <td>${existsId || isSample
                ? html`<span class="muted-note">${existsId ? `In ReAI #${existsId}` : 'Demo only'}</span>`
                : html`<form hx-post="/app/huma/import" hx-target="#wf-e-${idx}" hx-swap="outerHTML">
                    <input type="hidden" name="name" value="${emp.name}">
                    <input type="hidden" name="email" value="${emp.email}">
                    <input type="hidden" name="startDate" value="${emp.startDate}">
                    <input type="hidden" name="percent" value="${emp.percent}">
                    <input type="hidden" name="bank" value="${emp.bank}">
                    <button type="submit" class="button primary">Create in ReAI</button>
                  </form>`}</td>
            </tr>`,
          )}</tbody>
        </table></div>
      `,
    });

  if (pathname === `${basePath}/sample`) {
    if (cfg.mode === 'employees') {
      return htmlResponse(renderEmployees(parseHumaCsv(cfg.sampleCsv).map((emp, i) => ({ emp, existsId: i === 0 ? 7 : null })), true));
    }
    return htmlResponse(renderHours(parseHoursCsv(cfg.sampleCsv), 1, 0, true));
  }

  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */
      const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      if (slug === 'huma') {
        const emps = await fetchHumaEmployeesApi(creds);
        return htmlResponse(renderEmployees(emps.map((emp) => ({ emp, existsId: null })), false));
      }
      const rows = await fetchWfmHoursApi(slug, creds);
      return htmlResponse(renderHours(rows, 0, 0, false));
    }
    if (pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a CSV file or load sample.');
      const csvText = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
      if (cfg.mode === 'employees') {
        const parsed = parseHumaCsv(csvText);
        const session = await readSession(env, request);
        /** @type {SimpleOpt[]} */
        let existing = [];
        if (session && session.tenantId > 0) {
          const e = await reaiRequest(env, '/api/employees', { token: session.accessToken, tenantId: session.tenantId }).catch(() => []);
          existing = Array.isArray(e) ? /** @type {SimpleOpt[]} */ (e) : [];
        }
        return htmlResponse(
          renderEmployees(
            parsed.map((emp) => ({
              emp,
              existsId: existing.find((x) => (emp.email && (x.email ?? '').toLowerCase() === emp.email.toLowerCase()) || x.name.toLowerCase() === emp.name.toLowerCase())?.id ?? null,
            })),
            false,
          ),
        );
      }
      return htmlResponse(renderHours(parseHoursCsv(csvText), Number(form.get('employeeId') ?? '0'), Number(form.get('projectId') ?? '0'), false));
    }

    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');

    if (pathname === `${basePath}/import`) {
      if (cfg.mode === 'employees') {
        const name = String(form.get('name') ?? '').trim().slice(0, 75);
        const email = String(form.get('email') ?? '').trim();
        const startDate = String(form.get('startDate') ?? '').trim();
        const percent = Number(form.get('percent') ?? '100');
        const bank = String(form.get('bank') ?? '').trim();
        const created = /** @type {{ id: number }} */ (
          await reaiRequest(env, '/api/employees', {
            token: session.accessToken,
            tenantId: session.tenantId,
            method: 'POST',
            body: {
              name,
              ...(email ? { email } : {}),
              dateOfEmployment: startDate,
              ...(bank ? { accountNumber: bank, bankCountryCode: 'NO' } : {}),
              employmentLines: [{ startDate, percentage: percent }],
            },
          })
        );
        return htmlResponse(html`<tr><td><strong>${name}</strong></td><td>${email || '—'}</td><td class="mono">${startDate}</td><td class="num">${percent}%</td><td class="mono">${bank || '—'}</td><td>${reaiBadge({ text: `Created #${created.id}`, tone: 'success' })}</td></tr>`);
      }
      const employeeId = Number(form.get('employeeId') ?? '0');
      const projectId = Number(form.get('projectId') ?? '0');
      const date = String(form.get('date') ?? '').trim();
      const hours = Number(form.get('hours') ?? '0');
      const comment = String(form.get('comment') ?? '').trim().slice(0, 1000);
      const created = /** @type {{ id: number }} */ (
        await reaiRequest(env, '/api/timesheets', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: { employeeId, date, hours: Number(hours.toFixed(2)), ...(projectId > 0 ? { projectId } : {}), comment },
        })
      );
      return htmlResponse(html`<tr><td class="mono">${date}</td><td>${projectId > 0 ? `Project #${projectId}` : '—'}</td><td>${comment}</td><td class="num">${hours.toFixed(2)}</td><td>${reaiBadge({ text: `Logged #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${cfg.brand} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }

  return errorResponse('Unknown workforce route.', 404);
}
