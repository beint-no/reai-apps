// @ts-check
import { fetchJson, isoDate, num, pickList, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/** @typedef {{ date: string, from: string, to: string, purpose: string, km: number, toll: number }} TripRow */
/** @typedef {{ id: number, name: string, registrationNumber?: string }} SimpleItem */

const SAMPLE_CSV = 'Dato;Fra;Til;Formal;Km;Bompenger\n2026-10-14;Oslo Sentrum;Drammen Teknologipark;Kundemøte og befaring;42,5;88,00\n2026-10-16;Oslo Sentrum;Gardermoen Næringspark;Levering og service;51,2;64,00';

/**
 * Fetches business trips from the official ABAX Open Platform API (filters out private trips, converts meters -> km).
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<TripRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!token) throw new HttpError(400, 'Enter your ABAX Open API Bearer token.');
  const url = `https://api.abax.cloud/v1/trips?from=${encodeURIComponent(`${from}T00:00:00Z`)}&to=${encodeURIComponent(`${to}T23:59:59Z`)}`;
  const data = await fetchJson(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, 'ABAX', fetchImpl);
  const trips = pickList(data, ['items', 'trips', 'data'])
    .filter((t) => String(t.trip_type ?? t.tripType ?? 'business').toLowerCase() !== 'private')
    .map((t) => ({
      date: isoDate(t.start_time ?? t.startTime ?? t.date, from),
      from: String(t.start_location?.address ?? t.startLocation ?? 'Start'),
      to: String(t.stop_location?.address ?? t.stopLocation ?? 'Destination'),
      purpose: String(t.trip_purpose ?? t.purpose ?? 'Business trip (ABAX)'),
      km: Number((t.distance_km !== undefined ? num(t.distance_km) : num(t.distance) / 1000).toFixed(1)),
      toll: Number(num(t.toll_cost ?? t.tollCost ?? 0).toFixed(2)),
    }))
    .filter((t) => t.km >= 0.1);
  if (trips.length === 0) throw new HttpError(400, `ABAX returned 0 business trips for ${from}–${to}.`);
  return trips;
}

/** @param {string} csvText @returns {TripRow[]} */
function parseAbaxCsv(csvText) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const dIdx = norm.findIndex((h) => h.includes('dato') || h.includes('date'));
  const fIdx = norm.findIndex((h) => h.includes('fra') || h.includes('from'));
  const tIdx = norm.findIndex((h) => h.includes('til') || h.includes('to'));
  const pIdx = norm.findIndex((h) => h.includes('formal') || h.includes('formål') || h.includes('purpose') || h.includes('kommentar'));
  const kIdx = norm.findIndex((h) => h.includes('km') || h.includes('dist'));
  const bIdx = norm.findIndex((h) => h.includes('bom') || h.includes('toll'));
  if (dIdx < 0 || kIdx < 0) throw new HttpError(400, 'ABAX CSV must include Dato/Date and Km/Distance columns.');
  return doc.rows.map((r) => ({
    date: (r[dIdx] ?? '').trim().slice(0, 10),
    from: fIdx >= 0 ? (r[fIdx] ?? '').trim() || 'Start' : 'Start',
    to: tIdx >= 0 ? (r[tIdx] ?? '').trim() || 'Destination' : 'Destination',
    purpose: pIdx >= 0 ? (r[pIdx] ?? '').trim() || 'Business trip (ABAX)' : 'Business trip (ABAX)',
    km: Number(Math.max(0, num(r[kIdx])).toFixed(1)),
    toll: bIdx >= 0 ? Number(Math.max(0, num(r[bIdx])).toFixed(2)) : 0,
  })).filter((x) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x.date) && x.km >= 0.1);
}

