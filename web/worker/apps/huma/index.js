// @ts-check
import { fetchJson, isoDate, num, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiRequest } from '../../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';
import { verifiedNorwegianAccount } from '../../lib/norway.js';

/** @typedef {{ name: string, email: string, startDate: string, bank: string, percent: number }} HumaEmpRow */

const API = 'https://openapi.humahr.com';
const MAX_USERS = 100;

/** @type {HumaEmpRow[]} */
const SAMPLE_ROWS = [
  { name: 'Astrid Lind (Demo)', email: 'post+huma-astrid@aiak.no', startDate: '2026-11-01', percent: 100, bank: '12345678903' },
  { name: 'Jonas Berg (Demo)', email: 'post+huma-jonas@aiak.no', startDate: '2026-11-15', percent: 80, bank: '' },
];

/**
 * Fetches active employees from the Huma Open API.
 * Docs: https://humahr.com/knowledge/open-api (API key with client ID and secret under System settings → Open API;
 * OAuth2 client credentials) and https://openapi.humahr.com/redoc/index.html (spec /v3/api-docs:
 * POST /auth/oauth/token, GET /users with limit up to 50, offset and isActive, returning { items, total };
 * GET /users/{id} returning UserDetails with email, employmentStartDate, employmentPercentage and bankAccount
 * as { value } fields).
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<HumaEmpRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const clientId = (creds.clientId ?? '').trim();
  const clientSecret = (creds.clientSecret ?? '').trim();
  if (!clientId || !clientSecret) throw new HttpError(400, 'Enter the Huma client ID and client secret.');
  const login = await fetchJson(`${API}/auth/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
  }, 'Huma', fetchImpl);
  const token = typeof login?.access_token === 'string' ? login.access_token : '';
  if (!token) throw new HttpError(400, 'Huma did not return an access token. Check the client ID and secret.');
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  /** @type {any[]} */ const users = [];
  for (let offset = 0; offset < 2000; offset += 50) {
    const page = await fetchJson(`${API}/users?${new URLSearchParams({ limit: '50', offset: String(offset), isActive: 'true' })}`, { headers }, 'Huma', fetchImpl);
    const items = Array.isArray(page?.items) ? page.items : [];
    users.push(...items);
    if (items.length < 50) break;
  }
  if (users.length > MAX_USERS) throw new HttpError(400, `Huma returned ${users.length} active users. This tool handles at most ${MAX_USERS} at a time.`);
  /** @type {HumaEmpRow[]} */ const rows = [];
  for (const u of users) {
    const d = await fetchJson(`${API}/users/${encodeURIComponent(String(u.id))}`, { headers }, 'Huma', fetchImpl);
    const bank = d?.bankAccount?.value;
    rows.push({
      name: [d?.givenName?.value ?? u.givenName, d?.familyName?.value ?? u.familyName].filter(Boolean).join(' ').trim(),
      email: String(d?.email?.value ?? u.email ?? '').trim(),
      startDate: isoDate(d?.employmentStartDate?.value ?? d?.firstDayOfWork?.value, ''),
      percent: Math.min(100, Math.max(1, num(d?.employmentPercentage?.value) || 100)),
      bank: bank?.type === 'national' && String(bank.country ?? '').toUpperCase() === 'NO' ? verifiedNorwegianAccount(String(bank.number ?? '')) : '',
    });
  }
  const named = rows.filter((e) => e.name.length > 0);
  if (named.length === 0) throw new HttpError(400, 'Huma returned no active employees.');
  return named;
}

