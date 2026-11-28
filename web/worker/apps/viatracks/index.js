// @ts-check
import { isoDate, num, pickList } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/**
 * @typedef {{ id: string, date: string, from: string, to: string, purpose: string, km: number, toll: number, otherExpenses: string, driver: string, driverEmail: string, plate: string, vehicleName: string }} TripRow
 * @typedef {TripRow & { employeeId: number, vehicleId: number, issue: string }} MappedTrip
 * @typedef {{ id: number, name: string, email?: string | null }} EmployeeRef
 * @typedef {{ id: number, name: string, registrationNumber?: string | null, archived?: boolean }} VehicleRef
 */

const SLUG = 'viatracks';
const BRAND = 'ViaTracks';
const BASE = `/app/${SLUG}`;
const TITLE = 'ViaTracks Driving Log';
const LEAD = 'Fetch business trips and road tolls from the ViaTracks API and record them in ReAI Driving Log, matched to employees and vehicles.';
const API = 'https://api.viatracks.com';
const TOKEN_URL = 'https://connect.devinco.com/Token/GenerateAccessTokenFromCache';
const CLIENT_ID = 13;
const PAGE_SIZE = 200;
const MAX_PAGES = 15;
const BOOK_LIMIT = 30;
const DUP_PAGES = 5;
const MAX_KM = 2000;

/** @type {TripRow[]} */
const SAMPLE = [
  { id: 's1', date: '2026-10-06', from: 'Industriveien 4, Trondheim', to: 'Leangen, Trondheim', purpose: 'Service hos kunde', km: 7.4, toll: 21, otherExpenses: '', driver: 'Kari Nordmann', driverEmail: 'kari@example.no', plate: 'EK 12345', vehicleName: 'Service 1' },
  { id: 's2', date: '2026-10-08', from: 'Industriveien 4, Trondheim', to: 'Stjørdal sentrum', purpose: 'Montering', km: 34.9, toll: 0, otherExpenses: 'Parkering 60.00', driver: 'Kari Nordmann', driverEmail: 'kari@example.no', plate: 'EK 12345', vehicleName: 'Service 1' },
  { id: 's3', date: '2026-10-13', from: 'Industriveien 4, Trondheim', to: 'Melhus', purpose: 'Befaring', km: 22.1, toll: 42, otherExpenses: '', driver: 'Ola Nordmann', driverEmail: 'ola@example.no', plate: 'EL 67890', vehicleName: 'Service 2' },
];

/** @param {unknown} v */
function str(v) {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

/** @param {string} s */
const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** @param {string} s */
const plateKey = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * Bookkeeping day of a ViaTracks timestamp: Europe/Oslo when it carries a zone, else its own date.
 * @param {unknown} v
 * @param {string} fallback
 */
function tripDay(v, fallback) {
  const s = str(v);
  if (/(?:Z|[+-][0-9]{2}:?[0-9]{2})$/i.test(s) && !Number.isNaN(Date.parse(s))) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(s));
  }
  return isoDate(s, fallback);
}

/**
 * Exchanges the Devinco subjectId and apiKey for a ViaTracks access token (Devinco Connect clientId 13).
 * The docs do not show the response body, so a bare token and common JSON token fields are accepted.
 * @param {string} subjectId
 * @param {string} apiKey
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 */
async function connectToken(subjectId, apiKey, fetchImpl) {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ clientId: CLIENT_ID, subjectId, apiKey }),
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new HttpError(400, `Devinco Connect ${res.status === 401 || res.status === 403 ? 'rejected the subjectId or API key' : `returned HTTP ${res.status}`}.`);
  const text = (await res.text()).trim();
  /** @type {unknown} */ let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* bare token */ }
  const token = typeof parsed === 'string'
    ? parsed
    : str(/** @type {any} */ (parsed)?.accessToken ?? /** @type {any} */ (parsed)?.access_token ?? /** @type {any} */ (parsed)?.token);
  if (!token) throw new HttpError(400, 'Devinco Connect returned no access token.');
  return token;
}

/**
 * GET with the ViaTracks bearer token; 429 (throttling) gets a clear message.
 * @param {string} url
 * @param {string} token
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 */
async function vtGet(url, token, fetchImpl) {
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  if (res.status === 429) throw new HttpError(429, 'ViaTracks is throttling requests. Wait a minute and try again.');
  if (!res.ok) throw new HttpError(400, `ViaTracks API ${res.status === 401 || res.status === 403 ? 'rejected the token. Check that the integration user can see these vehicles and that Integration Enabled is on' : `returned HTTP ${res.status}`}.`);
  return res.json();
}

