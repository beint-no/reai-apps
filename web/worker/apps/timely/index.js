// @ts-check
import { fetchJson, isoDate } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiRequest } from '../../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/**
 * @typedef {{ id: string, date: string, hours: number, note: string, project: string, userName: string, email: string }} TimelyRow
 * @typedef {{ id: number, name: string, email?: string | null }} ReaiEmployee
 * @typedef {{ id: number, name: string, archived?: boolean }} ReaiProject
 */

const BRAND = 'Timely';
const TITLE = 'Timely Timesheet Sync';
const LEAD = 'Fetch logged Timely hours for a period with your own Timely OAuth app and post them to ReAI Timesheets by employee and project.';
const API = 'https://api.timelyapp.com';
const PER_PAGE = 100;
const MAX_PAGES = 50;

/**
 * Exchanges an authorization code (or uses a given access token) and fetches logged hours.
 * Docs: https://developer.timely.com/ (OpenAPI: GET /1.1/{account_id}/hours with since, upto, page, per_page;
 * POST /1.1/oauth/token with grant_type, client_id, client_secret, code, redirect_uri; `Authorization: Bearer <token>`),
 * setup: https://www.timely.com/help/handbook/tips-tricks/getting-started-with-timelys-api/
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<TimelyRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const accountId = (creds.accountId ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!/^[0-9]{1,12}$/.test(accountId)) throw new HttpError(400, 'Enter your numeric Timely account ID (the number in app.timelyapp.com/<id>/).');
  if (from > to) throw new HttpError(400, 'From date must be on or before to date.');
  let token = (creds.accessToken ?? '').trim();
  if (!token) {
    const clientId = (creds.clientId ?? '').trim();
    const clientSecret = (creds.clientSecret ?? '').trim();
    const code = (creds.code ?? '').trim();
    if (!clientId || !clientSecret || !code) throw new HttpError(400, 'Authorize with Timely first, then enter the application ID and secret.');
    const tokenRes = await fetchJson(`${API}/1.1/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, code, redirect_uri: creds.redirectUri ?? '' }),
    }, BRAND, fetchImpl);
    token = String(tokenRes?.access_token ?? '');
    if (!token) throw new HttpError(400, 'Timely did not return an access token. Authorize again; codes can be used once.');
  }
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  /** @type {TimelyRow[]} */
  const rows = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${API}/1.1/${accountId}/hours?since=${from}&upto=${to}&per_page=${PER_PAGE}&page=${page}&sort=day&order=asc`;
    const batch = await fetchJson(url, { headers }, BRAND, fetchImpl);
    const list = Array.isArray(batch) ? batch : [];
    for (const h of list) {
      if (!h || h.deleted || h.draft) continue;
      const d = h.duration ?? {};
      const hours = Number((typeof d.total_hours === 'number' ? d.total_hours : Number(d.total_minutes ?? 0) / 60).toFixed(2));
      rows.push({
        id: String(h.id ?? ''),
        date: isoDate(h.day, ''),
        hours,
        note: String(h.note ?? '').trim(),
        project: String(h.project?.name ?? '').trim(),
        userName: String(h.user?.name ?? '').trim(),
        email: String(h.user?.email ?? '').trim(),
      });
    }
    if (list.length < PER_PAGE) break;
  }
  const valid = rows.filter((r) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(r.date) && r.hours >= 0.01 && r.hours <= 24);
  if (valid.length === 0) throw new HttpError(400, `Timely returned 0 logged hours for ${from} to ${to}.`);
  return valid;
}

const SAMPLE_ROWS = /** @type {TimelyRow[]} */ ([
  { id: '1', date: '2026-10-12', hours: 3.5, note: 'Workshop with client', project: 'Website relaunch', userName: 'Ida Holm (Demo)', email: 'ida@demo.invalid' },
  { id: '2', date: '2026-10-13', hours: 6, note: 'Design and review', project: 'Website relaunch', userName: 'Ida Holm (Demo)', email: 'ida@demo.invalid' },
  { id: '3', date: '2026-10-13', hours: 1.25, note: 'Support ticket', project: 'Service agreement', userName: 'Ola Strand (Demo)', email: 'ola@demo.invalid' },
]);

/** @param {TimelyRow} r */
function commentFor(r) {
  return `[Timely] ${r.project ? `${r.project}: ` : ''}${r.note || 'Logged hours'}`.slice(0, 1000);
}

/** @param {{ rows: Array<{ row: TimelyRow, employeeId: number, projectId: number }>, isSample: boolean }} state */
function renderRows(state) {
  const total = state.rows.reduce((s, r) => s + r.row.hours, 0);
  const matched = state.rows.filter((r) => r.employeeId > 0);
  return reaiCard({
    eyebrow: 'TIMELY → REAI TIMESHEETS',
    title: `${state.rows.length} entries · ${total.toFixed(2)} h`,
    badge: state.isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${matched.length} matched`, tone: matched.length === state.rows.length ? 'success' : 'warn' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Entries', value: String(state.rows.length), detail: 'Logged duration, drafts excluded' })}
        ${reaiMetric({ label: 'People', value: String(new Set(state.rows.map((r) => r.row.userName)).size), detail: 'Matched to ReAI by email or name' })}
        ${reaiMetric({ label: 'Total hours', value: `${total.toFixed(2)} h`, detail: 'Projects matched by name' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Person</th><th>Project</th><th>Note</th><th class="num">Hours</th><th>Action</th></tr></thead>
        <tbody>${state.rows.map(({ row, employeeId, projectId }, idx) => html`<tr id="tly-row-${idx}">
          <td class="mono">${row.date}</td><td><strong>${row.userName || '—'}</strong></td><td>${row.project || '—'}${projectId > 0 ? html` <span class="muted-note">#${projectId}</span>` : ''}</td><td>${row.note || '—'}</td><td class="num">${row.hours.toFixed(2)}</td>
          <td>${state.isSample || employeeId <= 0
            ? html`<span class="muted-note">${state.isSample ? 'Demo only' : 'No matching ReAI employee'}</span>`
            : html`<form hx-post="/app/timely/import" hx-target="#tly-row-${idx}" hx-swap="outerHTML">
                <input type="hidden" name="employeeId" value="${employeeId}"><input type="hidden" name="projectId" value="${projectId}">
                <input type="hidden" name="date" value="${row.date}"><input type="hidden" name="hours" value="${row.hours.toFixed(2)}">
                <input type="hidden" name="person" value="${row.userName}"><input type="hidden" name="comment" value="${commentFor(row)}">
                <button type="submit" class="button primary">Post to ReAI</button>
              </form>`}</td>
        </tr>`)}</tbody>
      </table></div>
      ${!state.isSample && matched.length > 0
        ? html`<form class="stack-sm confirm-box" hx-post="/app/timely/import-all" hx-target="#tly-bulk" hx-swap="innerHTML">
            <input type="hidden" name="rowsJson" value="${JSON.stringify(matched.map(({ row, employeeId, projectId }) => ({ employeeId, projectId, date: row.date, hours: row.hours, comment: commentFor(row) })))}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I checked these hours. Post ${matched.length} matched entries to ReAI Timesheets.</label>
            <div><button type="submit" class="button primary">Post all matched entries</button></div>
          </form><div id="tly-bulk" class="stack-sm"></div>`
        : state.isSample ? reaiCallout({ tone: 'info', body: 'Sample entries loaded. Connect to ReAI and authorize Timely to post real hours.' }) : ''}
    `,
  });
}

/** @param {import('../../lib/types.d.ts').Env} env @param {{ accessToken: string, tenantId: number }} session @param {{ employeeId: number, projectId: number, date: string, hours: number, comment: string }} e */
async function postTimesheet(env, session, e) {
  if (e.employeeId <= 0 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(e.date) || !(e.hours >= 0.01 && e.hours <= 24)) throw new HttpError(400, 'Valid employee, date and hours (0.01 to 24) are required.');
  return /** @type {{ id: number }} */ (await reaiRequest(env, '/api/timesheets', {
    token: session.accessToken, tenantId: session.tenantId, method: 'POST',
    body: { employeeId: e.employeeId, date: e.date, hours: Number(e.hours.toFixed(2)), ...(e.projectId > 0 ? { projectId: e.projectId } : {}), ...(e.comment ? { comment: e.comment.slice(0, 1000) } : {}) },
  }));
}

/**
 * Handles /app/timely/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const basePath = '/app/timely';
  const redirectUri = `${url.origin}${basePath}/`;
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/authorize` && request.method === 'GET') {
    // Returns a plain link: CSP form-action would block a form redirect to Timely.
    const clientId = (url.searchParams.get('clientId') ?? '').trim();
    const accountId = (url.searchParams.get('accountId') ?? '').trim();
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(clientId)) return htmlResponse(reaiCallout({ tone: 'danger', body: 'Enter the Timely application ID first.' }));
    const target = new URL(`${API}/1.1/oauth/authorize`);
    target.searchParams.set('response_type', 'code');
    target.searchParams.set('redirect_uri', redirectUri);
    target.searchParams.set('client_id', clientId);
    if (/^[0-9]{1,12}$/.test(accountId)) target.searchParams.set('state', accountId);
    return htmlResponse(html`<a class="button primary" href="${target.toString()}">Continue to Timely ↗</a>`);
  }
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const code = (url.searchParams.get('code') ?? '').slice(0, 512);
    const stateAccount = /^[0-9]{1,12}$/.test(url.searchParams.get('state') ?? '') ? String(url.searchParams.get('state')) : '';
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro"><p class="eyebrow">TIME TRACKING & PROJECTS</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-timely-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${reaiCard({
          eyebrow: 'STEP 1 · AUTHORIZE TIMELY',
          title: code ? 'Timely authorization received' : 'Authorize your Timely OAuth app',
          badge: code ? reaiBadge({ text: 'Code ready', tone: 'success' }) : null,
          body: html`<p class="muted-note">As a Timely admin, open Settings → Devs, add an application and set its redirect URI to <code>${redirectUri}</code>. Enter the application ID here and approve access in Timely. The code it returns can be used once.</p>
            <form class="inline-row" hx-get="${basePath}/authorize" hx-target="#tly-auth-link" hx-swap="innerHTML">
              <div class="field"><label for="tly-client">Application ID</label><input id="tly-client" name="clientId" type="text" required autocomplete="off" placeholder="Timely application ID"></div>
              <div class="field"><label for="tly-acct-a">Account ID</label><input id="tly-acct-a" name="accountId" type="text" inputmode="numeric" pattern="[0-9]+" value="${stateAccount}" placeholder="From app.timelyapp.com/<id>/"></div>
              <button type="submit" class="button secondary">Create authorize link</button>
            </form><div id="tly-auth-link" class="inline-row"></div>`,
        })}
        ${reaiCard({
          eyebrow: 'STEP 2 · FETCH HOURS',
          title: 'Load Timely hours',
          body: html`<p class="muted-note">The secret and the token Timely returns are used for this single request and never stored. You can paste an existing access token instead of the code.</p>
            <form class="stack" hx-post="${basePath}/fetch-api" hx-target="#tly-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="tly-acct">Timely account ID</label><input id="tly-acct" name="accountId" type="text" inputmode="numeric" pattern="[0-9]+" required value="${stateAccount}"></div>
                <div class="field"><label for="tly-cid">Application ID</label><input id="tly-cid" name="clientId" type="text" autocomplete="off"></div>
                <div class="field"><label for="tly-secret">Secret</label><input id="tly-secret" name="clientSecret" type="password" autocomplete="off"></div>
                <div class="field"><label for="tly-code">Authorization code</label><input id="tly-code" name="code" type="text" autocomplete="off" value="${code}"></div>
                <div class="field"><label for="tly-token">Or access token</label><input id="tly-token" name="accessToken" type="password" autocomplete="off" placeholder="Optional"></div>
                <div class="field"><label for="tly-from">From date</label><input id="tly-from" name="fromDate" type="date" value="${today.slice(0, 7)}-01" required></div>
                <div class="field"><label for="tly-to">To date</label><input id="tly-to" name="toDate" type="date" value="${today}" required></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Fetch from Timely API</button>
                <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#tly-output" hx-swap="innerHTML">Load sample preview</button>
              </div>
            </form>`,
        })}
        <div id="tly-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${basePath}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) return htmlResponse(renderRows({ rows: SAMPLE_ROWS.map((row) => ({ row, employeeId: 1, projectId: 0 })), isSample: true }));
  try {
    const form = await request.formData();
    const session = await readSession(env, request);
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      creds.redirectUri = redirectUri;
      const rows = await fetchApi(creds);
      /** @type {ReaiEmployee[]} */ let employees = [];
      /** @type {ReaiProject[]} */ let projects = [];
      if (session && session.tenantId > 0) {
        const auth = { token: session.accessToken, tenantId: session.tenantId };
        const [eRes, pRes] = await Promise.all([reaiRequest(env, '/api/employees', auth), reaiAll(env, '/api/projects', auth)]);
        employees = Array.isArray(eRes) ? /** @type {ReaiEmployee[]} */ (eRes) : [];
        projects = /** @type {ReaiProject[]} */ (pRes).filter((p) => !p.archived);
      }
      const projByName = new Map(projects.map((p) => [p.name.trim().toLowerCase(), p.id]));
      return htmlResponse(renderRows({
        rows: rows.map((row) => ({
          row,
          employeeId: employees.find((e) => (row.email && String(e.email ?? '').toLowerCase() === row.email.toLowerCase()) || e.name.trim().toLowerCase() === row.userName.toLowerCase())?.id ?? 0,
          projectId: projByName.get(row.project.toLowerCase()) ?? 0,
        })),
        isSample: false,
      }));
    }
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    if (pathname === `${basePath}/import`) {
      const entry = { employeeId: Number(form.get('employeeId') ?? '0'), projectId: Number(form.get('projectId') ?? '0'), date: String(form.get('date') ?? '').trim(), hours: Number(form.get('hours') ?? '0'), comment: String(form.get('comment') ?? '').trim() };
      const created = await postTimesheet(env, session, entry);
      return htmlResponse(html`<tr><td class="mono">${entry.date}</td><td><strong>${String(form.get('person') ?? '')}</strong></td><td>${entry.projectId > 0 ? `Project #${entry.projectId}` : '—'}</td><td>${entry.comment}</td><td class="num">${entry.hours.toFixed(2)}</td><td>${reaiBadge({ text: `Logged #${created.id}`, tone: 'success' })}</td></tr>`);
    }
    if (pathname === `${basePath}/import-all`) {
      if (form.get('confirm') !== 'on') throw new HttpError(400, 'Confirm the hours first.');
      const entries = /** @type {Array<{ employeeId: number, projectId: number, date: string, hours: number, comment: string }>} */ (JSON.parse(String(form.get('rowsJson') ?? '[]'))).slice(0, PER_PAGE * MAX_PAGES);
      let ok = 0;
      /** @type {string[]} */ const failed = [];
      for (const e of entries) {
        try { await postTimesheet(env, session, e); ok++; } catch (err) { failed.push(`${e.date} employee #${e.employeeId}: ${err instanceof Error ? err.message : 'failed'}`); }
      }
      return htmlResponse(reaiCallout({ tone: failed.length ? 'warn' : 'success', title: `Posted ${ok} of ${entries.length} entries to ReAI Timesheets`, body: failed.length ? html`<ul>${failed.slice(0, 20).map((f) => html`<li>${f}</li>`)}</ul>` : 'Review them under Timesheets in ReAI before approval and invoicing.' }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