/** @param {Array<{ emp: HumaEmpRow, existsId: number | null }>} rows @param {boolean} isSample */
function renderEmployees(rows, isSample) {
  return reaiCard({
    eyebrow: 'HUMA → REAI EMPLOYEES',
    title: `${rows.length} employees found`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${rows.filter((x) => !x.existsId).length} new`, tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Employees', value: String(rows.length), detail: 'Matched to ReAI by email or name' })}
        ${reaiMetric({ label: 'Verified bank account', value: String(rows.filter((x) => Boolean(x.emp.bank)).length), detail: 'Norwegian account, MOD11 checked' })}
        ${reaiMetric({ label: 'Safe sync', value: 'No invites', detail: 'Does not send invites or A-melding' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Name</th><th>Email</th><th>Start date</th><th>%</th><th>Bank</th><th>Action</th></tr></thead>
        <tbody>${rows.map(({ emp, existsId }, idx) => html`<tr id="wf-e-${idx}">
          <td><strong>${emp.name}</strong></td><td>${emp.email || '—'}</td><td class="mono">${emp.startDate || '—'}</td><td class="num">${emp.percent}%</td><td class="mono">${emp.bank || '—'}</td>
          <td>${existsId || isSample ? html`<span class="muted-note">${existsId ? `In ReAI #${existsId}` : 'Demo only'}</span>` : html`<form hx-post="/app/huma/import" hx-target="#wf-e-${idx}" hx-swap="outerHTML"><input type="hidden" name="name" value="${emp.name}"><input type="hidden" name="email" value="${emp.email}"><input type="hidden" name="startDate" value="${emp.startDate}"><input type="hidden" name="percent" value="${emp.percent}"><input type="hidden" name="bank" value="${emp.bank}"><button type="submit" class="button primary">Create in ReAI</button></form>`}</td>
        </tr>`)}</tbody>
      </table></div>
    `,
  });
}

/**
 * Handles /app/huma/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/huma';
  const title = 'Huma Employee Sync';
  const lead = 'Fetch active employees from the Huma Open API (name, email, start date, position percentage and Norwegian bank account) and create the missing ones in ReAI Employees.';
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">HR & EMPLOYEE ONBOARDING</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-huma-web', clientName: 'ReAI Huma (Web)' })}
        ${renderApiFetchCard({
          basePath,
          targetId: 'wfm-output',
          brand: 'Huma',
          hint: 'Create an API key in Huma under System settings → Open API and give it a role that can read employees, positions and bank accounts.',
          fields: [
            { name: 'clientId', label: 'Huma client ID', placeholder: 'Client ID' },
            { name: 'clientSecret', label: 'Huma client secret', type: 'password', placeholder: 'Client secret' },
          ],
          sampleAction: true,
        })}
        <div id="wfm-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) return htmlResponse(renderEmployees(SAMPLE_ROWS.map((emp, i) => ({ emp, existsId: i === 0 ? 7 : null })), true));
  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      const emps = await fetchApi(creds);
      const session = await readSession(env, request);
      /** @type {Array<{ id: number, name: string, email?: string }>} */ let existing = [];
      if (session && session.tenantId > 0) {
        const res = await reaiRequest(env, '/api/employees', { token: session.accessToken, tenantId: session.tenantId }).catch(() => []);
        existing = Array.isArray(res) ? /** @type {Array<{ id: number, name: string, email?: string }>} */ (res) : [];
      }
      const byEmail = new Map(existing.filter((e) => e.email).map((e) => [String(e.email).trim().toLowerCase(), e.id]));
      const byName = new Map(existing.map((e) => [e.name.trim().toLowerCase(), e.id]));
      return htmlResponse(renderEmployees(emps.map((emp) => ({ emp, existsId: (emp.email ? byEmail.get(emp.email.toLowerCase()) : undefined) ?? byName.get(emp.name.toLowerCase()) ?? null })), false));
    }
    if (pathname === `${basePath}/import`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const name = String(form.get('name') ?? '').trim();
      const email = String(form.get('email') ?? '').trim();
      const startDate = String(form.get('startDate') ?? '').slice(0, 10);
      const bank = verifiedNorwegianAccount(String(form.get('bank') ?? ''));
      if (!name) throw new HttpError(400, 'A name is required.');
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/employees', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { name, ...(email ? { email } : {}), ...(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(startDate) ? { dateOfEmployment: startDate } : {}), ...(bank ? { accountNumber: bank, bankCountryCode: 'NO' } : {}) } }));
      return htmlResponse(html`<tr><td><strong>${name}</strong></td><td>${email || '—'}</td><td class="mono">${startDate || '—'}</td><td class="num">—</td><td class="mono">${bank || '—'}</td><td>${reaiBadge({ text: `Created #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Huma error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown Huma route.', 404);
}