/**
 * Maps one TripWithExpense (or a bare ViewTrip) to a ReAI trip row; private trips return null.
 * Distance is read as metres, the unit the spec gives for distancePrivateTaxable.
 * @param {any} item
 * @param {Map<string, string>} userNames
 * @param {string} fallbackDate
 * @returns {TripRow | null}
 */
export function mapTrip(item, userNames, fallbackDate) {
  const t = item?.trip ?? item;
  if (!t || typeof t !== 'object') return null;
  if (t.personal === true || t.isPrivateOccasional === true || t.isPrivateTaxable === true) return null;
  const progress = t.progress === null || t.progress === undefined || t.progress === '' ? -1 : num(t.progress);
  if (progress === 0 || progress === 1) return null;
  const metres = num(t.distance) - Math.max(0, num(t.distancePrivateTaxable));
  const km = Number((metres / 1000).toFixed(1));
  if (!(km >= 0.1)) return null;
  /** @type {any[]} */ const expenses = Array.isArray(item?.tripExpenses) ? item.tripExpenses : [];
  let toll = 0;
  /** @type {string[]} */ const other = [];
  for (const e of expenses) {
    if (e?.isPrivateTaxable === true) continue;
    const amount = Math.round(num(e?.quantity ?? 1) * num(e?.rate) * 100) / 100;
    if (!(amount > 0)) continue;
    const type = str(e?.expenseType);
    if (/bom|toll/i.test(type)) toll += amount;
    else other.push(`${type || 'Expense'} ${amount.toFixed(2)}`);
  }
  const userId = str(t.userID);
  return {
    id: str(t.tripID),
    date: tripDay(t.startTime, fallbackDate),
    from: (str(t.startLocation) || 'Start').slice(0, 255),
    to: (str(t.endLocation) || 'Destination').slice(0, 255),
    purpose: (str(t.purpose) || str(t.externalReference) || 'Business trip (ViaTracks)').slice(0, 500),
    km,
    toll: Number(toll.toFixed(2)),
    otherExpenses: other.join(', '),
    driver: userNames.get(userId) ?? str(t.username),
    driverEmail: str(t.username).toLowerCase(),
    plate: str(t.registrationNumber),
    vehicleName: str(t.trackerObjectDescription),
  };
}

/**
 * Fetches business trips with their expenses for a date range from the ViaTracks REST API v1.
 * Docs: https://www.devinco.com/developer/viatracks/connect/ (POST connect.devinco.com/Token/GenerateAccessTokenFromCache
 * with clientId 13, subjectId and apiKey; Authorization: Bearer), https://www.devinco.com/developer/viatracks/paging-filtering-and-sorting/
 * (Filters, Sorts, Page, PageSize, default 200) and https://api.viatracks.com/openapi/v1.json (GET /api/Trip with
 * Period=custom, PeriodFrom, PeriodTo, includeExpenses; GET /api/User for driver names).
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<TripRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const subjectId = (creds.subjectId ?? '').trim();
  const apiKey = (creds.apiKey ?? '').trim();
  if (!subjectId || !apiKey) throw new HttpError(400, 'Enter the subjectId and API key from Devinco support.');
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (from > to) throw new HttpError(400, 'From date must be on or before to date.');
  const token = await connectToken(subjectId, apiKey, fetchImpl);

  const usersPayload = await vtGet(`${API}/api/User?${new URLSearchParams({ Page: '1', PageSize: String(PAGE_SIZE) })}`, token, fetchImpl);
  /** @type {Map<string, string>} */ const userNames = new Map();
  for (const u of pickList(usersPayload)) if (str(u?.description)) userNames.set(str(u.userID), str(u.description));

  /** @type {TripRow[]} */ const rows = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams({ Period: 'custom', PeriodFrom: `${from}T00:00:00`, PeriodTo: `${to}T23:59:59`, includeExpenses: 'true', Sorts: 'StartTime', Page: String(page), PageSize: String(PAGE_SIZE) });
    const list = pickList(await vtGet(`${API}/api/Trip?${q}`, token, fetchImpl));
    for (const item of list) {
      const row = mapTrip(item, userNames, from);
      if (row && row.date >= from && row.date <= to) rows.push(row);
    }
    if (list.length < PAGE_SIZE) {
      if (rows.length === 0) throw new HttpError(400, `ViaTracks returned no business trips from ${from} to ${to}.`);
      return rows;
    }
  }
  throw new HttpError(400, `ViaTracks returned more than ${MAX_PAGES * PAGE_SIZE} trips. Choose a shorter period.`);
}

/**
 * Loads ReAI employees and active vehicles for the selected company.
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {import('../../lib/types.d.ts').SessionData | null} session
 */
