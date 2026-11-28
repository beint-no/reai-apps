// @ts-check
import { fetchJson, isoDate, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiRequest } from '../../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';
import { verifiedNorwegianAccount } from '../../lib/norway.js';

/**
 * @typedef {{ id: string, name: string, email: string, phone: string, startDate: string, bank: string, percent: number | null, address: string, postalCode: string, city: string, country: string, detailed: boolean }} HumaEmpRow
 * @typedef {{ id: number, name: string, email?: string | null }} ReaiEmployee
 */

const API = 'https://openapi.humahr.com';
const PAGE_SIZE = 50; // documented maximum for GET /users
const MAX_LIST_PAGES = 20; // 1,000 active users
const DETAIL_BATCH = 25; // GET /users/{id} calls per run, for employees not yet in ReAI
const DETAIL_CONCURRENCY = 5;

/** @type {HumaEmpRow[]} */
const SAMPLE_ROWS = [
  { id: 'demo-1', name: 'Astrid Lind (Demo)', email: 'post+huma-astrid@aiak.no', phone: '+4791234567', startDate: '2026-11-01', percent: 100, bank: '12345678903', address: 'Storgata 1', postalCode: '0155', city: 'Oslo', country: 'NO', detailed: true },
  { id: 'demo-2', name: 'Jonas Berg (Demo)', email: 'post+huma-jonas@aiak.no', phone: '', startDate: '2026-11-15', percent: 80, bank: '', address: '', postalCode: '', city: '', country: 'NO', detailed: true },
];

/**
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapLimit(items, limit, fn) {
  /** @type {R[]} */ const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(/** @type {T} */ (items[i]));
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** @param {string} v */
const norm = (v) => v.trim().toLowerCase();

/**
 * Finds the ReAI employee matching a Huma user by email, then by name.
 * @param {ReaiEmployee[]} existing
 * @param {{ email: string, name: string }} u
 */
function matchExisting(existing, u) {
  const byEmail = u.email ? existing.find((e) => e.email && norm(e.email) === norm(u.email)) : undefined;
  return (byEmail ?? existing.find((e) => norm(e.name) === norm(u.name)))?.id ?? null;
}

/**
 * Fetches active employees from the Huma Open API and loads details only for users not yet in ReAI.
 * Docs: https://humahr.com/knowledge/open-api (API key with client ID and secret under System settings → Open API;
 * OAuth2 client credentials) and https://openapi.humahr.com/redoc/index.html (spec /v3/api-docs:
 * POST /auth/oauth/token, GET /users with limit up to 50, offset and isActive, returning { items, total } with
 * givenName, familyName, email and phone; GET /users/{id} returning UserDetails with currentPositions
 * (contractStartDate, percentage), homeAddress and bankAccount as { value } fields).
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @param {ReaiEmployee[]} [existing]
 * @returns {Promise<{ rows: Array<{ emp: HumaEmpRow, existsId: number | null }>, pending: number, truncated: boolean }>}
 */
