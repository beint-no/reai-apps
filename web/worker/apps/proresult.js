// @ts-check
import { isoDate, num } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv, parseDay } from './hybel-journal.js';

/** @typedef {{ ref: string, date: string, customerName: string, project: string, employeeName: string, description: string, hours: number, amountExVat: number }} TradeRow */
/** @typedef {{ id: number, name: string }} SimpleRef */
/** @typedef {{ customers: SimpleRef[], employees: SimpleRef[], projects: SimpleRef[] }} ReaiLists */

const SLUG = 'proresult';
const BASE_PATH = `/app/${SLUG}`;
const BRAND = 'Proresult';
const TITLE = 'Proresult Hours Import';
const LEAD = 'Import a Proresult hour report, log the hours as ReAI timesheet rows and stage unbilled hours per project and month as draft ReAI orders.';
/** @type {TradeRow[]} */
const SAMPLE_ROWS = [
  {
    "ref": "PR-2026-11-03-1",
    "date": "2026-11-03",
    "customerName": "Sunnfjord Eigedom AS",
    "project": "1187 Nybygg lager Førde",
    "employeeName": "Ola Nordmann",
    "description": "Ordinær: Forskaling dekke",
    "hours": 7.5,
    "amountExVat": 0
  },
  {
    "ref": "PR-2026-11-03-2",
    "date": "2026-11-03",
    "customerName": "Sunnfjord Eigedom AS",
    "project": "1187 Nybygg lager Førde",
    "employeeName": "Kari Nordmann",
    "description": "Ordinær: Armering",
    "hours": 7.5,
    "amountExVat": 0
  },
  {
    "ref": "1187-2026-11",
    "date": "2026-11-03",
    "customerName": "Sunnfjord Eigedom AS",
    "project": "1187 Nybygg lager Førde",
    "employeeName": "—",
    "description": "Hours 2026-11: 1187 Nybygg lager Førde",
    "hours": 0,
    "amountExVat": 10500
  }
];

/**
 * Proresult has no customer API (support.proresult.no/integrasjoner-proresult), so this module reads the
 * documented "Timelister egendefinert" hour report (Rapporter → Timer, saved from Excel as CSV).
 * Documented columns used: Dato, Prosjekt, Prosjektnummer, Ansatt, Kunde, Kommentar, Timetype,
 * Timetype-pris, Fakturert. Source: https://support.proresult.no/rapporter-for-timer
 * The article does not name the hours column, so common headers (Timer, Sum timer, Ordinære timer, Antall) are accepted.
 */

/** @param {string} h */
const norm = (h) => h.toLowerCase().replace(/\s+/g, ' ').trim();