/** @param {TripRow[]} trips @param {number} employeeId @param {number} vehicleId @param {boolean} isSample */
function renderTrips(trips, employeeId, vehicleId, isSample) {
  const totalKm = trips.reduce((s, t) => s + t.km, 0);
  const totalTolls = trips.reduce((s, t) => s + t.toll, 0);
  return reaiCard({
    eyebrow: 'ABAX TRIPLOG → /API/DRIVING-LOG/TRIPS',
    title: `${trips.length} business trips (${totalKm.toFixed(1)} km)`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Ready to book', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Business trips', value: String(trips.length), detail: 'Private trips excluded' })}
        ${reaiMetric({ label: 'Distance', value: `${totalKm.toFixed(1)} km`, detail: 'Statutory NOK/km rate applied by ReAI' })}
        ${reaiMetric({ label: 'Road tolls', value: `${formatMinor(Math.round(totalTolls * 100))} NOK`, detail: 'Booked atomically with trip voucher' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Route</th><th>Purpose</th><th class="num">Km</th><th class="num">Tolls</th><th>Action</th></tr></thead>
        <tbody>${trips.map((t, idx) => html`<tr id="ab-t-${idx}">
          <td class="mono">${t.date}</td><td>${t.from} → ${t.to}</td><td>${t.purpose}</td>
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
  const title = 'ABAX Electronic Driving Log (Kjørebok)';
  const lead = 'Import business trips and road tolls from ABAX Triplog API or CSV straight into ReAI Driving Log (/api/driving-log/trips) for automatic mileage vouchers and A-melding.';
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    /** @type {SimpleItem[]} */ let employees = [];
    /** @type {SimpleItem[]} */ let vehicles = [];
    if (session && session.tenantId > 0) {
      try {
        const [e, v] = await Promise.all([
          reaiRequest(env, '/api/employees', { token: session.accessToken, tenantId: session.tenantId }).catch(() => []),
          reaiRequest(env, '/api/driving-log/vehicles', { token: session.accessToken, tenantId: session.tenantId }).catch(() => []),
        ]);
        employees = Array.isArray(e) ? /** @type {SimpleItem[]} */ (e) : [];
        vehicles = Array.isArray(v) ? /** @type {SimpleItem[]} */ (v) : [];
      } catch { /* ignore */ }
    }
    const body = html`
      <section class="app-intro"><p class="eyebrow">FLEET & DRIVING LOG (KJØREBOK)</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-abax-web', clientName: 'ReAI ABAX Driving Log (Web)' })}
        ${renderApiFetchCard({
          basePath,
          targetId: 'ta-output',
          brand: 'ABAX Triplog',
          hint: 'Connect ABAX Open Platform API (GET https://api.abax.cloud/v1/trips) to pull business trips & tolls directly into ReAI Driving Log.',
          fields: [
            { name: 'apiToken', label: 'ABAX Open API Bearer token', type: 'password', placeholder: 'Bearer token' },
            { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
            { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
          ],
          sampleAction: true,
        })}
        ${reaiCard({
          eyebrow: 'ABAX TRIPLOG CSV → REAI DRIVING LOG',
          title: 'Or upload ABAX business trip export CSV',
          body: html`<form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#ta-output" hx-swap="innerHTML">
            <div class="mapping-grid">
              <div class="field"><label for="ab-emp">ReAI employee</label><select id="ab-emp" name="employeeId"><option value="0">${employees.length > 0 ? 'Select employee…' : 'Connect to ReAI first'}</option>${employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}</select></div>
              <div class="field"><label for="ab-veh">ReAI vehicle (optional)</label><select id="ab-veh" name="vehicleId"><option value="0">Auto / default vehicle</option>${vehicles.map((v) => html`<option value="${v.id}">${v.name}${v.registrationNumber ? ` (${v.registrationNumber})` : ''}</option>`)}</select></div>
            </div>
            ${reaiDropzone({ inputId: 'ta-csv', name: 'file', accept: '.csv,text/csv,text/plain', label: 'Choose ABAX CSV', hint: 'CSV with Dato, Fra, Til, Formål, Km and optional Bompenger.' })}
            <div class="inline-row"><button type="submit" class="button primary">Preview CSV</button></div>
          </form>`,
        })}
        <div id="ta-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) return htmlResponse(renderTrips(parseAbaxCsv(SAMPLE_CSV), 1, 1, true));
  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderTrips(await fetchApi(creds), 0, 0, false));
    }
    if (pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose an ABAX CSV file.');
      return htmlResponse(renderTrips(parseAbaxCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer()))), Number(form.get('employeeId') ?? '0'), Number(form.get('vehicleId') ?? '0'), false));
    }
    if (pathname === `${basePath}/book-trip`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const employeeId = Number(form.get('employeeId') ?? '0');
      const vehicleId = Number(form.get('vehicleId') ?? '0');
      const tripDate = String(form.get('date') ?? '').slice(0, 10);
      const fromLocation = String(form.get('from') ?? 'Start').trim();
      const toLocation = String(form.get('to') ?? 'Destination').trim();
      const purpose = String(form.get('purpose') ?? 'Business trip').trim();
      const kilometers = Number(form.get('km') ?? '0');
      const roadTollAmount = Number(form.get('toll') ?? '0');
      const created = /** @type {{ id?: number }} */ (await reaiRequest(env, '/api/driving-log/trips', {
        token: session.accessToken,
        tenantId: session.tenantId,
        method: 'POST',
        body: { ...(employeeId > 0 ? { employeeId } : {}), ...(vehicleId > 0 ? { vehicleId } : {}), tripDate, fromLocation, toLocation, purpose, kilometers, roadTollAmount },
      }));
      return htmlResponse(html`<tr><td class="mono">${tripDate}</td><td>${fromLocation} → ${toLocation}</td><td>${purpose}</td><td class="num">${kilometers.toFixed(1)}</td><td class="num">${roadTollAmount.toFixed(2)}</td><td>${reaiBadge({ text: `Recorded #${created.id ?? 'ok'}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'ABAX error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown ABAX route.', 404);
}