async function loadRefs(env, session) {
  if (!session || session.tenantId <= 0) return { employees: /** @type {EmployeeRef[]} */ ([]), vehicles: /** @type {VehicleRef[]} */ ([]) };
  const auth = { token: session.accessToken, tenantId: session.tenantId };
  const [e, v] = await Promise.all([
    reaiRequest(env, '/api/employees', auth).catch(() => []),
    reaiRequest(env, '/api/driving-log/vehicles', auth).catch(() => []),
  ]);
  return {
    employees: Array.isArray(e) ? /** @type {EmployeeRef[]} */ (e) : [],
    vehicles: Array.isArray(v) ? /** @type {VehicleRef[]} */ (v).filter((x) => !x.archived) : [],
  };
}

/**
 * Resolves the ReAI employee (by email, then name) and vehicle (by registration number) for each trip.
 * @param {TripRow[]} trips
 * @param {{ employees: EmployeeRef[], vehicles: VehicleRef[] }} refs
 * @param {number} fallbackEmployeeId
 * @param {number} fallbackVehicleId
 * @returns {MappedTrip[]}
 */
export function mapRefs(trips, refs, fallbackEmployeeId, fallbackVehicleId) {
  return trips.map((t) => {
    const emp = refs.employees.find((e) => t.driverEmail && norm(String(e.email ?? '')) === norm(t.driverEmail)) ?? refs.employees.find((e) => t.driver && norm(e.name) === norm(t.driver));
    const veh = refs.vehicles.find((v) => t.plate && plateKey(String(v.registrationNumber ?? '')) === plateKey(t.plate));
    const vehicleId = veh?.id ?? fallbackVehicleId;
    const issue = vehicleId <= 0 && refs.vehicles.length > 1 ? 'No ReAI vehicle matched' : '';
    return { ...t, employeeId: emp?.id ?? fallbackEmployeeId, vehicleId, issue };
  });
}

/** @param {{ tripDate: string, fromLocation: string, toLocation: string, kilometers: number }} t */
const tripKey = (t) => `${String(t.tripDate).slice(0, 10)}|${Math.round(Number(t.kilometers) * 10)}|${t.fromLocation}|${t.toLocation}`;

/**
 * Reads existing ReAI driving log trips back to the earliest date. The list has no date filter but is sorted by
 * trip date descending, so paging stops at the first page that reaches older trips.
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {{ token: string, tenantId: number }} auth
 * @param {string} earliest
 */
async function existingTripKeys(env, auth, earliest) {
  /** @type {Set<string>} */ const keys = new Set();
  for (let page = 1; page <= DUP_PAGES; page++) {
    const res = /** @type {{ items: Array<{ tripDate: string, fromLocation: string, toLocation: string, kilometers: number }>, hasNext: boolean }} */ (
      await reaiRequest(env, '/api/driving-log/trips', { ...auth, query: { page: String(page), pageSize: '200' } })
    );
    const items = Array.isArray(res.items) ? res.items : [];
    for (const x of items) keys.add(tripKey(x));
    const oldest = items.length ? String(items[items.length - 1]?.tripDate ?? '').slice(0, 10) : '';
    if (!res.hasNext || (oldest && oldest < earliest)) return keys;
  }
  throw new HttpError(400, 'ReAI Driving Log has too many newer trips to check for duplicates. Record older periods first.');
}

/**
 * Validates the trips posted back from the preview form.
 * @param {string} json
 * @returns {MappedTrip[]}
 */
function parseTrips(json) {
  /** @type {unknown} */ let parsed;
  try { parsed = JSON.parse(json); } catch { throw new HttpError(400, 'The trip list is invalid. Fetch the trips again.'); }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_PAGES * PAGE_SIZE) throw new HttpError(400, 'No trips to record. Fetch the trips again.');
  return parsed.map((/** @type {any} */ t) => {
    const km = Number(t?.km);
    const date = String(t?.date ?? '');
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !(km >= 0.1 && km <= MAX_KM)) throw new HttpError(400, 'A trip has an invalid date or distance. Fetch the trips again.');
    return {
      id: str(t.id), date, from: str(t.from).slice(0, 255) || 'Start', to: str(t.to).slice(0, 255) || 'Destination', purpose: str(t.purpose).slice(0, 500) || 'Business trip',
      km: Number(km.toFixed(1)), toll: Math.max(0, Number(num(t.toll).toFixed(2))), otherExpenses: str(t.otherExpenses), driver: str(t.driver), driverEmail: str(t.driverEmail), plate: str(t.plate), vehicleName: str(t.vehicleName),
      employeeId: Math.max(0, Math.trunc(num(t.employeeId))), vehicleId: Math.max(0, Math.trunc(num(t.vehicleId))), issue: str(t.issue),
    };
  });
}

