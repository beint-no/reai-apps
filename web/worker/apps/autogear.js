// @ts-check
import { fetchJson, isoDate, num, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/** @typedef {{ id: string, date: string, from: string, to: string, purpose: string, km: number, toll: number, driver: string, driverEmail: string, vehicle: string }} TripRow */
/** @typedef {{ id: number, name: string, email?: string | null }} EmployeeRef */
/** @typedef {{ id: number, name: string, registrationNumber?: string | null, archived?: boolean }} VehicleRef */

const BRAND = 'Autogear';
const BASE = '/app/autogear';
const API = 'https://api.autogear.com';
const PAGE_SIZE = 100;
const MAX_PAGES = 30;
const TITLE = 'Autogear Driving Log';
const LEAD = 'Fetch confirmed business trips and road tolls from the Autogear API and record them in ReAI Driving Log (/api/driving-log/trips), one trip at a time after review.';

/** @type {Record<string, string>} */
const STATUS_FILTERS = { confirmed: '2', all: '' };

/** @type {TripRow[]} */
const SAMPLE_TRIPS = [
  { id: 'sample-1', date: '2026-10-07', from: 'Storgata 1, Oslo', to: 'Lysaker, Bærum', purpose: 'Customer meeting', km: 18.4, toll: 46, driver: 'Kari Nordmann', driverEmail: '', vehicle: 'EK 12345' },
  { id: 'sample-2', date: '2026-10-09', from: 'Oslo', to: 'Ski Næringspark', purpose: 'Site inspection', km: 31.4, toll: 0, driver: 'Kari Nordmann', driverEmail: '', vehicle: 'EK 12345' },
  { id: 'sample-3', date: '2026-10-14', from: 'Oslo', to: 'Asker', purpose: 'Service visit', km: 24.7, toll: 38, driver: 'Ola Nordmann', driverEmail: '', vehicle: 'EL 67890' },
];

/** @param {unknown} v */
function str(v) {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
}

/**
 * Maps one documented Autogear TripDomainModel to a ReAI trip row, or null for private or commute trips.
 * @param {any} t
 * @param {string} fallbackDate
 * @returns {TripRow | null}
 */
export function mapTrip(t, fallbackDate) {
  if (!t || typeof t !== 'object') return null;
  if (t.isCommute === true) return null;
  const category = `${str(t.rateCategory?.name)} ${str(t.rateCategory?.shortName)}`.toLowerCase();
  if (category.includes('priv')) return null;
  const km = Number(num(t.distanceKm ?? t.distance).toFixed(1));
  if (km < 0.1) return null;
  const driverName = `${str(t.driver?.firstName)} ${str(t.driver?.lastName)}`.trim();
  return {
    id: str(t.id),
    date: isoDate(t.startDateTime ?? t.startDate ?? t.tripDate, fallbackDate),
    from: str(t.startAddress?.alias) || str(t.startAddress?.addressName) || 'Start',
    to: str(t.endAddress?.alias) || str(t.endAddress?.addressName) || 'Destination',
    purpose: str(t.description?.description) || (str(t.project?.name) ? `Project ${str(t.project?.name)}` : 'Business trip (Autogear)'),
    km,
    toll: Number(Math.max(0, num(t.totalTollStationCost)).toFixed(2)),
    driver: driverName || str(t.driver?.email),
    driverEmail: str(t.driver?.email).toLowerCase(),
    vehicle: str(t.vehicle?.licensePlateNumber) || str(t.vehicle?.name),
  };
}

/*
 * Autogear REST API (docs: https://www.autogear.com/api, Swagger UI https://api.autogear.com/docs/index.html,
 * OpenAPI https://api.autogear.com/swagger/v1/swagger.json):
 *   POST /authentication/login { username, password, client_id, client_secret } -> AccessTokenModel.access_token (JWT)
 *   GET  /Trip?fromDate&toDate&status&PageSize&PageNumber&fields -> { data: { totalTrips, trips: TripDomainModel[] } }
 *   Authorization: Bearer <access_token>. Status 1 = unconfirmed, 2 = confirmed, 3 = reported.
 */
/**
 * Logs in to Autogear and fetches business trips for the date range.
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<TripRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const username = (creds.username ?? '').trim();
  const password = creds.password ?? '';
  const clientId = (creds.clientId ?? '').trim();
  const clientSecret = (creds.clientSecret ?? '').trim();
  if (!username || !password || !clientId || !clientSecret) {
    throw new HttpError(400, 'Enter the Autogear integration user, password, Client ID and Client Secret.');
  }
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (from > to) throw new HttpError(400, 'From date must be on or before to date.');
  const status = STATUS_FILTERS[creds.status ?? 'confirmed'] ?? STATUS_FILTERS.confirmed;

  const login = await fetchJson(`${API}/authentication/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ username, password, client_id: clientId, client_secret: clientSecret }),
  }, BRAND, fetchImpl);
  const token = str(login?.access_token ?? login?.token);
  if (!token) {
    throw new HttpError(400, `Autogear login failed${str(login?.error_description) ? `: ${str(login.error_description)}` : '.'}`);
  }

  /** @type {TripRow[]} */
  const trips = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL(`${API}/Trip`);
    url.searchParams.set('fromDate', from);
    url.searchParams.set('toDate', to);
    url.searchParams.set('PageSize', String(PAGE_SIZE));
    url.searchParams.set('PageNumber', String(page));
    url.searchParams.set('sortOrder', 'false');
    url.searchParams.set('fields', 'fields(*)');
    if (status) url.searchParams.set('status', status);
    const payload = await fetchJson(url.toString(), { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, BRAND, fetchImpl);
    const list = Array.isArray(payload?.data?.trips) ? payload.data.trips : [];
    for (const t of list) {
      const row = mapTrip(t, from);
      if (row) trips.push(row);
    }
    const total = typeof payload?.data?.totalTrips === 'number' ? payload.data.totalTrips : Infinity;
    if (list.length < PAGE_SIZE || page * PAGE_SIZE >= total) {
      if (trips.length === 0) throw new HttpError(400, `Autogear returned 0 business trips for ${from} to ${to}.`);
      return trips;
    }
  }
  throw new HttpError(400, `Autogear returned more than ${MAX_PAGES * PAGE_SIZE} trips. Choose a shorter date range.`);
}

