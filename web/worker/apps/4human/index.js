// @ts-check
import { fetchJson, isoDate, num } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiRequest } from '../../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';
import { verifiedNorwegianAccount } from '../../lib/norway.js';

/**
 * @typedef {{ userId: string, name: string, email: string, phone: string, startDate: string, percent: number, employeeNumber: string, bank: string, nin: string, address: string, postalCode: string, city: string, status: string }} HrEmployee
 * @typedef {{ id: number, name: string, email?: string | null }} ReaiEmployee
 */

const BRAND = '4human';
const TITLE = '4human HRM Employee Sync';
const LEAD = 'Fetch employees from 4human HRM and create them in ReAI Employees with name, contact details, start date, position percentage and a verified Norwegian bank account.';
const API = 'https://api.hrm-4human.com';
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const BATCH = 25;
const SKIP_STATUSES = new Set(['former', 'vacant']);

/** @param {string} jwt @returns {string} The instanceId claim 4human requires as X-Api-Key. */
function instanceIdFromToken(jwt) {
  try {
    const part = jwt.split('.')[1] ?? '';
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')));
    return typeof json.instanceId === 'string' ? json.instanceId : '';
  } catch {
    return '';
  }
}

/**
 * GET with the exponential backoff 4human asks for on 429 (throttling active since 2026).
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 * @returns {Promise<any>}
 */
async function getWithBackoff(url, headers, fetchImpl) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    if (res.status === 429 && attempt < 3) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(12, retryAfter) * 1000 : 500 * 2 ** attempt * (1 + Math.random() * 0.2);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (res.status === 429) throw new HttpError(429, '4human is throttling API calls. Wait a minute and fetch again.');
    if (res.status === 401 || res.status === 403) throw new HttpError(400, '4human rejected the token. Check the Client ID and Secret Key, and ask 4human support to confirm API access.');
    if (!res.ok) throw new HttpError(400, `4human API returned HTTP ${res.status}.`);
    return res.json();
  }
}

/**
 * Fetches employments and, for one batch of employees, user profiles from the 4human HRM REST API.
 * Docs: https://4human-api-doc-prod.s3.eu-west-1.amazonaws.com/prod/index.html (POST /token client_credentials,
 * GET /personnel/employments?limit&page, GET /personnel/profiles/{userId}; `Authorization: Bearer <token>`),
 * access: https://support.4humanhrm.no/hc/no/articles/4405979813522-Tilgang-til-data-via-REST-API-i-V8,
 * X-Api-Key header: https://support.4humanhrm.no/hc/no/articles/34974007319442
 * Profiles are one call per employee, so they are read for BATCH employees per request (sorted by name, from `offset`).
 * @param {Record<string, string>} creds `clientId`, `clientSecret`, optional `offset`
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<{ rows: HrEmployee[], total: number, offset: number }>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const clientId = (creds.clientId ?? '').trim();
  const clientSecret = (creds.clientSecret ?? '').trim();
  if (!clientId || !clientSecret) throw new HttpError(400, 'Enter the 4human Client ID and Secret Key.');
  const tokenRes = await fetchJson(`${API}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
  }, BRAND, fetchImpl);
  const token = String(tokenRes?.access_token ?? '');
  if (!token) throw new HttpError(400, '4human did not return an access token.');
  const instanceId = instanceIdFromToken(token);
  /** @type {Record<string, string>} */
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json', ...(instanceId ? { 'x-api-key': instanceId } : {}) };

  /** @type {any[]} */
  const employments = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await getWithBackoff(`${API}/personnel/employments?limit=${PAGE_SIZE}&page=${page}`, headers, fetchImpl);
    const items = Array.isArray(res?.items) ? res.items : [];
    employments.push(...items);
    if (items.length === 0 || page >= Number(res?.pages ?? page)) break;
  }

  /** @type {Map<string, any>} */
  const byUser = new Map();
  for (const e of employments) {
    if (!e?.userId || SKIP_STATUSES.has(String(e.employmentCalculatedStatus ?? ''))) continue;
    const prev = byUser.get(String(e.userId));
    if (!prev || (e.isLastEmployment && !prev.isLastEmployment)) byUser.set(String(e.userId), e);
  }
  const all = [...byUser.values()].sort((a, b) => String(a.userName ?? '').localeCompare(String(b.userName ?? '')) || String(a.userId).localeCompare(String(b.userId)));
  const total = all.length;
  const offset = Math.max(0, Math.min(Math.floor(Number(creds.offset ?? 0)) || 0, Math.max(0, total - 1)));
  const selected = all.slice(offset, offset + BATCH);

  /** @type {Map<string, any>} */
  const profiles = new Map();
  const queue = selected.map((e) => String(e.userId));
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      try { profiles.set(id, await getWithBackoff(`${API}/personnel/profiles/${encodeURIComponent(id)}`, headers, fetchImpl)); } catch (err) {
        if (err instanceof HttpError && err.status === 429) throw err;
        /* other profile failures leave the details empty */
      }
    }
  }));

  const rows = selected.map((e) => {
    const p = profiles.get(String(e.userId)) ?? {};
    const name = [p.firstName, p.surname].filter(Boolean).join(' ').trim() || String(e.userName ?? '').trim();
    const fte = num(e.presentFteFactor ?? e.fteFactor ?? 1) || 1;
    const nin = p.personalIdentification?.idType === 'ssn' ? String(p.personalIdentification?.idNumber ?? '').replace(/\D/g, '') : '';
    return {
      userId: String(e.userId),
      name,
      email: String(e.emailWork || p.emailPrivate || '').trim(),
      phone: String(e.phoneNumberWork || p.phoneNumberPrivate || '').trim(),
      startDate: isoDate(e.startDate),
      percent: Math.min(100, Math.max(1, Math.round(fte * 10000) / 100)),
      employeeNumber: String(e.number || p.instanceEmployeeId || '').trim(),
      bank: verifiedNorwegianAccount(String(p.paymentDetails?.accountNumber ?? '')),
      nin: /^[0-9]{11}$/.test(nin) ? nin : '',
      address: String(p.addressLine1 ?? '').trim(),
      postalCode: String(p.zipCode ?? '').trim(),
      city: String(p.city ?? '').trim(),
      status: String(e.employmentCalculatedStatus ?? ''),
    };
  }).filter((r) => r.name.length > 0);
  if (rows.length === 0) throw new HttpError(400, '4human returned no current employees.');
  return { rows, total, offset };
}

