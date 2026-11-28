// @ts-check
import { fetchJson, isoDate } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiRequest } from '../../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/**
 * @typedef {{ applicationId: string, candidateId: string, name: string, email: string, workEmail: string, phone: string, address: string, postalCode: string, city: string, countryCode: string, job: string, hiredDate: string, startDate: string }} Hire
 * @typedef {{ id: number, name: string, email?: string | null }} ReaiEmployee
 */

const SLUG = 'teamtailor';
const BRAND = 'Teamtailor';
const BASE_PATH = `/app/${SLUG}`;
const TITLE = 'Teamtailor New Hires to ReAI';
const LEAD = 'Fetch candidates moved to the Hired stage in Teamtailor and create them as employees in ReAI with name, contact details and start date.';
/** Newest dated API version. Teamtailor requires X-Api-Version on every request since 2025-10-01. */
const API_VERSION = '20240904';
/** @type {Record<string, string>} */
const HOSTS = { eu: 'https://api.teamtailor.com', na: 'https://api.na.teamtailor.com' };
const PAGE_SIZE = 30;
const MAX_APPLICATION_PAGES = 10;
const MAX_ONBOARDING_PAGES = 5;

/** @type {Hire[]} */
const SAMPLE = [
  { applicationId: 'demo-1', candidateId: 'c1', name: 'Kari Nordmann (Demo)', email: 'post+kari@aiak.no', workEmail: 'post+kari.work@aiak.no', phone: '+4740000001', address: 'Storgata 1', postalCode: '0155', city: 'Oslo', countryCode: 'NO', job: 'Regnskapsmedarbeider', hiredDate: '2026-11-04', startDate: '2026-12-01' },
  { applicationId: 'demo-2', candidateId: 'c2', name: 'Per Hansen (Demo)', email: 'post+per@aiak.no', workEmail: '', phone: '', address: '', postalCode: '', city: '', countryCode: '', job: 'Lagermedarbeider', hiredDate: '2026-11-12', startDate: '' },
];

/** @param {string} apiKey */
function ttHeaders(apiKey) {
  return { authorization: `Token token=${apiKey}`, 'x-api-version': API_VERSION, accept: 'application/vnd.api+json' };
}

/** @param {string} iso */
function osloDate(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

/** @param {any} included @returns {Map<string, any>} */
function indexIncluded(included) {
  /** @type {Map<string, any>} */ const map = new Map();
  for (const r of Array.isArray(included) ? included : []) map.set(`${r?.type}:${r?.id}`, r);
  return map;
}

/** @param {any} rec @param {string} rel @returns {{ type: string, id: string } | null} */
function relId(rec, rel) {
  const d = rec?.relationships?.[rel]?.data;
  return d && typeof d === 'object' && d.id !== undefined ? { type: String(d.type), id: String(d.id) } : null;
}

/**
 * Follows JSON:API links.next for a Teamtailor list.
 * @param {string} firstUrl
 * @param {Record<string, string>} headers
 * @param {number} maxPages
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 * @param {string} host
 */
async function listPages(firstUrl, headers, maxPages, fetchImpl, host) {
  /** @type {any[]} */ const data = [];
  /** @type {any[]} */ const included = [];
  let url = firstUrl;
  let more = false;
  for (let page = 0; page < maxPages && url; page++) {
    const body = await fetchJson(url, { headers }, BRAND, fetchImpl);
    if (Array.isArray(body?.data)) data.push(...body.data);
    if (Array.isArray(body?.included)) included.push(...body.included);
    const next = typeof body?.links?.next === 'string' ? body.links.next : '';
    url = next && next.startsWith(`${host}/`) ? next : '';
    more = Boolean(url);
  }
  return { data, included: indexIncluded(included), more };
}

/**
 * Reads candidates in the Hired stage since a date from the Teamtailor API, plus start dates from
 * onboardings when the Onboarding add-on is active.
 * Docs: https://docs.teamtailor.com/ (Authorization: Token token=<key>, X-Api-Version 20240904, EU and NA hosts,
 * page[size] max 30 with links.next, 50 requests per 10 seconds; "List latest hired candidates":
 * GET /v1/job-applications?include=candidate&filter[stage-type]=hired; job application filter
 * filter[changed-stage-at][from]; candidate attributes first-name, last-name, email, phone, address, zip, city,
 * country-code; onboardings attributes start-date, work-email, status with include=candidate).
 * @param {Record<string, string>} creds `apiKey`, `region` (eu or na) and `hiredFrom` (YYYY-MM-DD)
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<{ hires: Hire[], more: boolean, onboardings: boolean }>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const apiKey = (creds.apiKey ?? '').trim();
  if (!apiKey) throw new HttpError(400, 'Enter your Teamtailor API key.');
  const host = HOSTS[creds.region ?? 'eu'] ?? 'https://api.teamtailor.com';
  const from = isoDate(creds.hiredFrom);
  const headers = ttHeaders(apiKey);
  const q = new URLSearchParams({ include: 'candidate,job', 'filter[stage-type]': 'hired', 'filter[changed-stage-at][from]': from, sort: '-changed_stage_at', 'page[size]': String(PAGE_SIZE) });
  const apps = await listPages(`${host}/v1/job-applications?${q}`, headers, MAX_APPLICATION_PAGES, fetchImpl, host);

  /** @type {Map<string, { startDate: string, workEmail: string }>} */ const onboardingByCandidate = new Map();
  let onboardings = false;
  try {
    const oq = new URLSearchParams({ include: 'candidate', 'page[size]': String(PAGE_SIZE) });
    const ob = await listPages(`${host}/v1/onboardings?${oq}`, headers, MAX_ONBOARDING_PAGES, fetchImpl, host);
    onboardings = true;
    for (const o of ob.data) {
      const cand = relId(o, 'candidate');
      if (!cand || o?.attributes?.status === 'archived') continue;
      onboardingByCandidate.set(cand.id, { startDate: isoDate(o?.attributes?.['start-date'], ''), workEmail: String(o?.attributes?.['work-email'] ?? '').trim() });
    }
  } catch {
    // Onboardings exist only with the Onboarding add-on; without it the start date is chosen per row.
  }

  /** @type {Hire[]} */ const hires = [];
  /** @type {Set<string>} */ const seen = new Set();
  for (const a of apps.data) {
    if (a?.attributes?.['rejected-at']) continue;
    const candRef = relId(a, 'candidate');
    if (!candRef || seen.has(candRef.id)) continue;
    const cand = apps.included.get(`candidates:${candRef.id}`);
    const attrs = cand?.attributes ?? {};
    const name = `${String(attrs['first-name'] ?? '').trim()} ${String(attrs['last-name'] ?? '').trim()}`.trim();
    if (!name) continue;
    seen.add(candRef.id);
    const jobRef = relId(a, 'job');
    const job = jobRef ? apps.included.get(`jobs:${jobRef.id}`) : null;
    const ob = onboardingByCandidate.get(candRef.id);
    const country = String(attrs['country-code'] ?? '').trim().toUpperCase();
    hires.push({
      applicationId: String(a.id),
      candidateId: candRef.id,
      name: name.slice(0, 75),
      email: String(attrs.email ?? '').trim(),
      workEmail: ob?.workEmail ?? '',
      phone: String(attrs.phone ?? '').trim().slice(0, 30),
      address: String(attrs.address ?? '').trim(),
      postalCode: String(attrs.zip ?? '').trim(),
      city: String(attrs.city ?? '').trim(),
      countryCode: /^[A-Z]{2}$/.test(country) ? country : '',
      job: String(job?.attributes?.title ?? '').trim(),
      hiredDate: osloDate(String(a?.attributes?.['changed-stage-at'] ?? '')),
      startDate: ob?.startDate ?? '',
    });
  }
  return { hires, more: apps.more, onboardings };
}

