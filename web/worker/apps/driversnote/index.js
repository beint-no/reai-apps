// @ts-check
import { isoDate, num } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiRequest } from '../../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/**
 * @typedef {{ id: string, date: string, from: string, to: string, purpose: string, km: number, driver: string, driverEmail: string, plate: string, vehicleName: string, state: string }} TripRow
 * @typedef {TripRow & { employeeId: number, vehicleId: number, issue: string }} MappedTrip
 * @typedef {{ id: number, name: string, email?: string | null }} EmployeeRef
 * @typedef {{ id: number, name: string, registrationNumber?: string | null, archived?: boolean }} VehicleRef
 * @typedef {{ distance?: number | null, amount?: number | null, rateAmount?: number | null, rate?: { amount?: number | null } | null }} Reimbursement
 */

const SLUG = 'driversnote';
const BRAND = 'Driversnote';
const BASE = `/app/${SLUG}`;
const TITLE = 'Driversnote Driving Log';
const LEAD = 'Fetch business trips or submitted team reports from the Driversnote API and record them in ReAI Driving Log, matched to employees and vehicles.';
const API = 'https://api.driversnote.com/v1/driversnote';
const PAGE = 100;
const MAX_CALLS = 20;
const BOOK_LIMIT = 30;
const DUP_PAGES = 5;
const MAX_KM = 2000;