export async function fetchApi(creds, fetchImpl = fetch, existing = []) {
  const clientId = (creds.clientId ?? '').trim();
  const clientSecret = (creds.clientSecret ?? '').trim();
  const skip = Math.max(0, Math.floor(Number(creds.skip ?? '0') || 0));
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
  let truncated = false;
  for (let page = 0; ; page++) {
    if (page === MAX_LIST_PAGES) { truncated = true; break; }
    const data = await fetchJson(`${API}/users?${new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE), isActive: 'true', orderDirection: 'ASC' })}`, { headers }, 'Huma', fetchImpl);
    const items = Array.isArray(data?.items) ? data.items : [];
    users.push(...items);
    const total = typeof data?.total === 'number' ? data.total : null;
    if (items.length < PAGE_SIZE || (total !== null && users.length >= total)) break;
  }
  const people = users.filter((u) => u?.type === undefined || u.type === 'user');
  if (people.length === 0) throw new HttpError(400, 'Huma returned no active employees. Check that the API key has a role that can read employees.');
  /** @type {Array<{ emp: HumaEmpRow, existsId: number | null }>} */
  const rows = people.map((u) => {
    const emp = {
      id: String(u.id),
      name: [u.givenName, u.familyName].filter(Boolean).join(' ').trim(),
      email: String(u.email ?? '').trim(),
      phone: String(u.phone ?? '').trim(),
      startDate: '', bank: '', percent: null, address: '', postalCode: '', city: '', country: '', detailed: false,
    };
    return { emp, existsId: matchExisting(existing, emp) };
  }).filter((r) => r.emp.name.length > 0);
  const missing = rows.filter((r) => r.existsId === null);
  const batch = missing.slice(skip, skip + DETAIL_BATCH);
  await mapLimit(batch, DETAIL_CONCURRENCY, async (r) => {
    const d = await fetchJson(`${API}/users/${encodeURIComponent(r.emp.id)}`, { headers }, 'Huma', fetchImpl);
    const positions = /** @type {Array<{ contractStartDate?: string | null, percentage?: number | null, status?: string | null }>} */ (Array.isArray(d?.currentPositions) ? d.currentPositions : []);
    const starts = positions.map((p) => isoDate(p.contractStartDate, '')).filter(Boolean).sort();
    const pct = positions.reduce((t, p) => t + (typeof p.percentage === 'number' ? p.percentage : 0), 0);
    const bank = d?.bankAccount?.value;
    const addr = d?.homeAddress?.value;
    const country = String(addr?.country ?? '').trim().toUpperCase();
    Object.assign(r.emp, {
      name: [d?.givenName?.value, d?.familyName?.value].filter(Boolean).join(' ').trim() || r.emp.name,
      email: String(d?.email?.value ?? r.emp.email).trim(),
      phone: String(d?.phone?.value ?? r.emp.phone ?? '').trim(),
      startDate: starts[0] ?? isoDate(d?.firstContractStartDate?.value ?? d?.employmentStartDate?.value, ''),
      percent: pct > 0 ? pct : (typeof d?.employmentPercentage?.value === 'number' ? d.employmentPercentage.value : null),
      bank: bank?.type === 'national' && String(bank.country ?? '').toUpperCase() === 'NO' ? verifiedNorwegianAccount(String(bank.number ?? '')) : '',
      address: String(addr?.line1 ?? '').trim(),
      postalCode: String(addr?.postalCode ?? '').trim(),
      city: String(addr?.city ?? '').trim(),
      country: /^[A-Z]{2}$/.test(country) ? country : '',
      detailed: true,
    });
  });
  return { rows, pending: Math.max(0, missing.length - skip - batch.length), truncated };
}

/**
 * @param {{ rows: Array<{ emp: HumaEmpRow, existsId: number | null }>, pending: number, truncated: boolean }} result
 * @param {boolean} isSample
 * @param {number} [skip]
 */
