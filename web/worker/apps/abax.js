// @ts-check
import { fetchJson, isoDate, num, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/** @typedef {{ id: string, date: string, from: string, to: string, purpose: string, km: number, toll: number, driver: string }} TripRow */
/** @typedef {{ id: number, name: string, registrationNumber?: string }} SimpleItem */

const API = 'https://api.abax.cloud';
const TOKEN_URL = 'https://identity.abax.cloud/connect/token';

/** @type {TripRow[]} */
const SAMPLE_TRIPS = [
  { id: 'demo-1', date: '2026-10-14', from: 'N 0150, Oslo, Karl Johans gate', to: 'N 3015, Drammen, Grønland', purpose: 'Kundemøte og befaring', km: 42.5, toll: 88, driver: 'Demo Driver' },
  { id: 'demo-2', date: '2026-10-16', from: 'N 0150, Oslo, Karl Johans gate', to: 'N 2060, Gardermoen, Edvard Munchs veg', purpose: 'Levering og service', km: 51.2, toll: 64, driver: 'Demo Driver' },
];

/** @param {string} iso @param {number} days */
function addDays(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Fetches business trips and toll expenses from the ABAX Open API V4.
 * Docs: https://developers.abax.cloud/getting-started (client credentials flow, POST
 * https://identity.abax.cloud/connect/token with scopes open_api and open_platform.trips),
 * https://developers.abax.cloud/migration-guide (GET /v4/trips with page, page_size, date_from, date_to
 * at most 3 months; distance in meters; commercial_class; GET /v4/trips/expense?trip_ids= up to 150 ids)
 * and https://developers.abax.cloud/documentation/api (Trip and Expense models).
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<TripRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const clientId = (creds.clientId ?? '').trim();
  const clientSecret = (creds.clientSecret ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!clientId || !clientSecret) throw new HttpError(400, 'Enter the ABAX client ID and client secret.');
  if (to < from) throw new HttpError(400, 'The to date must be on or after the from date.');
  if (Date.parse(to) - Date.parse(from) > 92 * 86_400_000) throw new HttpError(400, 'ABAX allows at most 3 months per request. Choose a shorter period.');
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
  for (let page = 1; page <= 10; page++) {
    const query = new URLSearchParams({ page: String(page), page_size: '1500', date_from: `${from}T00:00:00Z`, date_to: `${addDays(to, 1)}T00:00:00Z` });
    const data = await fetchJson(`${API}/v4/trips?${query}`, { headers }, 'ABAX', fetchImpl);
    /** @type {any[]} */ const items = Array.isArray(data?.items) ? data.items : [];
    trips.push(...items);
    if (items.length < 1500) break;
  }
  const business = trips.filter((t) => t?.commercial_class === 'BusinessTrip'
    && (!driverEmail || String(t.driver?.email ?? '').trim().toLowerCase() === driverEmail));

  /** @type {Map<string, number>} */ const tolls = new Map();
  for (let i = 0; i < business.length; i += 150) {
    const query = new URLSearchParams();
    for (const t of business.slice(i, i + 150)) query.append('trip_ids', String(t.id));
    const data = await fetchJson(`${API}/v4/trips/expense?${query}`, { headers }, 'ABAX', fetchImpl);
    for (const e of /** @type {any[]} */ (Array.isArray(data?.items) ? data.items : [])) {
      tolls.set(String(e.trip_id), num(e.expense?.toll_charge) + num(e.expense?.toll_road_admin));
    }
  }

  const rows = business
    .map((t) => ({
      id: String(t.id),
      date: isoDate(t.start?.location?.timestamp, from),
      from: String(t.start?.address ?? '').trim() || 'Start',
      to: String(t.finish?.address ?? '').trim() || 'Destination',
      purpose: String(t.purpose ?? t.notes ?? '').trim() || 'Business trip',
      km: Number((num(t.distance) / 1000).toFixed(1)),
      toll: Number((tolls.get(String(t.id)) ?? 0).toFixed(2)),
      driver: String(t.driver?.name ?? '').trim(),
    }))
    .filter((t) => t.km >= 0.1 && t.date >= from && t.date <= to);
  if (rows.length === 0) throw new HttpError(400, `ABAX returned no business trips for ${from} to ${to}.`);
  return rows;
}