const SAMPLE_ROWS = /** @type {HrEmployee[]} */ ([
  { userId: 'demo-1', name: 'Kari Nordmann (Demo)', email: 'post+kari@aiak.no', phone: '40000001', startDate: '2026-11-01', percent: 100, employeeNumber: '101', bank: '86011117947', nin: '', address: 'Storgata 1', postalCode: '0155', city: 'Oslo', status: 'active' },
  { userId: 'demo-2', name: 'Per Hansen (Demo)', email: 'post+per@aiak.no', phone: '', startDate: '2026-11-15', percent: 60, employeeNumber: '102', bank: '', nin: '', address: '', postalCode: '', city: '', status: 'pending' },
]);

/** @param {Array<{ emp: HrEmployee, existsId: number }>} rows @param {boolean} isSample @param {{ total: number, offset: number }} [batch] */
function renderEmployees(rows, isSample, batch) {
  const nextOffset = batch ? batch.offset + BATCH : 0;
  const fresh = rows.filter((r) => r.existsId <= 0);
  return reaiCard({
    eyebrow: '4HUMAN → REAI EMPLOYEES',
    title: batch && batch.total > rows.length ? `Employees ${batch.offset + 1} to ${batch.offset + rows.length} of ${batch.total}` : `${rows.length} employees`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${fresh.length} new`, tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Employees', value: String(rows.length), detail: 'Former and vacant positions skipped' })}
        ${reaiMetric({ label: 'Verified bank accounts', value: String(rows.filter((r) => r.emp.bank).length), detail: 'MOD11 checked Norwegian account' })}
        ${reaiMetric({ label: 'Safe sync', value: 'No invites', detail: 'No user, A-melding or payroll is created' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Name</th><th>Email</th><th>No.</th><th>Start date</th><th class="num">%</th><th>Bank</th><th>Action</th></tr></thead>
        <tbody>${rows.map(({ emp, existsId }, idx) => html`<tr id="fh-e-${idx}">
          <td><strong>${emp.name}</strong>${emp.status && emp.status !== 'active' ? html` ${reaiBadge({ text: emp.status, tone: 'warn' })}` : ''}</td><td>${emp.email || '—'}</td><td class="mono">${emp.employeeNumber || '—'}</td><td class="mono">${emp.startDate}</td><td class="num">${emp.percent}</td><td class="mono">${emp.bank || '—'}</td>
          <td>${existsId > 0 || isSample
            ? html`<span class="muted-note">${existsId > 0 && !isSample ? `In ReAI #${existsId}` : 'Demo only'}</span>`
            : html`<form hx-post="/app/4human/import" hx-target="#fh-e-${idx}" hx-swap="outerHTML">
                <input type="hidden" name="employeeJson" value="${JSON.stringify(emp)}">
                <button type="submit" class="button primary">Create in ReAI</button>
              </form>`}</td>
        </tr>`)}</tbody>
      </table></div>
      ${batch && nextOffset < batch.total ? html`<div class="inline-row"><button type="button" class="button secondary" hx-post="/app/4human/fetch-api" hx-include="#fh-form" hx-vals='{"offset":"${nextOffset}"}' hx-target="#fh-output" hx-swap="innerHTML">Next ${BATCH} employees</button></div>` : ''}
      ${isSample ? reaiCallout({ tone: 'info', body: 'Sample employees loaded. Connect to ReAI and fetch from 4human to create real employees.' }) : reaiCallout({ tone: 'info', body: 'Each employee is created only when you click. Check tax card, salary and employment details in ReAI before the first payroll.' })}
    `,
  });
}