/**
 * Records up to BOOK_LIMIT new trips in ReAI Driving Log, skipping trips that already exist.
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {{ token: string, tenantId: number }} auth
 * @param {MappedTrip[]} trips
 */
export async function bookTrips(env, auth, trips) {
  const earliest = trips.map((t) => t.date).sort()[0] ?? '';
  const keys = await existingTripKeys(env, auth, earliest);
  /** @type {Array<{ trip: MappedTrip, status: 'recorded' | 'duplicate' | 'skipped' | 'failed' | 'pending', detail: string }>} */
  const results = [];
  let posted = 0;
  for (const t of trips) {
    const body = { tripDate: t.date, fromLocation: t.from, toLocation: t.to, purpose: t.purpose, kilometers: t.km, roadTollAmount: t.toll, ...(t.employeeId > 0 ? { employeeId: t.employeeId } : {}), ...(t.vehicleId > 0 ? { vehicleId: t.vehicleId } : {}) };
    if (keys.has(tripKey({ tripDate: t.date, fromLocation: t.from, toLocation: t.to, kilometers: t.km }))) { results.push({ trip: t, status: 'duplicate', detail: 'Already in ReAI' }); continue; }
    if (t.issue) { results.push({ trip: t, status: 'skipped', detail: t.issue }); continue; }
    if (posted >= BOOK_LIMIT) { results.push({ trip: t, status: 'pending', detail: 'Next batch' }); continue; }
    posted += 1;
    try {
      const created = /** @type {{ id?: number }} */ (await reaiRequest(env, '/api/driving-log/trips', { ...auth, method: 'POST', body }));
      keys.add(tripKey(body));
      results.push({ trip: t, status: 'recorded', detail: `Trip #${created.id ?? ''}` });
    } catch (err) {
      results.push({ trip: t, status: 'failed', detail: err instanceof Error ? err.message : 'ReAI rejected the trip.' });
    }
  }
  return results;
}