/** @param {TripRow[]} trips @param {number} employeeId @param {number} vehicleId @param {boolean} isSample */
function renderTrips(trips, employeeId, vehicleId, isSample) {
  const totalKm = trips.reduce((s, t) => s + t.km, 0);
  const totalTolls = trips.reduce((s, t) => s + t.toll, 0);
  return reaiCard({
    eyebrow: 'ABAX → REAI DRIVING LOG',
    title: `${trips.length} business trips (${totalKm.toFixed(1)} km)`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Ready to record', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Business trips', value: String(trips.length), detail: 'Private trips and commutes excluded' })}
        ${reaiMetric({ label: 'Distance', value: `${totalKm.toFixed(1)} km`, detail: 'ReAI applies the mileage rate' })}
        ${reaiMetric({ label: 'Road tolls', value: `${formatMinor(Math.round(totalTolls * 100))} NOK`, detail: 'From ABAX trip expenses' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Route</th><th>Purpose</th><th class="num">Km</th><th class="num">Tolls</th><th>Action</th></tr></thead>
        <tbody>${trips.map((t, idx) => html`<tr id="ab-t-${idx}">
          <td class="mono">${t.date}</td><td>${t.from} → ${t.to}${t.driver ? html`<br><span class="muted-note">${t.driver}</span>` : ''}</td><td>${t.purpose}</td>
          <td class="num">${t.km.toFixed(1)}</td><td class="num">${t.toll.toFixed(2)}</td>
          <td>${isSample ? html`<span class="muted-note">Demo only</span>` : html`<form hx-post="/app/abax/book-trip" hx-target="#ab-t-${idx}" hx-swap="outerHTML">
            <input type="hidden" name="employeeId" value="${employeeId}"><input type="hidden" name="vehicleId" value="${vehicleId}">
            <input type="hidden" name="date" value="${t.date}"><input type="hidden" name="from" value="${t.from}"><input type="hidden" name="to" value="${t.to}">
            <input type="hidden" name="purpose" value="${t.purpose}"><input type="hidden" name="km" value="${t.km.toFixed(1)}"><input type="hidden" name="toll" value="${t.toll.toFixed(2)}">
            <button type="submit" class="button primary">Record trip</button>
          </form>`}</td>
        </tr>`)}</tbody>
      </table></div>
    `,
  });
}

/**
 * Handles /app/abax/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
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
  if (pathname === `${basePath}/sample`) return htmlResponse(renderTrips(SAMPLE_TRIPS, 1, 1, true));
  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderTrips(await fetchApi(creds), Number(form.get('employeeId') ?? '0'), Number(form.get('vehicleId') ?? '0'), false));
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
      const roadTollAmount = Number(form.get('toll') ?? '0');
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(tripDate) || !(kilometers >= 0.1) || !(roadTollAmount >= 0)) throw new HttpError(400, 'A valid date and distance are required.');
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/driving-log/trips', {
        token: session.accessToken,
        tenantId: session.tenantId,
        method: 'POST',
        body: { ...(employeeId > 0 ? { employeeId } : {}), ...(vehicleId > 0 ? { vehicleId } : {}), tripDate, fromLocation, toLocation, purpose, kilometers, roadTollAmount },
      }));
      return htmlResponse(html`<tr><td class="mono">${tripDate}</td><td>${fromLocation} → ${toLocation}</td><td>${purpose}</td><td class="num">${kilometers.toFixed(1)}</td><td class="num">${roadTollAmount.toFixed(2)}</td><td>${reaiBadge({ text: `Recorded #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'ABAX error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown ABAX route.', 404);
}