/** Norwegian number: "1 234,50", "1.234,50" or "7.5". @param {string | undefined} v */
function noNum(v) {
  const s = String(v ?? '').replace(/[\s ]/g, '').replace(/kr|nok/gi, '');
  if (!s) return 0;
  return num(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
}

/** Excel CSV dates may carry a time ("03.11.2026 00:00"). @param {string | undefined} v */
function reportDay(v) {
  const s = String(v ?? '').trim().split(/[ T]/)[0] ?? '';
  try { return parseDay(s); } catch { return ''; }
}

/**
 * Parses a Proresult "Timelister egendefinert" CSV into hour rows plus one draft-order row per project.
 * @param {string} csvText
 * @returns {TradeRow[]}
 */
export function parseExport(csvText) {
  const lines = csvText.replace(/^﻿/, '').split(/\r?\n/);
  const headerAt = lines.slice(0, 15).findIndex((l) => /(^|[;,"])\s*dato\s*("|[;,]|$)/i.test(l) && /ansatt|prosjekt/i.test(l));
  if (headerAt < 0) throw new HttpError(400, 'Could not find the header row. Include at least the Dato, Ansatt and Prosjekt columns.');
  const doc = parseCsv(lines.slice(headerAt).join('\n'));
  const h = doc.headers.map(norm);
  /** @param {string[]} names */
  const col = (...names) => { for (const n of names) { const i = h.indexOf(n); if (i >= 0) return i; } return -1; };
  const iDate = col('dato');
  const iHours = col('timer', 'sum timer', 'ordinære timer', 'antall timer', 'antall');
  const iProject = col('prosjekt');
  const iProjectNo = col('prosjektnummer', 'prosjektnr', 'prosjektnr.');
  const iEmployee = col('ansatt');
  const iCustomer = col('kunde');
  const iComment = col('kommentar');
  const iType = col('timetype');
  const iPrice = col('timetype-pris', 'timetypepris');
  const iBilled = col('fakturert');
  if (iDate < 0 || iHours < 0) throw new HttpError(400, 'The CSV needs a Dato column and an hours column (Timer, Sum timer or Ordinære timer).');
  /** @param {string[]} r @param {number} i */
  const cell = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
  /** @type {TradeRow[]} */
  const rows = [];
  /** @type {Map<string, TradeRow>} */
  const orders = new Map();
  doc.rows.forEach((r, idx) => {
    const date = reportDay(cell(r, iDate));
    const hours = Number(noNum(cell(r, iHours)).toFixed(2));
    if (!date || hours <= 0 || hours > 24) return;
    const projectNo = cell(r, iProjectNo);
    const project = [projectNo, cell(r, iProject)].filter(Boolean).join(' ') || '—';
    const customerName = cell(r, iCustomer) || '—';
    const type = cell(r, iType);
    rows.push({
      ref: `PR-${date}-${idx + 1}`,
      date,
      customerName,
      project,
      employeeName: cell(r, iEmployee) || '—',
      description: [type, cell(r, iComment)].filter(Boolean).join(': ') || `${BRAND} hours`,
      hours,
      amountExVat: 0,
    });
    const billed = /^(ja|yes|x|1|true)$/i.test(cell(r, iBilled));
    const amount = hours * noNum(cell(r, iPrice));
    if (billed || amount <= 0) return;
    const ref = `${projectNo || cell(r, iProject) || 'uten-prosjekt'}-${date.slice(0, 7)}`;
    const existing = orders.get(ref);
    if (existing) {
      existing.amountExVat = Number((existing.amountExVat + amount).toFixed(2));
      if (date > existing.date) existing.date = date;
    } else {
      orders.set(ref, { ref, date, customerName, project, employeeName: '—', description: `Hours ${date.slice(0, 7)}: ${project}`, hours: 0, amountExVat: Number(amount.toFixed(2)) });
    }
  });
  rows.push(...orders.values());
  if (rows.length === 0) throw new HttpError(400, 'No rows with a valid Dato and hours were found.');
  return rows;
}

/**
 * Loads the ReAI customers, employees and active projects used for mapping.
 * @param {import('../lib/types.d.ts').Env} env
 * @param {import('../lib/types.d.ts').SessionData | null} session
 * @returns {Promise<ReaiLists>}
 */
async function loadReaiLists(env, session) {
  if (!session || session.tenantId <= 0) return { customers: [], employees: [], projects: [] };
  const auth = { token: session.accessToken, tenantId: session.tenantId };
  const [c, e, p] = await Promise.all([
    reaiAll(env, '/api/customers', { ...auth, query: { archived: 'false' } }).catch(() => []),
    reaiRequest(env, '/api/employees', auth).catch(() => []),
    reaiAll(env, '/api/projects', { ...auth, query: { archived: 'false' } }).catch(() => []),
  ]);
  return {
    customers: /** @type {SimpleRef[]} */ (c),
    employees: Array.isArray(e) ? /** @type {SimpleRef[]} */ (e) : [],
    projects: /** @type {SimpleRef[]} */ (p),
  };
}

/** @param {string} s */
const key = (s) => s.trim().toLowerCase();

/** @param {{ rows: TradeRow[], lists: ReaiLists, defaultCustomerId: number, defaultEmployeeId: number, projectId: number, isSample?: boolean }} state */
function renderPreview(state) {
  const customerByName = new Map(state.lists.customers.map((c) => [key(c.name), c.id]));
  const employeeByName = new Map(state.lists.employees.map((e) => [key(e.name), e.id]));
  const totalHours = state.rows.reduce((s, r) => s + r.hours, 0);
  const totalAmt = state.rows.reduce((s, r) => s + r.amountExVat, 0);
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI TIMESHEETS AND DRAFT ORDERS`,
    title: `${state.rows.length} rows parsed`,
    badge: state.isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Review before staging', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Rows', value: String(state.rows.length), detail: 'Each row is staged only when you click it' })}
        ${reaiMetric({ label: 'Hours', value: `${totalHours.toFixed(2)} h`, detail: 'Logged as ReAI timesheet rows' })}
        ${reaiMetric({ label: 'Invoice basis ex. VAT', value: `${formatMinor(Math.round(totalAmt * 100))} NOK`, detail: 'Staged as ReAI draft orders' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Ref</th><th>Date</th><th>Customer / project</th><th>Employee</th><th class="num">Hours</th><th class="num">Ex. VAT</th><th>Action</th></tr></thead>
        <tbody>${state.rows.map((row, idx) => {
          const cid = customerByName.get(key(row.customerName)) ?? state.defaultCustomerId;
          const eid = employeeByName.get(key(row.employeeName)) ?? state.defaultEmployeeId;
          return html`<tr id="${SLUG}-r-${idx}">
            <td class="mono">${row.ref}</td><td class="mono">${row.date}</td>
            <td><strong>${row.customerName}</strong><br><span class="muted-note">${row.project} · ${row.description}</span></td>
            <td>${row.employeeName}</td>
            <td class="num">${row.hours.toFixed(2)}</td><td class="num">${formatMinor(Math.round(row.amountExVat * 100))}</td>
            <td>${state.isSample
              ? html`<span class="muted-note">Demo only</span>`
              : html`<div class="inline-row">
                  ${row.amountExVat > 0 && cid > 0 ? html`<form hx-post="${BASE_PATH}/create-order" hx-target="#${SLUG}-r-${idx}" hx-swap="outerHTML"><input type="hidden" name="ref" value="${row.ref}"><input type="hidden" name="date" value="${row.date}"><input type="hidden" name="description" value="${row.description}"><input type="hidden" name="amount" value="${row.amountExVat.toFixed(2)}"><input type="hidden" name="customerId" value="${cid}"><input type="hidden" name="projectId" value="${state.projectId}"><button type="submit" class="button primary">Stage draft order</button></form>` : ''}
                  ${row.hours > 0 && eid > 0 ? html`<form hx-post="${BASE_PATH}/log-hours" hx-target="#${SLUG}-r-${idx}" hx-swap="outerHTML"><input type="hidden" name="date" value="${row.date}"><input type="hidden" name="hours" value="${row.hours.toFixed(2)}"><input type="hidden" name="description" value="[${BRAND} ${row.ref}] ${row.description}"><input type="hidden" name="employeeId" value="${eid}"><input type="hidden" name="projectId" value="${state.projectId}"><button type="submit" class="button secondary">Log hours</button></form>` : ''}
                  ${(row.amountExVat <= 0 || cid <= 0) && (row.hours <= 0 || eid <= 0) ? html`<span class="muted-note">Choose a ReAI customer or employee above</span>` : ''}
                </div>`}</td>
          </tr>`;
        })}</tbody>
      </table></div>
    `,
  });
}