/** @param {MappedTrip[]} trips @param {boolean} isSample */
function renderTrips(trips, isSample) {
  const totalKm = trips.reduce((s, t) => s + t.km, 0);
  const totalToll = trips.reduce((s, t) => s + t.toll, 0);
  const blocked = trips.filter((t) => t.issue).length;
  return reaiCard({
    eyebrow: 'VIATRACKS TRIPS → REAI DRIVING LOG',
    title: `${trips.length} business trips (${totalKm.toFixed(1)} km)`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : blocked ? reaiBadge({ text: `${blocked} need a vehicle`, tone: 'warn' }) : reaiBadge({ text: 'Ready to record', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Business trips', value: String(trips.length), detail: 'Private trips excluded' })}
        ${reaiMetric({ label: 'Distance', value: `${totalKm.toFixed(1)} km`, detail: 'ReAI applies the rate for the trip date' })}
        ${reaiMetric({ label: 'Road tolls', value: `${formatMinor(Math.round(totalToll * 100))} NOK`, detail: 'From toll expenses on the trip' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Route</th><th>Purpose</th><th>Driver / vehicle</th><th class="num">Km</th><th class="num">Tolls</th><th>ReAI</th></tr></thead>
        <tbody>${trips.map((t) => html`<tr>
          <td class="mono">${t.date}</td><td>${t.from} → ${t.to}</td><td>${t.purpose}${t.otherExpenses ? html`<br><span class="muted-note">Not included: ${t.otherExpenses}</span>` : ''}</td>
          <td>${t.driver || '—'}<br><span class="muted-note">${t.plate || t.vehicleName || '—'}</span></td>
          <td class="num">${t.km.toFixed(1)}</td><td class="num">${t.toll.toFixed(2)}</td>
          <td>${t.issue ? reaiBadge({ text: t.issue, tone: 'warn' }) : html`<span class="muted-note">${t.employeeId > 0 ? `Employee #${t.employeeId}` : 'No employee'}${t.vehicleId > 0 ? ` · Vehicle #${t.vehicleId}` : ''}</span>`}</td>
        </tr>`)}</tbody>
      </table></div>
      ${isSample
        ? reaiCallout({ tone: 'info', body: 'Sample ViaTracks trips loaded. Connect to ReAI and fetch with your ViaTracks API key to record real trips.' })
        : html`<form class="stack-sm confirm-box" hx-post="${BASE}/book" hx-target="#${SLUG}-book" hx-swap="innerHTML">
            <input type="hidden" name="tripsJson" value="${JSON.stringify(trips)}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I checked these trips against ViaTracks.</label>
            <div><button type="submit" class="button primary">Record trips in ReAI (up to ${BOOK_LIMIT} per click)</button></div>
          </form><div id="${SLUG}-book" class="stack-sm"></div>`}
      <p class="muted-note">Trips already in ReAI with the same date, route and distance are skipped, so you can click again to record the next batch. For vehicles with mileage allowance ReAI books the allowance and tolls; do not also reimburse them in ViaTracks or payroll.</p>
    `,
  });
}

/** @param {Awaited<ReturnType<typeof bookTrips>>} results */
function renderResults(results) {
  const count = (/** @type {string} */ s) => results.filter((r) => r.status === s).length;
  const pending = count('pending');
  return html`${reaiCallout({
    tone: count('failed') ? 'warn' : 'success',
    title: `Recorded ${count('recorded')} trips`,
    body: `${count('duplicate')} already in ReAI, ${count('skipped')} skipped, ${count('failed')} failed${pending ? `, ${pending} left for the next click` : ''}.`,
  })}
  <div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Route</th><th class="num">Km</th><th>Result</th></tr></thead>
  <tbody>${results.filter((r) => r.status !== 'pending').map((r) => html`<tr><td class="mono">${r.trip.date}</td><td>${r.trip.from} → ${r.trip.to}</td><td class="num">${r.trip.km.toFixed(1)}</td><td>${reaiBadge({ text: r.detail, tone: r.status === 'recorded' ? 'success' : r.status === 'failed' ? 'danger' : 'warn' })}</td></tr>`)}</tbody></table></div>`;
}

/**
 * Handles /app/viatracks/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE}/`, request.url), 301);
  if (pathname === `${BASE}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const { employees, vehicles } = await loadRefs(env, session);
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro"><p class="eyebrow">FLEET & DRIVING LOG (KJØREBOK)</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${SLUG}-web`, clientName: `ReAI ${BRAND} (Web)` })}
        ${reaiCard({
          eyebrow: 'LIVE VIATRACKS API',
          title: 'Fetch ViaTracks trips',
          body: html`<p class="muted-note">Devinco support (support@devinco.com) issues the subjectId and API key for a ViaTracks user that can see the vehicles. The key is used only for these requests and is never stored.</p>
            <form class="stack" hx-post="${BASE}/fetch-api" hx-target="#${SLUG}-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="vt-subject">subjectId</label><input id="vt-subject" name="subjectId" required autocomplete="off"></div>
                <div class="field"><label for="vt-key">API key</label><input id="vt-key" name="apiKey" type="password" required autocomplete="off"></div>
                <div class="field"><label for="vt-from">From date</label><input id="vt-from" name="fromDate" type="date" value="${today.slice(0, 7)}-01" required></div>
                <div class="field"><label for="vt-to">To date</label><input id="vt-to" name="toDate" type="date" value="${today}" required></div>
                <div class="field"><label for="vt-emp">Fallback ReAI employee</label><select id="vt-emp" name="employeeId"><option value="0">${employees.length ? 'Match driver by email or name' : 'Connect to ReAI first'}</option>${employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}</select></div>
                <div class="field"><label for="vt-veh">Fallback ReAI vehicle</label><select id="vt-veh" name="vehicleId"><option value="0">Match by registration number</option>${vehicles.map((v) => html`<option value="${v.id}">${v.name}${v.registrationNumber ? ` (${v.registrationNumber})` : ''}</option>`)}</select></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Fetch from ViaTracks</button>
                <button type="button" class="button secondary" hx-post="${BASE}/sample" hx-target="#${SLUG}-output" hx-swap="innerHTML">Load sample preview</button>
              </div>
            </form>`,
        })}
        <div id="${SLUG}-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE}/sample`) return htmlResponse(renderTrips(mapRefs(SAMPLE, { employees: [], vehicles: [] }, 0, 0), true));
  try {
    const form = await request.formData();
    if (pathname === `${BASE}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) if (typeof v === 'string') creds[k] = v;
      const trips = await fetchApi(creds);
      const session = await readSession(env, request);
      const refs = await loadRefs(env, session);
      return htmlResponse(renderTrips(mapRefs(trips, refs, Number(creds.employeeId ?? '0'), Number(creds.vehicleId ?? '0')), false));
    }
    if (pathname === `${BASE}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('confirm') !== 'on') throw new HttpError(400, 'Confirm the verification checkbox first.');
      const trips = parseTrips(String(form.get('tripsJson') ?? ''));
      return htmlResponse(renderResults(await bookTrips(env, { token: session.accessToken, tenantId: session.tenantId }, trips)));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
