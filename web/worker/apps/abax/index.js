// @ts-check
import { fetchJson, isoDate, num, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/** @typedef {{ id: string, date: string, from: string, to: string, purpose: string, km: number, toll: number, driver: string, driverEmail: string, passenger: string, passengerKm: number }} TripRow */
/** @typedef {{ id: number, name: string, email?: string, registrationNumber?: string }} SimpleItem */
/** @typedef {{ tripDate: string, kilometers: number, fromLocation: string, toLocation: string, id: number }} ReaiTrip */

const API = 'https://api.abax.cloud';
const TOKEN_URL = 'https://identity.abax.cloud/connect/token';
const PAGE_SIZE = 1500;
const MAX_TRIP_PAGES = 4;
const MAX_BUSINESS_TRIPS = 1500;
const EXPENSE_BATCH = 150;

/** @type {TripRow[]} */
const SAMPLE_TRIPS = [
  { id: 'demo-1', date: '2026-10-14', from: 'N 0150, Oslo, Karl Johans gate', to: 'N 3015, Drammen, Grønland', purpose: 'Kundemøte og befaring', km: 42.5, toll: 88, driver: 'Demo Driver', driverEmail: '', passenger: '', passengerKm: 0 },
  { id: 'demo-2', date: '2026-10-16', from: 'N 0150, Oslo, Karl Johans gate', to: 'N 2060, Gardermoen, Edvard Munchs veg', purpose: 'Levering og service', km: 51.2, toll: 64, driver: 'Demo Driver', driverEmail: '', passenger: '', passengerKm: 0 },
];

/** @param {string} iso @param {number} days */
function addDays(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** @param {string} iso */
function osloDate(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

/**
 * Returns the UTC instant of 00:00 Europe/Oslo on a calendar day.
 * @param {string} day yyyy-MM-dd
 */
function osloMidnightMs(day) {
  const utc = Date.parse(`${day}T00:00:00Z`);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', hourCycle: 'h23' }).format(new Date(utc)));
  return utc - hour * 3_600_000;
}

/**
 * Performs one ABAX GET with documented 429 handling (default quota 60 requests per 60 seconds).
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 * @returns {Promise<any>}
 */
async function abaxGet(url, headers, fetchImpl) {
  const res = await fetchImpl(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  if (res.status === 429) throw new HttpError(429, 'ABAX rate limit reached (60 requests per minute). Wait a minute and fetch again.');
  if (res.status === 401 || res.status === 403) throw new HttpError(400, 'ABAX rejected the token. The credentials need the open_platform.trips scope and an administrator account.');
  if (!res.ok) throw new HttpError(400, `ABAX API returned HTTP ${res.status}.`);
  return res.json();
}

/**
 * Fetches business trips and toll expenses from the ABAX Open Platform API V4 (4.0.0).
 * Docs: https://developers.abax.cloud/getting-started (client credentials flow, POST
 * https://identity.abax.cloud/connect/token with scopes open_api and open_platform.trips; 60 requests per 60 s),
 * https://developers.abax.cloud/migration-guide and https://developers.abax.cloud/documentation/api (V4 toggle):
 * GET /v4/trips (page, page_size ≤ 1500, date_from/date_to in UTC, at most 3 months; distance in meters;
 * commercial_class) and GET /v4/trips/expense?trip_ids= (up to 150 ids; expense.toll_charge, toll_road_admin;
 * extra.passenger_name, distance_with_passenger_in_km).
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<TripRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const clientId = (creds.clientId ?? '').trim();
  const clientSecret = (creds.clientSecret ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!clientId || !clientSecret) throw new HttpError(400, 'Enter the ABAX client ID and client secret.');
  if (to < from) throw new HttpError(400, 'The to date must be on or after the from date.');
  const limit = new Date(Date.parse(`${from}T00:00:00Z`));
  limit.setUTCMonth(limit.getUTCMonth() + 3);
  if (Date.parse(`${addDays(to, 1)}T00:00:00Z`) > limit.getTime()) {
    throw new HttpError(400, 'ABAX allows at most 3 months per request. Choose a shorter period.');
  }
  const login = await fetchJson(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'open_api open_platform.trips', client_id: clientId, client_secret: clientSecret }).toString(),
  }, 'ABAX', fetchImpl);
  const token = typeof login?.access_token === 'string' ? login.access_token : '';
  if (!token) throw new HttpError(400, 'ABAX did not return an access token. Check that client credentials flow is enabled for this client.');
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const driverEmail = (creds.driverEmail ?? '').trim().toLowerCase();

  /** @type {any[]} */ const trips = [];
  for (let page = 1; page <= MAX_TRIP_PAGES; page++) {
    const query = new URLSearchParams({
      page: String(page),
      page_size: String(PAGE_SIZE),
      date_from: new Date(osloMidnightMs(from)).toISOString(),
      date_to: new Date(osloMidnightMs(addDays(to, 1))).toISOString(),
    });
    const data = await abaxGet(`${API}/v4/trips?${query}`, headers, fetchImpl);
    /** @type {any[]} */ const items = Array.isArray(data?.items) ? data.items : [];
    trips.push(...items);
    if (items.length < PAGE_SIZE) break;
    if (page === MAX_TRIP_PAGES) throw new HttpError(400, 'ABAX returned too many trips. Choose a shorter period.');
  }
  const business = [...new Map(trips.map((t) => [String(t?.id), t])).values()].filter((t) => t?.commercial_class === 'BusinessTrip'
    && (!driverEmail || String(t.driver?.email ?? '').trim().toLowerCase() === driverEmail));
  if (business.length > MAX_BUSINESS_TRIPS) throw new HttpError(400, `ABAX returned more than ${MAX_BUSINESS_TRIPS} business trips. Choose a shorter period or one driver.`);

  /** @type {Map<string, any>} */ const expenses = new Map();
  /** @type {string[][]} */ const batches = [];
  for (let i = 0; i < business.length; i += EXPENSE_BATCH) batches.push(business.slice(i, i + EXPENSE_BATCH).map((t) => String(t.id)));
  for (let i = 0; i < batches.length; i += 3) {
    const results = await Promise.all(batches.slice(i, i + 3).map((ids) => {
      const query = new URLSearchParams();
      for (const id of ids) query.append('trip_ids', id);
      return abaxGet(`${API}/v4/trips/expense?${query}`, headers, fetchImpl);
    }));
    for (const data of results) {
      for (const e of /** @type {any[]} */ (Array.isArray(data?.items) ? data.items : [])) expenses.set(String(e.trip_id), e);
    }
  }

  const rows = business
    .map((t) => {
      const e = expenses.get(String(t.id));
      const tollMinor = Math.round(num(e?.expense?.toll_charge) * 100) + Math.round(num(e?.expense?.toll_road_admin) * 100);
      const passenger = String(e?.extra?.passenger_name ?? '').trim();
      return {
        id: String(t.id),
        date: osloDate(String(t.start?.location?.timestamp ?? '')),
        from: String(t.start?.address ?? '').trim().slice(0, 200) || 'Start',
        to: String(t.finish?.address ?? '').trim().slice(0, 200) || 'Destination',
        purpose: String(t.purpose || t.notes || '').trim() || 'Business trip',
        km: Number((num(t.distance) / 1000).toFixed(1)),
        toll: tollMinor / 100,
        driver: String(t.driver?.name ?? '').trim(),
        driverEmail: String(t.driver?.email ?? '').trim().toLowerCase(),
        passenger,
        passengerKm: passenger ? Number(num(e?.extra?.distance_with_passenger_in_km).toFixed(1)) : 0,
      };
    })
    .filter((t) => t.km >= 0.1 && t.date >= from && t.date <= to)
    .sort((x, y) => x.date.localeCompare(y.date));
  if (rows.length === 0) throw new HttpError(400, `ABAX returned no business trips for ${from} to ${to}.`);
  return rows;
}

/**
 * Chooses the ReAI employee per trip: same email as the ABAX driver, else the selected employee when every trip has one driver.
 * @param {TripRow[]} trips
 * @param {SimpleItem[]} employees
 * @param {number} selected
 */
function employeeForTrips(trips, employees, selected) {
  /** @type {Map<string, number>} */ const byEmail = new Map(employees.filter((e) => e.email).map((e) => [String(e.email).trim().toLowerCase(), e.id]));
  const singleDriver = new Set(trips.map((t) => t.driverEmail || t.driver)).size <= 1;
  return trips.map((t) => (t.driverEmail && byEmail.get(t.driverEmail)) || (singleDriver ? selected : 0));
}

/**
 * Returns the id of an existing ReAI trip with the same date, distance and route, or 0.
 * @param {TripRow} t
 * @param {ReaiTrip[]} existing
 */
function existingTrip(t, existing) {
  return existing.find((x) => x.tripDate === t.date && Math.abs(Number(x.kilometers) - t.km) < 0.05 && x.fromLocation === t.from && x.toLocation === t.to)?.id ?? 0;
}

/** @param {TripRow[]} trips @param {number[]} employeeIds @param {number[]} existingIds @param {number} vehicleId @param {boolean} isSample */
function renderTrips(trips, employeeIds, existingIds, vehicleId, isSample) {
  const totalKm = trips.reduce((s, t) => s + t.km, 0);
  const totalTollMinor = trips.reduce((s, t) => s + Math.round(t.toll * 100), 0);
  return reaiCard({
    eyebrow: 'ABAX → REAI DRIVING LOG',
    title: `${trips.length} business trips (${totalKm.toFixed(1)} km)`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Ready to record', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Business trips', value: String(trips.length), detail: 'Private trips and commutes excluded' })}
        ${reaiMetric({ label: 'Distance', value: `${totalKm.toFixed(1)} km`, detail: 'ReAI applies the mileage rate' })}
        ${reaiMetric({ label: 'Road tolls', value: `${formatMinor(totalTollMinor)} NOK`, detail: 'From ABAX trip expenses' })}
      </div>
      <p class="muted-note">Trips go to the ReAI employee with the same email as the ABAX driver. The selected employee is used when every trip has one driver.</p>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Route</th><th>Purpose</th><th class="num">Km</th><th class="num">Tolls</th><th>Action</th></tr></thead>
        <tbody>${trips.map((t, idx) => {
          const employeeId = employeeIds[idx] ?? 0;
          const existsId = existingIds[idx] ?? 0;
          return html`<tr id="ab-t-${idx}">
          <td class="mono">${t.date}</td><td>${t.from} → ${t.to}${t.driver ? html`<br><span class="muted-note">${t.driver}${t.passenger ? ` · passenger ${t.passenger}` : ''}</span>` : ''}</td><td>${t.purpose}</td>
          <td class="num">${t.km.toFixed(1)}</td><td class="num">${t.toll.toFixed(2)}</td>
          <td>${isSample ? html`<span class="muted-note">Demo only</span>` : existsId > 0 ? html`<span class="muted-note">In ReAI #${existsId}</span>` : employeeId <= 0 ? html`<span class="muted-note">${t.driverEmail ? `No ReAI employee with ${t.driverEmail}` : 'Select employee above'}</span>` : html`<form hx-post="/app/abax/book-trip" hx-target="#ab-t-${idx}" hx-swap="outerHTML">
            <input type="hidden" name="employeeId" value="${employeeId}"><input type="hidden" name="vehicleId" value="${vehicleId}">
            <input type="hidden" name="date" value="${t.date}"><input type="hidden" name="from" value="${t.from}"><input type="hidden" name="to" value="${t.to}">
            <input type="hidden" name="purpose" value="${t.purpose}"><input type="hidden" name="km" value="${t.km.toFixed(1)}"><input type="hidden" name="toll" value="${t.toll.toFixed(2)}">
            <input type="hidden" name="passenger" value="${t.passenger}"><input type="hidden" name="passengerKm" value="${t.passengerKm.toFixed(1)}">
            <button type="submit" class="button primary">Record trip</button>
          </form>`}</td>
        </tr>`;
        })}</tbody>
      </table></div>
    `,
  });
}

/**
 * Handles /app/abax/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/abax';
  const title = 'ABAX Driving Log';
  const lead = 'Fetch business trips and road tolls from the ABAX Open API and record them in the ReAI driving log.';
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    /** @type {SimpleItem[]} */ let employees = [];
    /** @type {SimpleItem[]} */ let vehicles = [];
    if (session && session.tenantId > 0) {
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const [e, v] = await Promise.all([
        reaiRequest(env, '/api/employees', auth).catch(() => []),
        reaiRequest(env, '/api/driving-log/vehicles', auth).catch(() => []),
      ]);
      employees = Array.isArray(e) ? /** @type {SimpleItem[]} */ (e) : [];
      vehicles = Array.isArray(v) ? /** @type {Array<SimpleItem & { archived?: boolean }>} */ (v).filter((x) => !x.archived) : [];
    }
    const extraFields = html`<div class="mapping-grid">
      <div class="field"><label for="ab-emp">ReAI employee</label><select id="ab-emp" name="employeeId"><option value="0">${employees.length > 0 ? 'Select employee…' : 'Connect to ReAI first'}</option>${employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}</select></div>
      <div class="field"><label for="ab-veh">ReAI vehicle (optional)</label><select id="ab-veh" name="vehicleId"><option value="0">No vehicle</option>${vehicles.map((v) => html`<option value="${v.id}">${v.name}${v.registrationNumber ? ` (${v.registrationNumber})` : ''}</option>`)}</select></div>
    </div>`;
    const body = html`
      <section class="app-intro"><p class="eyebrow">FLEET & DRIVING LOG</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-abax-web', clientName: 'ReAI ABAX Driving Log (Web)' })}
        ${renderApiFetchCard({
          basePath,
          targetId: 'ta-output',
          brand: 'ABAX',
          hint: 'Create API credentials in the ABAX Developer Portal and ask ABAX support to enable the client credentials flow for them. Periods can be at most 3 months.',
          fields: [
            { name: 'clientId', label: 'ABAX client ID', placeholder: 'client_id' },
            { name: 'clientSecret', label: 'ABAX client secret', type: 'password', placeholder: 'client_secret' },
            { name: 'driverEmail', label: 'Driver email in ABAX (optional)', required: false },
            { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
            { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
          ],
          extraFields,
          sampleAction: true,
        })}
        <div id="ta-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) return htmlResponse(renderTrips(SAMPLE_TRIPS, SAMPLE_TRIPS.map(() => 1), [], 1, true));
  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      const trips = await fetchApi(creds);
      const session = await readSession(env, request);
      /** @type {SimpleItem[]} */ let employees = [];
      /** @type {ReaiTrip[]} */ let existing = [];
      if (session && session.tenantId > 0) {
        const auth = { token: session.accessToken, tenantId: session.tenantId };
        const first = trips[0]?.date ?? '';
        const [e, ex] = await Promise.all([
          reaiRequest(env, '/api/employees', auth).catch(() => []),
          (async () => {
            /** @type {ReaiTrip[]} */ const out = [];
            for (let page = 1; page <= 5; page++) {
              const res = /** @type {{ items?: ReaiTrip[], hasNext?: boolean }} */ (await reaiRequest(env, '/api/driving-log/trips', { ...auth, query: { page: String(page), pageSize: '200' } }));
              const items = Array.isArray(res.items) ? res.items : [];
              out.push(...items);
              if (!res.hasNext || items.length === 0 || items.every((x) => x.tripDate < first)) break;
            }
            return out;
          })().catch(() => []),
        ]);
        employees = Array.isArray(e) ? /** @type {SimpleItem[]} */ (e) : [];
        existing = ex;
      }
      return htmlResponse(renderTrips(trips, employeeForTrips(trips, employees, Number(form.get('employeeId') ?? '0')), trips.map((t) => existingTrip(t, existing)), Number(form.get('vehicleId') ?? '0'), false));
    }
    if (pathname === `${basePath}/book-trip`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const employeeId = Number(form.get('employeeId') ?? '0');
      const vehicleId = Number(form.get('vehicleId') ?? '0');
      const tripDate = String(form.get('date') ?? '').slice(0, 10);
      const fromLocation = String(form.get('from') ?? 'Start').trim().slice(0, 200) || 'Start';
      const toLocation = String(form.get('to') ?? 'Destination').trim().slice(0, 200) || 'Destination';
      const purpose = String(form.get('purpose') ?? 'Business trip').trim().slice(0, 10000) || 'Business trip';
      const kilometers = Number(form.get('km') ?? '0');
      const roadTollAmount = Math.round(Number(form.get('toll') ?? '0') * 100) / 100;
      const passengerName = String(form.get('passenger') ?? '').trim().slice(0, 200);
      const passengerKm = Number(form.get('passengerKm') ?? '0');
      const passengers = passengerName && passengerKm >= 0.1 ? [{ name: passengerName, kilometers: Math.min(passengerKm, kilometers) }] : [];
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(tripDate) || !(kilometers >= 0.1) || !(roadTollAmount >= 0)) throw new HttpError(400, 'A valid date and distance are required.');
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/driving-log/trips', {
        token: session.accessToken,
        tenantId: session.tenantId,
        method: 'POST',
        body: { ...(employeeId > 0 ? { employeeId } : {}), ...(vehicleId > 0 ? { vehicleId } : {}), tripDate, fromLocation, toLocation, purpose, kilometers, roadTollAmount, ...(passengers.length > 0 ? { passengers } : {}) },
      }));
      return htmlResponse(html`<tr><td class="mono">${tripDate}</td><td>${fromLocation} → ${toLocation}</td><td>${purpose}</td><td class="num">${kilometers.toFixed(1)}</td><td class="num">${roadTollAmount.toFixed(2)}</td><td>${reaiBadge({ text: `Recorded #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'ABAX error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown ABAX route.', 404);
}