/** @param {string} s */
const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** @param {Hire} h @param {ReaiEmployee[]} employees */
function findExisting(h, employees) {
  const emails = [h.workEmail, h.email].filter(Boolean).map(norm);
  return employees.find((e) => emails.includes(norm(String(e.email ?? '')))) ?? employees.find((e) => norm(e.name) === norm(h.name));
}

/** @param {Hire} h @param {import('../../lib/html.js').HtmlValue} action */
function hireRow(h, action) {
  return html`<td><strong>${h.name}</strong>${h.job ? html`<br><span class="muted-note">${h.job}</span>` : ''}</td><td>${h.workEmail || h.email || '—'}</td><td class="mono">${h.hiredDate || '—'}</td>${action}`;
}

/** @param {{ rows: Array<{ hire: Hire, existsId: number }>, more: boolean, onboardings: boolean, isSample: boolean }} s */
function renderHires(s) {
  const fresh = s.rows.filter((r) => r.existsId <= 0).length;
  return reaiCard({
    eyebrow: 'TEAMTAILOR HIRED → REAI EMPLOYEES',
    title: `${s.rows.length} hired candidates`,
    badge: s.isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${fresh} new`, tone: fresh > 0 ? 'success' : 'neutral' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Hired candidates', value: String(s.rows.length), detail: 'Rejected applications skipped' })}
        ${reaiMetric({ label: 'Already in ReAI', value: String(s.rows.length - fresh), detail: 'Matched by email or name' })}
        ${reaiMetric({ label: 'Start dates', value: s.onboardings ? 'From onboarding' : 'Choose per row', detail: s.onboardings ? 'Teamtailor Onboarding add-on' : 'No Onboarding add-on' })}
      </div>
      ${s.more ? reaiCallout({ tone: 'warn', body: 'Teamtailor has more hires than one fetch reads. Choose a later date to see the oldest ones.' }) : ''}
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Name</th><th>Email</th><th>Hired</th><th>Start date</th><th>Action</th></tr></thead>
        <tbody>${s.rows.map(({ hire, existsId }, idx) => html`<tr id="tt-h-${idx}">
          ${hireRow(hire, existsId > 0 || s.isSample
            ? html`<td class="mono">${hire.startDate || '—'}</td><td><span class="muted-note">${existsId > 0 && !s.isSample ? `In ReAI #${existsId}` : 'Demo only'}</span></td>`
            : html`<td colspan="2"><form class="inline-row" hx-post="${BASE_PATH}/import" hx-target="#tt-h-${idx}" hx-swap="outerHTML">
                <input type="hidden" name="hireJson" value="${JSON.stringify(hire)}">
                <input type="date" name="startDate" value="${hire.startDate || hire.hiredDate}" required aria-label="Start date">
                <button type="submit" class="button primary">Create in ReAI</button>
              </form></td>`)}
        </tr>`)}</tbody>
      </table></div>
      ${s.isSample
        ? reaiCallout({ tone: 'info', body: 'Sample hires loaded. Connect to ReAI and fetch from Teamtailor to create real employees.' })
        : reaiCallout({ tone: 'info', body: 'Each employee is created only when you click. Add the national identity number, bank account, salary and tax card in ReAI before the first payroll.' })}
    `,
  });
}