/**
 * Handles /app/4human/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/4human';
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">HR & EMPLOYEE MASTER DATA</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-4human-web', clientName: `ReAI ${BRAND} HRM (Web)` })}
        ${reaiCard({
          eyebrow: 'LIVE 4HUMAN API',
          title: 'Fetch employees from 4human',
          body: html`<p class="muted-note">4human support issues a Client ID and Secret Key for the REST API on request. They are used for this single request and never stored.</p>
            <form id="fh-form" class="stack" hx-post="${basePath}/fetch-api" hx-target="#fh-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="fh-cid">Client ID</label><input id="fh-cid" name="clientId" type="text" autocomplete="off" required></div>
                <div class="field"><label for="fh-secret">Secret Key</label><input id="fh-secret" name="clientSecret" type="password" autocomplete="off" required></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Fetch from 4human API</button>
                <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#fh-output" hx-swap="innerHTML">Load sample preview</button>
              </div>
            </form>`,
        })}
        <div id="fh-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${basePath}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) return htmlResponse(renderEmployees(SAMPLE_ROWS.map((emp, i) => ({ emp, existsId: i === 0 ? 7 : 0 })), true));
  try {
    const form = await request.formData();
    const session = await readSession(env, request);
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      const { rows, total, offset } = await fetchApi(creds);
      /** @type {ReaiEmployee[]} */ let existing = [];
      if (session && session.tenantId > 0) {
        const res = await reaiRequest(env, '/api/employees', { token: session.accessToken, tenantId: session.tenantId });
        existing = Array.isArray(res) ? /** @type {ReaiEmployee[]} */ (res) : [];
      }
      return htmlResponse(renderEmployees(rows.map((emp) => ({
        emp,
        existsId: existing.find((x) => (emp.email && String(x.email ?? '').toLowerCase() === emp.email.toLowerCase()) || x.name.trim().toLowerCase() === emp.name.toLowerCase())?.id ?? 0,
      })), false, { total, offset }));
    }
    if (pathname === `${basePath}/import`) {
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const emp = /** @type {HrEmployee} */ (JSON.parse(String(form.get('employeeJson') ?? '{}')));
      const name = String(emp.name ?? '').trim().slice(0, 75);
      const startDate = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(emp.startDate)) ? emp.startDate : new Date().toISOString().slice(0, 10);
      const bank = verifiedNorwegianAccount(String(emp.bank ?? ''));
      const nin = /^[0-9]{11}$/.test(String(emp.nin ?? '')) ? emp.nin : '';
      const percent = Math.min(100, Math.max(1, Number(emp.percent) || 100));
      if (!name) throw new HttpError(400, 'Employee name is required.');
      const current = await reaiRequest(env, '/api/employees', { token: session.accessToken, tenantId: session.tenantId });
      const email = String(emp.email ?? '').trim().toLowerCase();
      const dup = (Array.isArray(current) ? /** @type {ReaiEmployee[]} */ (current) : []).find((x) => (email && String(x.email ?? '').toLowerCase() === email) || x.name.trim().toLowerCase() === name.toLowerCase());
      if (dup) return htmlResponse(html`<tr><td><strong>${name}</strong></td><td>${emp.email || '—'}</td><td class="mono">${emp.employeeNumber || '—'}</td><td class="mono">${startDate}</td><td class="num">${percent}</td><td class="mono">${bank || '—'}</td><td>${reaiBadge({ text: `In ReAI #${dup.id}`, tone: 'neutral' })}</td></tr>`);
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/employees', {
        token: session.accessToken, tenantId: session.tenantId, method: 'POST',
        body: {
          name,
          dateOfEmployment: startDate,
          ...(emp.email ? { email: emp.email } : {}),
          ...(emp.phone ? { phone: String(emp.phone).slice(0, 30) } : {}),
          ...(bank ? { accountNumber: bank } : {}),
          ...(nin ? { nationalIdentityNumber: nin } : {}),
          ...(emp.address ? { addressPart1: emp.address } : {}),
          ...(emp.postalCode ? { postalCode: emp.postalCode } : {}),
          ...(emp.city ? { city: emp.city } : {}),
          employmentLines: [{ startDate, percentage: percent }],
        },
      }));
      return htmlResponse(html`<tr><td><strong>${name}</strong></td><td>${emp.email || '—'}</td><td class="mono">${emp.employeeNumber || '—'}</td><td class="mono">${startDate}</td><td class="num">${percent}</td><td class="mono">${bank || '—'}</td><td>${reaiBadge({ text: `Created #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