function renderEmployees(result, isSample, skip = 0) {
  const { rows, pending, truncated } = result;
  const fresh = rows.filter((x) => !x.existsId);
  return reaiCard({
    eyebrow: 'HUMA → REAI EMPLOYEES',
    title: `${rows.length} active employees found`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${fresh.length} not in ReAI`, tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Employees', value: String(rows.length), detail: 'Matched to ReAI by email or name' })}
        ${reaiMetric({ label: 'Verified bank account', value: String(rows.filter((x) => Boolean(x.emp.bank)).length), detail: 'Norwegian account, MOD11 checked' })}
        ${reaiMetric({ label: 'Safe sync', value: 'No invites', detail: 'Does not send invites or A-melding' })}
      </div>
      ${truncated ? reaiCallout({ tone: 'warn', body: `Only the first ${MAX_LIST_PAGES * PAGE_SIZE} active Huma users were read.` }) : ''}
      ${pending > 0 ? reaiCallout({ tone: 'info', body: `Details are loaded for ${DETAIL_BATCH} new employees per run. Create these, then fetch again, or set "Skip new employees" to ${skip + DETAIL_BATCH} to load the next ${Math.min(pending, DETAIL_BATCH)}.` }) : ''}
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Name</th><th>Email</th><th>Start date</th><th>%</th><th>Bank</th><th>Action</th></tr></thead>
        <tbody>${rows.map(({ emp, existsId }, idx) => html`<tr id="wf-e-${idx}">
          <td><strong>${emp.name}</strong></td><td>${emp.email || '—'}</td><td class="mono">${emp.startDate || '—'}</td><td class="num">${emp.percent === null ? '—' : `${emp.percent}%`}</td><td class="mono">${emp.bank || '—'}</td>
          <td>${existsId || isSample
            ? html`<span class="muted-note">${existsId ? `In ReAI #${existsId}` : 'Demo only'}</span>`
            : !emp.detailed
              ? html`<span class="muted-note">Next run</span>`
              : html`<form hx-post="/app/huma/import" hx-target="#wf-e-${idx}" hx-swap="outerHTML">
                  <input type="hidden" name="name" value="${emp.name}"><input type="hidden" name="email" value="${emp.email}"><input type="hidden" name="phone" value="${emp.phone}">
                  <input type="hidden" name="startDate" value="${emp.startDate}"><input type="hidden" name="bank" value="${emp.bank}">
                  <input type="hidden" name="address" value="${emp.address}"><input type="hidden" name="postalCode" value="${emp.postalCode}"><input type="hidden" name="city" value="${emp.city}"><input type="hidden" name="country" value="${emp.country}">
                  <button type="submit" class="button primary">Create in ReAI</button></form>`}</td>
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
          hint: 'Create an API key in Huma under System settings → Open API and give it a role that can read employees, positions, addresses and bank accounts.',
          fields: [
            { name: 'clientId', label: 'Huma client ID', placeholder: 'Client ID' },
            { name: 'clientSecret', label: 'Huma client secret', type: 'password', placeholder: 'Client secret' },
            { name: 'skip', label: 'Skip new employees', placeholder: '0', required: false, defaultValue: '0' },
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
  if (pathname === `${basePath}/sample`) return htmlResponse(renderEmployees({ rows: SAMPLE_ROWS.map((emp, i) => ({ emp, existsId: i === 0 ? 7 : null })), pending: 0, truncated: false }, true));
  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      const session = await readSession(env, request);
      /** @type {ReaiEmployee[]} */ let existing = [];
      if (session && session.tenantId > 0) {
        existing = /** @type {ReaiEmployee[]} */ (await reaiRequest(env, '/api/employees', { token: session.accessToken, tenantId: session.tenantId }));
      }
      const result = await fetchApi(creds, fetch, existing);
      return htmlResponse(renderEmployees(result, false, Math.max(0, Math.floor(Number(creds.skip ?? '0') || 0))));
    }
    if (pathname === `${basePath}/import`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const name = String(form.get('name') ?? '').trim().slice(0, 75);
      const email = String(form.get('email') ?? '').trim();
      const startDate = String(form.get('startDate') ?? '').slice(0, 10);
      const bank = verifiedNorwegianAccount(String(form.get('bank') ?? ''));
      const phone = String(form.get('phone') ?? '').trim().slice(0, 30);
      const address = String(form.get('address') ?? '').trim();
      const postalCode = String(form.get('postalCode') ?? '').trim();
      const city = String(form.get('city') ?? '').trim();
      const country = String(form.get('country') ?? '').trim().toUpperCase();
      if (!name) throw new HttpError(400, 'A name is required.');
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const existing = /** @type {ReaiEmployee[]} */ (await reaiRequest(env, '/api/employees', auth));
      const dupId = matchExisting(existing, { name, email });
      const cells = html`<td><strong>${name}</strong></td><td>${email || '—'}</td><td class="mono">${startDate || '—'}</td><td class="num">—</td><td class="mono">${bank || '—'}</td>`;
      if (dupId) return htmlResponse(html`<tr>${cells}<td>${reaiBadge({ text: `In ReAI #${dupId}`, tone: 'neutral' })}</td></tr>`);
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/employees', {
        ...auth,
        method: 'POST',
        body: {
          name,
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
          ...(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(startDate) ? { dateOfEmployment: startDate } : {}),
          ...(bank ? { accountNumber: bank, bankCountryCode: 'NO' } : {}),
          ...(address && city ? { addressPart1: address, city, ...(postalCode ? { postalCode } : {}), ...(/^[A-Z]{2}$/.test(country) ? { countryCode: country } : {}) } : {}),
        },
      }));
      return htmlResponse(html`<tr>${cells}<td>${reaiBadge({ text: `Created #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Huma error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown Huma route.', 404);
}