/**
 * Handles /app/teamtailor/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE_PATH && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE_PATH}/`, request.url), 301);
  if (pathname === `${BASE_PATH}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const d = new Date();
    const defaultFrom = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 2, 1)).toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro"><p class="eyebrow">RECRUITMENT & ONBOARDING</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${SLUG}-web`, clientName: `ReAI ${BRAND} (Web)` })}
        ${reaiCard({
          eyebrow: 'LIVE TEAMTAILOR API',
          title: 'Fetch hired candidates',
          body: html`<p class="muted-note">In Teamtailor, a Company Admin opens Settings → Integrations → API keys, clicks New API key and chooses the Admin scope with Read access. The key is used only for this request and is never stored.</p>
            <form class="stack" hx-post="${BASE_PATH}/fetch-api" hx-target="#${SLUG}-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="tt-key">Teamtailor API key</label><input id="tt-key" name="apiKey" type="password" autocomplete="off" required></div>
                <div class="field"><label for="tt-region">Data region</label><select id="tt-region" name="region"><option value="eu">EU (api.teamtailor.com)</option><option value="na">North America</option></select></div>
                <div class="field"><label for="tt-from">Hired from</label><input id="tt-from" name="hiredFrom" type="date" value="${defaultFrom}" required></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Fetch from Teamtailor</button>
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
  if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderHires({ rows: SAMPLE.map((hire, i) => ({ hire, existsId: i === 1 ? 12 : 0 })), more: false, onboardings: true, isSample: true }));
  try {
    const form = await request.formData();
    const session = await readSession(env, request);
    if (pathname === `${BASE_PATH}/fetch-api`) {
      const result = await fetchApi({ apiKey: String(form.get('apiKey') ?? ''), region: String(form.get('region') ?? 'eu'), hiredFrom: String(form.get('hiredFrom') ?? '') });
      if (result.hires.length === 0) throw new HttpError(400, 'Teamtailor has no candidates in a Hired stage from that date.');
      /** @type {ReaiEmployee[]} */ let existing = [];
      if (session && session.tenantId > 0) {
        const res = await reaiRequest(env, '/api/employees', { token: session.accessToken, tenantId: session.tenantId });
        existing = Array.isArray(res) ? /** @type {ReaiEmployee[]} */ (res) : [];
      }
      return htmlResponse(renderHires({ rows: result.hires.map((hire) => ({ hire, existsId: findExisting(hire, existing)?.id ?? 0 })), more: result.more, onboardings: result.onboardings, isSample: false }));
    }
    if (pathname === `${BASE_PATH}/import`) {
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const hire = /** @type {Hire} */ (JSON.parse(String(form.get('hireJson') ?? '{}')));
      const name = String(hire.name ?? '').trim().slice(0, 75);
      const startDate = String(form.get('startDate') ?? '').trim();
      if (!name) throw new HttpError(400, 'The candidate has no name.');
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(startDate)) throw new HttpError(400, 'Choose the start date.');
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const current = await reaiRequest(env, '/api/employees', auth);
      const dup = findExisting(hire, Array.isArray(current) ? /** @type {ReaiEmployee[]} */ (current) : []);
      if (dup) return htmlResponse(html`<tr>${hireRow(hire, html`<td class="mono">${startDate}</td><td>${reaiBadge({ text: `In ReAI #${dup.id}`, tone: 'neutral' })}</td>`)}</tr>`);
      const email = String(hire.workEmail || hire.email || '').trim();
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/employees', {
        ...auth,
        method: 'POST',
        body: {
          name,
          dateOfEmployment: startDate,
          ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email } : {}),
          ...(hire.phone ? { phone: String(hire.phone).slice(0, 30) } : {}),
          ...(hire.address ? { addressPart1: String(hire.address) } : {}),
          ...(hire.postalCode ? { postalCode: String(hire.postalCode) } : {}),
          ...(hire.city ? { city: String(hire.city) } : {}),
          ...(/^[A-Z]{2}$/.test(String(hire.countryCode)) ? { countryCode: hire.countryCode } : {}),
          employmentLines: [{ startDate }],
        },
      }));
      return htmlResponse(html`<tr>${hireRow(hire, html`<td class="mono">${startDate}</td><td>${reaiBadge({ text: `Created #${created.id}`, tone: 'success' })}</td>`)}</tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
