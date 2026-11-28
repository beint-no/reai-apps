// @ts-check
import { isoDate, num } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiRequest } from '../../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/**
 * @typedef {{ id: string, date: string, from: string, to: string, purpose: string, km: number, toll: number, otherExpenses: string, driver: string, driverEmail: string, plate: string, vehicleName: string }} TripRow
 * @typedef {TripRow & { employeeId: number, vehicleId: number, issue: string }} MappedTrip
 * @typedef {{ id: number, name: string, email?: string | null }} EmployeeRef
 * @typedef {{ id: number, name: string, registrationNumber?: string | null, archived?: boolean }} VehicleRef
 */

const SLUG = 'mapon';
const BRAND = 'Mapon';
const BASE = `/app/${SLUG}`;
const TITLE = 'Mapon Driving Log';
const LEAD = 'Fetch business routes from the Mapon API, also used by Tracksys Pro, and record them in ReAI Driving Log, matched to employees and vehicles.';
const API = 'https://mapon.com/api/v1';
const MAX_DAYS = 30;
const BOOK_LIMIT = 30;
const DUP_PAGES = 5;
const MAX_KM = 2000;
const MAX_TRIPS = 3000;

/** @type {TripRow[]} */
const SAMPLE = [
  { id: 's1', date: '2026-10-06', from: 'Brobekkveien 80, Oslo', to: 'Alnabru, Oslo', purpose: 'Levering', km: 6.2, toll: 0, otherExpenses: '', driver: 'Kari Nordmann', driverEmail: 'kari@example.no', plate: 'EK 12345', vehicleName: 'Varebil 1' },
  { id: 's2', date: '2026-10-08', from: 'Brobekkveien 80, Oslo', to: 'Lillestrøm', purpose: 'Service hos kunde', km: 19.8, toll: 0, otherExpenses: '', driver: 'Kari Nordmann', driverEmail: 'kari@example.no', plate: 'EK 12345', vehicleName: 'Varebil 1' },
  { id: 's3', date: '2026-10-13', from: 'Brobekkveien 80, Oslo', to: 'Ski', purpose: 'Montering', km: 27.5, toll: 0, otherExpenses: '', driver: 'Ola Nordmann', driverEmail: 'ola@example.no', plate: 'EL 67890', vehicleName: 'Varebil 2' },
];

/** @param {unknown} v */
function str(v) {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

/** @param {string} s */
const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** @param {string} s */
const plateKey = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** @param {unknown} v @param {string} fallback */
function osloDay(v, fallback) {
  const t = Date.parse(str(v));
  if (Number.isNaN(t)) return fallback;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

/** @param {string} day @param {number} delta */
function addDays(day, delta) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);
}