const TRIPS_QUERY = `query Trips($startDate: ISO8601Date!, $endDate: ISO8601Date!, $tripTypeId: ID, $first: Int, $after: String) {
  trips(startDate: $startDate, endDate: $endDate, tripTypeId: $tripTypeId, first: $first, after: $after) {
    nodes { id startAt distance comment isDeleted isArchived startLocationPlaceholder stopLocationPlaceholder
      startLocation { name address } stopLocation { name address }
      tripType { id name } vehicle { name licensePlate }
      reimbursements { distance amount rate { amount } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const ITEM_FIELDS = `id startAt distance comment deletedAt outOfScope isMasked tripTypeName
      startLocationName startLocationAddress startLocationPlaceholder stopLocationName stopLocationAddress stopLocationPlaceholder
      reportItemReimbursements { distance amount rateAmount }`;

const TEAM_QUERY = `query TeamReports($startDate: ISO8601Date, $endDate: ISO8601Date, $first: Int, $after: String) {
  teamReports(startDate: $startDate, endDate: $endDate, first: $first, after: $after) {
    nodes { id state stateLabel teamMember { userName userEmail }
      report { id distanceUnit userName vehicle { name licensePlate }
        reportItems(first: ${PAGE}) { nodes { ${ITEM_FIELDS} } pageInfo { hasNextPage endCursor } } } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const REPORT_ITEMS_QUERY = `query ReportItems($id: ID!, $first: Int, $after: String) {
  report(id: $id) { reportItems(first: $first, after: $after) { nodes { ${ITEM_FIELDS} } pageInfo { hasNextPage endCursor } } }
}`;

/** @type {TripRow[]} */
const SAMPLE = [
  { id: 's1', date: '2026-10-05', from: 'Kontoret, Bergen', to: 'Kunde AS, Åsane', purpose: 'Kundemøte', km: 12.6, driver: 'Kari Nordmann', driverEmail: 'kari@example.no', plate: 'EK 12345', vehicleName: 'Privatbil', state: 'Approved' },
  { id: 's2', date: '2026-10-12', from: 'Kontoret, Bergen', to: 'Lager, Kokstad', purpose: 'Varelevering', km: 18.3, driver: 'Kari Nordmann', driverEmail: 'kari@example.no', plate: 'EK 12345', vehicleName: 'Privatbil', state: 'Approved' },
  { id: 's3', date: '2026-10-20', from: 'Hjemme, Os', to: 'Byggeplass, Fana', purpose: 'Befaring', km: 21.0, driver: 'Ola Nordmann', driverEmail: 'ola@example.no', plate: 'EL 67890', vehicleName: 'Tesla', state: 'Submitted' },
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
  const s = str(v);
  const t = Date.parse(s);
  if (Number.isNaN(t)) return isoDate(s, fallback);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

/**
 * Converts a Driversnote distance to kilometres. The API does not state the unit of `distance`; when a
 * reimbursement has amount, rate and distance, the ratio amount / rate shows whether distance is in whole
 * distance units or in metres. Without that evidence metres are assumed, which can only understate a trip.
 * @param {unknown} distance
 * @param {Reimbursement[]} reimbursements
 */
export function kmFromDistance(distance, reimbursements) {
  const d = num(distance);
  if (!(d > 0)) return 0;
  for (const r of reimbursements) {
    const rate = num(r.rateAmount ?? r.rate?.amount);
    const amount = num(r.amount);
    const rd = num(r.distance);
    if (rate > 0 && amount > 0 && rd > 0) {
      const units = amount / rate;
      if (Math.abs(units - rd) / units < 0.05) return Number(d.toFixed(1));
      if (Math.abs(units - rd / 1000) / units < 0.05) return Number((d / 1000).toFixed(1));
    }
  }
  return Number((d / 1000).toFixed(1));
}

/**
 * Posts one GraphQL operation. GraphQL errors arrive with HTTP 200 and an `errors` array.
 * @param {string} apiKey
 * @param {string} query
 * @param {Record<string, unknown>} variables
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 */
async function gql(apiKey, query, variables, fetchImpl) {
  const res = await fetchImpl(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ query, variables }),
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 429) throw new HttpError(429, 'Driversnote is throttling requests. Wait a minute and try again.');
  if (!res.ok) throw new HttpError(400, `Driversnote API ${res.status === 401 || res.status === 403 ? 'rejected the API key' : `returned HTTP ${res.status}`}.`);
  const body = /** @type {any} */ (await res.json());
  if (Array.isArray(body?.errors) && body.errors.length) throw new HttpError(400, `Driversnote: ${str(body.errors[0]?.message) || 'query failed'}.`);
  return body?.data ?? {};
}

/**
 * Maps a Driversnote Trip (own trips) to a row; non business, deleted and archived trips return null.
 * @param {any} t
 * @param {string} fallbackDate
 * @returns {TripRow | null}
 */
export function mapOwnTrip(t, fallbackDate) {
  if (!t || t.isDeleted === true || t.isArchived === true) return null;
  if (str(t.tripType?.id) !== 'business') return null;
  const km = kmFromDistance(t.distance, Array.isArray(t.reimbursements) ? t.reimbursements : []);
  if (!(km >= 0.1)) return null;
  return {
    id: str(t.id),
    date: osloDay(t.startAt, fallbackDate),
    from: (str(t.startLocation?.name) || str(t.startLocation?.address) || str(t.startLocationPlaceholder) || 'Start').slice(0, 255),
    to: (str(t.stopLocation?.name) || str(t.stopLocation?.address) || str(t.stopLocationPlaceholder) || 'Destination').slice(0, 255),
    purpose: (str(t.comment) || 'Business trip (Driversnote)').slice(0, 500),
    km,
    driver: '',
    driverEmail: '',
    plate: str(t.vehicle?.licensePlate),
    vehicleName: str(t.vehicle?.name),
    state: '',
  };
}

/**
 * Maps a ReportItem from a team report; deleted, masked, out of scope and private items return null.
 * @param {any} it
 * @param {any} tr TeamReport
 * @param {string} fallbackDate
 * @returns {TripRow | null}
 */
export function mapReportItem(it, tr, fallbackDate) {
  if (!it || it.deletedAt || it.outOfScope === true || it.isMasked === true) return null;
  if (/priv|commut/i.test(str(it.tripTypeName))) return null;
  const km = kmFromDistance(it.distance, Array.isArray(it.reportItemReimbursements) ? it.reportItemReimbursements : []);
  if (!(km >= 0.1)) return null;
  return {
    id: str(it.id),
    date: osloDay(it.startAt, fallbackDate),
    from: (str(it.startLocationName) || str(it.startLocationAddress) || str(it.startLocationPlaceholder) || 'Start').slice(0, 255),
    to: (str(it.stopLocationName) || str(it.stopLocationAddress) || str(it.stopLocationPlaceholder) || 'Destination').slice(0, 255),
    purpose: (str(it.comment) || 'Business trip (Driversnote)').slice(0, 500),
    km,
    driver: str(tr?.teamMember?.userName) || str(tr?.report?.userName),
    driverEmail: str(tr?.teamMember?.userEmail).toLowerCase(),
    plate: str(tr?.report?.vehicle?.licensePlate),
    vehicleName: str(tr?.report?.vehicle?.name),
    state: str(tr?.stateLabel) || str(tr?.state),
  };
}

/**
 * Fetches business trips from the Driversnote GraphQL API: either the key owner's trips or the reports submitted to
 * the first team the key owner manages.
 * Docs: https://api.driversnote.com/docs/ (POST https://api.driversnote.com/v1/driversnote, x-api-key header;
 * queries trips(startDate, endDate, tripTypeId, first, after), teamReports(startDate, endDate, first, after; teamId
 * defaults to the first team), report(id) { reportItems }; types Trip, TeamReport, Report, ReportItem, PageInfo).
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<TripRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const apiKey = (creds.apiKey ?? '').trim();
  if (!apiKey) throw new HttpError(400, 'Enter your Driversnote API key.');
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (from > to) throw new HttpError(400, 'From date must be on or before to date.');
  const mode = creds.mode === 'team' ? 'team' : 'own';
  /** @type {TripRow[]} */ const rows = [];
  let calls = 0;
  const call = async (/** @type {string} */ q, /** @type {Record<string, unknown>} */ v) => {
    calls += 1;
    if (calls > MAX_CALLS) throw new HttpError(400, 'Driversnote returned too many trips for one fetch. Choose a shorter period.');
    return gql(apiKey, q, v, fetchImpl);
  };

  if (mode === 'own') {
    let after = '';
    do {
      const data = await call(TRIPS_QUERY, { startDate: from, endDate: to, tripTypeId: 'business', first: PAGE, ...(after ? { after } : {}) });
      /** @type {any[]} */ const nodes = Array.isArray(data?.trips?.nodes) ? data.trips.nodes : [];
      for (const t of nodes) { const r = mapOwnTrip(t, from); if (r) rows.push(r); }
      after = data?.trips?.pageInfo?.hasNextPage ? str(data.trips.pageInfo.endCursor) : '';
    } while (after);
  } else {
    let after = '';
    do {
      const data = await call(TEAM_QUERY, { startDate: from, endDate: to, first: 20, ...(after ? { after } : {}) });
      /** @type {any[]} */ const reports = Array.isArray(data?.teamReports?.nodes) ? data.teamReports.nodes : [];
      for (const tr of reports) {
        if (/reject|change/i.test(str(tr?.state))) continue;
        const unit = str(tr?.report?.distanceUnit).toLowerCase();
        if (unit && !/^(km|kilomet)/.test(unit)) throw new HttpError(400, `A Driversnote report uses distance unit "${unit}". Only kilometres can be recorded in ReAI.`);
        /** @type {any[]} */ const items = [...(tr?.report?.reportItems?.nodes ?? [])];
        let page = tr?.report?.reportItems?.pageInfo;
        while (page?.hasNextPage && str(page.endCursor) && str(tr?.report?.id)) {
          const more = await call(REPORT_ITEMS_QUERY, { id: str(tr.report.id), first: PAGE, after: str(page.endCursor) });
          items.push(...(more?.report?.reportItems?.nodes ?? []));
          page = more?.report?.reportItems?.pageInfo;
        }
        for (const it of items) { const r = mapReportItem(it, tr, from); if (r) rows.push(r); }
      }
      after = data?.teamReports?.pageInfo?.hasNextPage ? str(data.teamReports.pageInfo.endCursor) : '';
    } while (after);
  }
  const inRange = rows.filter((r) => r.date >= from && r.date <= to);
  if (inRange.length === 0) throw new HttpError(400, mode === 'team' ? `Driversnote has no team report trips from ${from} to ${to}. The key owner must be admin or manager of the team.` : `Driversnote has no business trips from ${from} to ${to}.`);
  return inRange;
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
 * Reads existing ReAI driving log trips back to the earliest date (the list is sorted by trip date descending).
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
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_CALLS * PAGE * 2) throw new HttpError(400, 'No trips to record. Fetch the trips again.');
  return parsed.map((/** @type {any} */ t) => {
    const km = Number(t?.km);
    const date = String(t?.date ?? '');
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !(km >= 0.1 && km <= MAX_KM)) throw new HttpError(400, 'A trip has an invalid date or distance. Fetch the trips again.');
    return {
      id: str(t.id), date, from: str(t.from).slice(0, 255) || 'Start', to: str(t.to).slice(0, 255) || 'Destination', purpose: str(t.purpose).slice(0, 500) || 'Business trip',
      km: Number(km.toFixed(1)), driver: str(t.driver), driverEmail: str(t.driverEmail), plate: str(t.plate), vehicleName: str(t.vehicleName), state: str(t.state),
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
    const body = { tripDate: t.date, fromLocation: t.from, toLocation: t.to, purpose: t.purpose, kilometers: t.km, roadTollAmount: 0, ...(t.employeeId > 0 ? { employeeId: t.employeeId } : {}), ...(t.vehicleId > 0 ? { vehicleId: t.vehicleId } : {}) };
    if (keys.has(tripKey(body))) { results.push({ trip: t, status: 'duplicate', detail: 'Already in ReAI' }); continue; }
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
  const drivers = new Set(trips.map((t) => t.driverEmail || t.driver).filter(Boolean)).size;
  return reaiCard({
    eyebrow: 'DRIVERSNOTE TRIPS → REAI DRIVING LOG',
    title: `${trips.length} business trips (${totalKm.toFixed(1)} km)`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : blocked ? reaiBadge({ text: `${blocked} need a vehicle`, tone: 'warn' }) : reaiBadge({ text: 'Ready to record', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Business trips', value: String(trips.length), detail: 'Private trips excluded' })}
        ${reaiMetric({ label: 'Distance', value: `${totalKm.toFixed(1)} km`, detail: 'ReAI applies the rate for the trip date' })}
        ${reaiMetric({ label: 'Drivers', value: String(drivers || 1), detail: 'Matched by email or name' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Route</th><th>Purpose</th><th>Driver / vehicle</th><th class="num">Km</th><th>ReAI</th></tr></thead>
        <tbody>${trips.map((t) => html`<tr>
          <td class="mono">${t.date}</td><td>${t.from} → ${t.to}</td><td>${t.purpose}${t.state ? html`<br><span class="muted-note">Report: ${t.state}</span>` : ''}</td>
          <td>${t.driver || 'Key owner'}<br><span class="muted-note">${t.plate || t.vehicleName || '—'}</span></td>
          <td class="num">${t.km.toFixed(1)}</td>
          <td>${t.issue ? reaiBadge({ text: t.issue, tone: 'warn' }) : html`<span class="muted-note">${t.employeeId > 0 ? `Employee #${t.employeeId}` : 'No employee'}${t.vehicleId > 0 ? ` · Vehicle #${t.vehicleId}` : ''}</span>`}</td>
        </tr>`)}</tbody>
      </table></div>
      ${isSample
        ? reaiCallout({ tone: 'info', body: 'Sample Driversnote trips loaded. Connect to ReAI and fetch with your Driversnote API key to record real trips.' })
        : html`<form class="stack-sm confirm-box" hx-post="${BASE}/book" hx-target="#${SLUG}-book" hx-swap="innerHTML">
            <input type="hidden" name="tripsJson" value="${JSON.stringify(trips)}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I checked these trips against Driversnote.</label>
            <div><button type="submit" class="button primary">Record trips in ReAI (up to ${BOOK_LIMIT} per click)</button></div>
          </form><div id="${SLUG}-book" class="stack-sm"></div>`}
      <p class="muted-note">Trips already in ReAI with the same date, route and distance are skipped, so you can click again to record the next batch. Driversnote has no toll amounts, so add tolls in ReAI if needed. For vehicles with mileage allowance ReAI books the allowance; do not also pay it from the Driversnote report.</p>
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
 * Handles /app/driversnote/* routes.
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
          eyebrow: 'LIVE DRIVERSNOTE API',
          title: 'Fetch Driversnote trips',
          body: html`<p class="muted-note">Create the key in Driversnote at driversnote.com/app/api-keys. For team reports the key owner must be admin or manager of the team. The key is used only for these requests and is never stored.</p>
            <form class="stack" hx-post="${BASE}/fetch-api" hx-target="#${SLUG}-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="dn-key">Driversnote API key</label><input id="dn-key" name="apiKey" type="password" required autocomplete="off"></div>
                <div class="field"><label for="dn-mode">Trips</label><select id="dn-mode" name="mode"><option value="own">My business trips</option><option value="team">Reports submitted to my team</option></select></div>
                <div class="field"><label for="dn-from">From date</label><input id="dn-from" name="fromDate" type="date" value="${today.slice(0, 7)}-01" required></div>
                <div class="field"><label for="dn-to">To date</label><input id="dn-to" name="toDate" type="date" value="${today}" required></div>
                <div class="field"><label for="dn-emp">ReAI employee (my trips, or fallback)</label><select id="dn-emp" name="employeeId"><option value="0">${employees.length ? 'Match team member by email or name' : 'Connect to ReAI first'}</option>${employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}</select></div>
                <div class="field"><label for="dn-veh">Fallback ReAI vehicle</label><select id="dn-veh" name="vehicleId"><option value="0">Match by registration number</option>${vehicles.map((v) => html`<option value="${v.id}">${v.name}${v.registrationNumber ? ` (${v.registrationNumber})` : ''}</option>`)}</select></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Fetch from Driversnote</button>
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