/**
 * @param {{ trips: TripRow[], employees: EmployeeRef[], defaultEmployeeId: number, vehicleId: number, isSample?: boolean }} state
 */
function renderTrips(state) {
  const { trips, employees, defaultEmployeeId, vehicleId, isSample } = state;
  const byEmail = new Map(employees.filter((e) => e.email).map((e) => [String(e.email).toLowerCase(), e.id]));
  const totalKm = trips.reduce((s, t) => s + t.km, 0);
  const totalTolls = trips.reduce((s, t) => s + t.toll, 0);
  return reaiCard({
    eyebrow: 'AUTOGEAR TRIPS → /API/DRIVING-LOG/TRIPS',
    title: `${trips.length} business trips (${totalKm.toFixed(1)} km)`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Review and record', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Business trips', value: String(trips.length), detail: 'Private and commute trips excluded' })}
        ${reaiMetric({ label: 'Distance', value: `${totalKm.toFixed(1)} km`, detail: 'ReAI applies the rate for the trip date' })}
        ${reaiMetric({ label: 'Road tolls', value: `${formatMinor(Math.round(totalTolls * 100))} NOK`, detail: 'Posted with mileage allowance trips' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Route</th><th>Purpose</th><th>Driver / vehicle</th><th class="num">Km</th><th class="num">Tolls</th><th>Action</th></tr></thead>
        <tbody>${trips.map((t, idx) => {
          const employeeId = byEmail.get(t.driverEmail) ?? defaultEmployeeId;
          return html`<tr id="ag-t-${idx}">
            <td class="mono">${t.date}</td><td>${t.from} → ${t.to}</td><td>${t.purpose}</td>
            <td>${t.driver || '—'}<br><span class="muted-note">${t.vehicle || '—'}</span></td>
            <td class="num">${t.km.toFixed(1)}</td><td class="num">${t.toll.toFixed(2)}</td>
            <td>${isSample ? html`<span class="muted-note">Demo only</span>` : html`<form hx-post="${BASE}/book-trip" hx-target="#ag-t-${idx}" hx-swap="outerHTML">
              <input type="hidden" name="employeeId" value="${employeeId}"><input type="hidden" name="vehicleId" value="${vehicleId}">
              <input type="hidden" name="date" value="${t.date}"><input type="hidden" name="from" value="${t.from}"><input type="hidden" name="to" value="${t.to}">
              <input type="hidden" name="purpose" value="${t.purpose}"><input type="hidden" name="km" value="${t.km.toFixed(1)}"><input type="hidden" name="toll" value="${t.toll.toFixed(2)}">
              <button type="submit" class="button primary">Record trip</button>
              ${employeeId > 0 ? '' : html`<br><span class="muted-note">No ReAI employee matched</span>`}
            </form>`}</td>
          </tr>`;
        })}</tbody>
      </table></div>
      ${isSample
        ? reaiCallout({ tone: 'info', body: 'Sample Autogear trips loaded. Connect to ReAI and fetch with your Autogear API key to record real trips.' })
        : reaiCallout({ tone: 'info', body: 'Each Record trip creates one ReAI driving log trip. Mileage allowance trips book a voucher and are paid through salary expense import, so do not also reimburse them in Autogear or payroll.' })}
    `,
  });
}

/**
 * Loads ReAI employees and active vehicles for the selected company.
 * @param {import('../lib/types.d.ts').Env} env
 * @param {import('../lib/types.d.ts').SessionData | null} session
 * @returns {Promise<{ employees: EmployeeRef[], vehicles: VehicleRef[] }>}
 */
async function loadRefs(env, session) {
  if (!session || session.tenantId <= 0) return { employees: [], vehicles: [] };
  const [e, v] = await Promise.all([
    reaiRequest(env, '/api/employees', { token: session.accessToken, tenantId: session.tenantId }).catch(() => []),
    reaiRequest(env, '/api/driving-log/vehicles', { token: session.accessToken, tenantId: session.tenantId }).catch(() => []),
  ]);
  return {
    employees: Array.isArray(e) ? /** @type {EmployeeRef[]} */ (e) : [],
    vehicles: Array.isArray(v) ? /** @type {VehicleRef[]} */ (v).filter((x) => !x.archived) : [],
  };
}

/**
 * Handles /app/autogear/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE}/`, request.url), 301);
  if (pathname === `${BASE}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const { employees, vehicles } = await loadRefs(env, session);
    const body = html`
      <section class="app-intro"><p class="eyebrow">FLEET & DRIVING LOG (KJØREBOK)</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-autogear-web', clientName: 'ReAI Autogear Driving Log (Web)' })}
        ${renderApiFetchCard({
          basePath: BASE,
          targetId: 'ag-output',
          brand: BRAND,
          hint: 'An Autogear account owner or administrator creates the Client ID and Client Secret under API clients in Autogear. Use a dedicated integration user.',
          fields: [
            { name: 'username', label: 'Autogear integration user (email)', placeholder: 'integration@company.no' },
            { name: 'password', label: 'Autogear password', type: 'password' },
            { name: 'clientId', label: 'Client ID', placeholder: 'Autogear-…' },
            { name: 'clientSecret', label: 'Client Secret', type: 'password' },
            { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
            { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
          ],
          extraFields: html`<div class="mapping-grid">
            <div class="field"><label for="ag-status">Autogear trip status</label><select id="ag-status" name="status"><option value="confirmed" selected>Confirmed trips only</option><option value="all">All trips</option></select></div>
            <div class="field"><label for="ag-emp">Fallback ReAI employee</label><select id="ag-emp" name="employeeId"><option value="0">${employees.length > 0 ? 'Match driver by email…' : 'Connect to ReAI first'}</option>${employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}</select></div>
            <div class="field"><label for="ag-veh">ReAI vehicle</label><select id="ag-veh" name="vehicleId"><option value="0">Sole active vehicle</option>${vehicles.map((v) => html`<option value="${v.id}">${v.name}${v.registrationNumber ? ` (${v.registrationNumber})` : ''}</option>`)}</select></div>
          </div>`,
          sampleAction: true,
        })}
        <div id="ag-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE}/sample`) {
    return htmlResponse(renderTrips({ trips: SAMPLE_TRIPS, employees: [], defaultEmployeeId: 1, vehicleId: 0, isSample: true }));
  }
  try {
    const form = await request.formData();
    if (pathname === `${BASE}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) if (typeof v === 'string') creds[k] = v;
      const trips = await fetchApi(creds);
      const session = await readSession(env, request);
      const { employees } = await loadRefs(env, session);
      return htmlResponse(renderTrips({ trips, employees, defaultEmployeeId: Number(creds.employeeId ?? '0'), vehicleId: Number(creds.vehicleId ?? '0') }));
    }
    if (pathname === `${BASE}/book-trip`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const employeeId = Number(form.get('employeeId') ?? '0');
      const vehicleId = Number(form.get('vehicleId') ?? '0');
      const tripDate = String(form.get('date') ?? '').slice(0, 10);
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(tripDate)) throw new HttpError(400, 'Invalid trip date.');
      const fromLocation = String(form.get('from') ?? 'Start').trim().slice(0, 255);
      const toLocation = String(form.get('to') ?? 'Destination').trim().slice(0, 255);
      const purpose = String(form.get('purpose') ?? 'Business trip').trim().slice(0, 500);
      const kilometers = Number(form.get('km') ?? '0');
      const roadTollAmount = Number(form.get('toll') ?? '0');
      if (!(kilometers > 0)) throw new HttpError(400, 'Trip distance must be positive.');
      const created = /** @type {{ id?: number, webUrl?: string, bookedAmount?: number }} */ (await reaiRequest(env, '/api/driving-log/trips', {
        token: session.accessToken,
        tenantId: session.tenantId,
        method: 'POST',
        body: { ...(employeeId > 0 ? { employeeId } : {}), ...(vehicleId > 0 ? { vehicleId } : {}), tripDate, fromLocation, toLocation, purpose, kilometers, roadTollAmount: Number.isFinite(roadTollAmount) && roadTollAmount > 0 ? roadTollAmount : 0 },
      }));
      return htmlResponse(html`<tr><td class="mono">${tripDate}</td><td>${fromLocation} → ${toLocation}</td><td>${purpose}</td><td>—</td><td class="num">${kilometers.toFixed(1)}</td><td class="num">${roadTollAmount.toFixed(2)}</td><td>${created.webUrl ? html`<a href="${created.webUrl}" target="_blank" rel="noopener">Trip #${created.id ?? ''} ↗</a>` : reaiBadge({ text: `Recorded #${created.id ?? 'ok'}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse(`Unknown ${BRAND} route.`, 404);
}