/** @param {ReaiLists} lists */
function renderMappingFields(lists) {
  return html`<div class="mapping-grid">
    <div class="field"><label for="${SLUG}-cust">Fallback ReAI customer</label><select id="${SLUG}-cust" name="defaultCustomerId"><option value="0">${lists.customers.length > 0 ? 'Match by name or choose…' : 'Connect to ReAI first'}</option>${lists.customers.slice(0, 500).map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select></div>
    <div class="field"><label for="${SLUG}-emp">Fallback ReAI employee</label><select id="${SLUG}-emp" name="defaultEmployeeId"><option value="0">${lists.employees.length > 0 ? 'Match by name or choose…' : 'Connect to ReAI first'}</option>${lists.employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}</select></div>
    <div class="field"><label for="${SLUG}-proj">ReAI project (optional)</label><select id="${SLUG}-proj" name="projectId"><option value="0">No project</option>${lists.projects.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></div>
  </div>`;
}

/**
 * Handles /app/proresult/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE_PATH && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE_PATH}/`, request.url), 301);
  if (pathname === `${BASE_PATH}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const lists = await loadReaiLists(env, session);
    const body = html`
      <section class="app-intro"><p class="eyebrow">CONSTRUCTION, CRAFTS & FIELD SERVICE</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${SLUG}-web`, clientName: `ReAI ${BRAND} (Web)` })}
        ${reaiCard({
          eyebrow: `CSV IMPORT · ${BRAND.toUpperCase()}`,
          title: `Upload a ${BRAND} hour report`,
          body: html`<p class="muted-note">In Proresult open Rapporter → Timer → Timelister egendefinert, choose the columns Dato, Prosjektnummer, Prosjekt, Kunde, Ansatt, Timetype, Timetype-pris, Kommentar and Fakturert, export to Excel and save the sheet as CSV. The file is read for this preview only and never stored.</p>
            <form class="stack" hx-post="${BASE_PATH}/preview" hx-encoding="multipart/form-data" hx-target="#${SLUG}-output" hx-swap="innerHTML">
              ${renderMappingFields(lists)}
              ${reaiDropzone({ inputId: `${SLUG}-csv`, name: 'file', accept: '.csv,text/csv,text/plain', label: `Choose ${BRAND} CSV`, hint: 'CSV saved from the Timelister egendefinert report (semicolon or comma separated).' })}
              <div class="inline-row">
                <button type="submit" class="button primary">Preview CSV</button>
                <button type="button" class="button secondary" hx-post="${BASE_PATH}/sample" hx-target="#${SLUG}-output" hx-swap="innerHTML">Load sample preview</button>
              </div>
            </form>`,
        })}
        <div id="${SLUG}-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE_PATH}/sample`) {
    return htmlResponse(renderPreview({ rows: SAMPLE_ROWS, lists: { customers: [], employees: [], projects: [] }, defaultCustomerId: 1, defaultEmployeeId: 1, projectId: 0, isSample: true }));
  }

  try {
    const form = await request.formData();
    if (pathname === `${BASE_PATH}/preview`) {
      const file = form.get('file');
      if (!file || typeof file === 'string' || file.size === 0) throw new HttpError(400, 'Choose a CSV file first.');
      const rows = parseExport(decodeCsvBytes(new Uint8Array(await file.arrayBuffer())));
      const lists = await loadReaiLists(env, await readSession(env, request));
      return htmlResponse(renderPreview({ rows, lists, defaultCustomerId: Number(form.get('defaultCustomerId') ?? '0'), defaultEmployeeId: Number(form.get('defaultEmployeeId') ?? '0'), projectId: Number(form.get('projectId') ?? '0') }));
    }
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    const auth = { token: session.accessToken, tenantId: session.tenantId };
    const projectId = Number(form.get('projectId') ?? '0');
    if (pathname === `${BASE_PATH}/create-order`) {
      const ref = String(form.get('ref') ?? '').trim();
      const date = isoDate(form.get('date'));
      const description = String(form.get('description') ?? BRAND).trim().slice(0, 255) || `${BRAND} ${ref}`;
      const amount = Number(num(form.get('amount')).toFixed(2));
      const customerId = Number(form.get('customerId') ?? '0');
      if (!ref || amount <= 0 || customerId <= 0) throw new HttpError(400, 'A reference, a positive amount and a ReAI customer are required.');
      const externalReference = `${SLUG}-${ref}`.slice(0, 100);
      const existing = /** @type {{ items: Array<{ id: number }> }} */ (await reaiRequest(env, '/api/orders', { ...auth, query: { externalReference, pageSize: '1' } }));
      const found = existing.items[0];
      const created = found ?? /** @type {{ id: number }} */ (await reaiRequest(env, '/api/orders', { ...auth, method: 'POST', body: { customerId, currencyCode: 'NOK', daysUntilDue: 14, issueDate: date, orderDate: date, externalReference, comment: `${BRAND} ${ref}`, ...(projectId > 0 ? { projectId } : {}), orderLines: [{ itemName: description, quantity: 1, unitPrice: amount }] } }));
      const url = `${reaiOrigin(env)}/order/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(html`<tr><td class="mono">${ref}</td><td class="mono">${date}</td><td>${description}</td><td>—</td><td class="num">—</td><td class="num">${formatMinor(Math.round(amount * 100))}</td><td><a href="${url}" target="_blank" rel="noopener">${found ? 'Already staged' : 'Draft order'} #${created.id} ↗</a></td></tr>`);
    }
    if (pathname === `${BASE_PATH}/log-hours`) {
      const date = isoDate(form.get('date'));
      const hours = Number(num(form.get('hours')).toFixed(2));
      const employeeId = Number(form.get('employeeId') ?? '0');
      const comment = String(form.get('description') ?? BRAND).slice(0, 1000);
      if (employeeId <= 0 || hours < 0.01 || hours > 24) throw new HttpError(400, 'A ReAI employee and 0.01 to 24 hours are required.');
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/timesheets', { ...auth, method: 'POST', body: { employeeId, date, hours, ...(projectId > 0 ? { projectId } : {}), comment } }));
      return htmlResponse(html`<tr><td class="mono">—</td><td class="mono">${date}</td><td>${comment}</td><td>—</td><td class="num">${hours.toFixed(2)}</td><td class="num">—</td><td>${reaiBadge({ text: `Logged #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