/**
 * GET one Mapon action. The key goes in the documented `key` header; API errors come as `{ error: { code, msg } }`.
 * @param {string} action e.g. `route/list`
 * @param {URLSearchParams} query
 * @param {string} apiKey
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 */
async function maponGet(action, query, apiKey, fetchImpl) {
  const res = await fetchImpl(`${API}/${action}.json?${query}`, { headers: { key: apiKey, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(25_000) });
  if (res.status === 429) throw new HttpError(429, 'Mapon is limiting requests. Wait a minute and try again.');
  if (!res.ok) throw new HttpError(400, `Mapon API returned HTTP ${res.status}. Check the API key.`);
  const body = /** @type {any} */ (await res.json());
  if (body?.error) {
    const code = Number(body.error.code);
    const why = code === 1004 || code === 1005 ? 'the API key was not found' : code === 1008 ? 'the API key has no vehicles' : code === 1011 ? 'the request limit is reached' : code === 1006 || code === 1013 ? 'the API key lacks access to this action' : str(body.error.msg) || `error ${code}`;
    throw new HttpError(400, `Mapon: ${why}.`);
  }
  return body?.data;
}

/**
 * Maps one Mapon route of type "route" to a trip row. Distance is metres (the documented example has 15770 for a
 * 16 minute route at 52 km/h average).
 * @param {any} r
 * @param {{ number: string, label: string }} unit
 * @param {Map<string, { name: string, email: string }>} drivers
 * @param {string} fallbackDate
 * @returns {TripRow | null}
 */
export function mapRoute(r, unit, drivers, fallbackDate) {
  if (!r || r.type !== 'route') return null;
  const km = Number((num(r.distance) / 1000).toFixed(1));
  if (!(km >= 0.1)) return null;
  const driver = drivers.get(str(r.driver_id));
  return {
    id: str(r.route_id),
    date: osloDay(r.start?.time, fallbackDate),
    from: (str(r.start?.address) || 'Start').slice(0, 255),
    to: (str(r.end?.address) || 'Destination').slice(0, 255),
    purpose: (str(r.route_details?.explanation) || str(r.route_fields?.client_title) || 'Business trip (Mapon)').slice(0, 500),
    km,
    toll: 0,
    otherExpenses: '',
    driver: driver?.name ?? '',
    driverEmail: driver?.email ?? '',
    plate: unit.number,
    vehicleName: unit.label,
  };
}

/**
 * Fetches business routes for all units of the API key from the Mapon API v1.
 * Docs: https://mapon.com/api/ (Authentication: `key` query parameter or header; Limits: 5 concurrent requests;
 * route/list with from, till (UTC, at most 31 days per call, so longer periods are split), route_types=business, include=driver_id and route_details;
 * unit/list for `number` and `label`; driver/list for `name`, `surname`, `email`).
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<TripRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const apiKey = (creds.apiKey ?? '').trim();
  if (!apiKey) throw new HttpError(400, 'Enter your Mapon API key.');
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (from > to) throw new HttpError(400, 'From date must be on or before to date.');
  const spanDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  if (spanDays > MAX_DAYS * 2) throw new HttpError(400, `Choose at most ${MAX_DAYS * 2} days per fetch.`);
  // route/list accepts at most 31 days, so the period is split into windows of at most 30 Oslo days. Each window
  // starts two hours before UTC midnight; rows are filtered on the Oslo date afterwards.
  /** @type {URLSearchParams[]} */ const windows = [];
  for (let start = from; start <= to; start = addDays(start, MAX_DAYS)) {
    const end = addDays(start, MAX_DAYS - 1) < to ? addDays(start, MAX_DAYS - 1) : to;
    const q = new URLSearchParams({ from: `${addDays(start, -1)}T22:00:00Z`, till: `${end}T23:59:59Z`, route_types: 'business' });
    q.append('include[]', 'driver_id');
    q.append('include[]', 'route_details');
    q.append('include[]', 'route_fields');
    windows.push(q);
  }
  const [unitData, driverData, ...routeData] = await Promise.all([
    maponGet('unit/list', new URLSearchParams(), apiKey, fetchImpl),
    maponGet('driver/list', new URLSearchParams(), apiKey, fetchImpl).catch(() => ({ drivers: [] })),
    ...windows.map((q) => maponGet('route/list', q, apiKey, fetchImpl)),
  ]);
  /** @type {Map<string, { number: string, label: string }>} */ const units = new Map();
  for (const u of Array.isArray(unitData?.units) ? unitData.units : []) units.set(str(u.unit_id), { number: str(u.number), label: str(u.label) || [str(u.make), str(u.model)].filter(Boolean).join(' ') });
  /** @type {Map<string, { name: string, email: string }>} */ const drivers = new Map();
  for (const d of Array.isArray(driverData?.drivers) ? driverData.drivers : []) drivers.set(str(d.id), { name: `${str(d.name)} ${str(d.surname)}`.trim(), email: str(d.email).toLowerCase() });
  /** @type {TripRow[]} */ const rows = [];
  /** @type {Set<string>} */ const seen = new Set();
  for (const u of routeData.flatMap((d) => (Array.isArray(d?.units) ? d.units : []))) {
    const unit = units.get(str(u.unit_id)) ?? { number: '', label: `Unit ${str(u.unit_id)}` };
    for (const r of Array.isArray(u.routes) ? u.routes : []) {
      const row = mapRoute(r, unit, drivers, from);
      if (row && row.date >= from && row.date <= to && !seen.has(row.id)) { seen.add(row.id); rows.push(row); }
    }
  }
  if (rows.length > MAX_TRIPS) throw new HttpError(400, 'Mapon returned too many routes. Choose a shorter period.');
  if (rows.length === 0) throw new HttpError(400, `Mapon returned no business routes from ${from} to ${to}.`);
  return rows.sort((a, b) => a.date.localeCompare(b.date));
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
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_TRIPS) throw new HttpError(400, 'No trips to record. Fetch the trips again.');
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
  const blocked = trips.filter((t) => t.issue).length;
  return reaiCard({
    eyebrow: 'MAPON TRIPS → REAI DRIVING LOG',
    title: `${trips.length} business trips (${totalKm.toFixed(1)} km)`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : blocked ? reaiBadge({ text: `${blocked} need a vehicle`, tone: 'warn' }) : reaiBadge({ text: 'Ready to record', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Business trips', value: String(trips.length), detail: 'Private trips excluded' })}
        ${reaiMetric({ label: 'Distance', value: `${totalKm.toFixed(1)} km`, detail: 'ReAI applies the rate for the trip date' })}
        ${reaiMetric({ label: 'Vehicles', value: String(new Set(trips.map((t) => t.plate || t.vehicleName)).size), detail: 'Matched by registration number' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Route</th><th>Purpose</th><th>Driver / vehicle</th><th class="num">Km</th><th>ReAI</th></tr></thead>
        <tbody>${trips.map((t) => html`<tr>
          <td class="mono">${t.date}</td><td>${t.from} → ${t.to}</td><td>${t.purpose}${t.otherExpenses ? html`<br><span class="muted-note">Not included: ${t.otherExpenses}</span>` : ''}</td>
          <td>${t.driver || '—'}<br><span class="muted-note">${t.plate || t.vehicleName || '—'}</span></td>
          <td class="num">${t.km.toFixed(1)}</td>
          <td>${t.issue ? reaiBadge({ text: t.issue, tone: 'warn' }) : html`<span class="muted-note">${t.employeeId > 0 ? `Employee #${t.employeeId}` : 'No employee'}${t.vehicleId > 0 ? ` · Vehicle #${t.vehicleId}` : ''}</span>`}</td>
        </tr>`)}</tbody>
      </table></div>
      ${isSample
        ? reaiCallout({ tone: 'info', body: 'Sample Mapon trips loaded. Connect to ReAI and fetch with your Mapon API key to record real trips.' })
        : html`<form class="stack-sm confirm-box" hx-post="${BASE}/book" hx-target="#${SLUG}-book" hx-swap="innerHTML">
            <input type="hidden" name="tripsJson" value="${JSON.stringify(trips)}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I checked these trips against Mapon.</label>
            <div><button type="submit" class="button primary">Record trips in ReAI (up to ${BOOK_LIMIT} per click)</button></div>
          </form><div id="${SLUG}-book" class="stack-sm"></div>`}
      <p class="muted-note">Trips already in ReAI with the same date, route and distance are skipped, so you can click again to record the next batch. For vehicles with mileage allowance ReAI books the allowance; Mapon has no toll amounts, so add tolls in ReAI if needed. Do not also reimburse the trips in payroll.</p>
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
 * Handles /app/mapon/* routes.
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
          eyebrow: 'LIVE MAPON API',
          title: 'Fetch Mapon business routes',
          body: html`<p class="muted-note">A company administrator creates the API key in Mapon. Tracksys Pro customers ask Tracksys if the menu is missing. Fetch at most two months at a time. The key is used only for these requests and is never stored.</p>
            <form class="stack" hx-post="${BASE}/fetch-api" hx-target="#${SLUG}-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="mp-key">Mapon API key</label><input id="mp-key" name="apiKey" type="password" required autocomplete="off"></div>
                <div class="field"><label for="mp-from">From date</label><input id="mp-from" name="fromDate" type="date" value="${today.slice(0, 7)}-01" required></div>
                <div class="field"><label for="mp-to">To date</label><input id="mp-to" name="toDate" type="date" value="${today}" required></div>
                <div class="field"><label for="mp-emp">Fallback ReAI employee</label><select id="mp-emp" name="employeeId"><option value="0">${employees.length ? 'Match driver by email or name' : 'Connect to ReAI first'}</option>${employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}</select></div>
                <div class="field"><label for="mp-veh">Fallback ReAI vehicle</label><select id="mp-veh" name="vehicleId"><option value="0">Match by registration number</option>${vehicles.map((v) => html`<option value="${v.id}">${v.name}${v.registrationNumber ? ` (${v.registrationNumber})` : ''}</option>`)}</select></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Fetch from Mapon</button>
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
