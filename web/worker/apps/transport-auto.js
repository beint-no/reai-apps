// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { TRANSPORT_API_UI, fetchAbaxTripsApi, fetchTransportOrdersApi, renderApiFetchCard } from '../lib/provider-api.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/**
 * @typedef {'abax' | 'opter' | 'autonet' | 'logistra'} TransportSlug
 * @typedef {{ date: string, from: string, to: string, purpose: string, km: number, toll: number }} TripRow
 * @typedef {{ ref: string, date: string, customerName: string, description: string, amountExVat: number }} OrderRow
 * @typedef {{ id: number, name: string, registrationNumber?: string }} SimpleItem
 */

const SAMPLE_ABAX_CSV = [
  'Dato;Fra;Til;Formal;Km;Bompenger',
  '2026-10-14;Oslo Sentrum;Drammen Teknologipark;Kundemøte og befaring;42,5;88,00',
  '2026-10-16;Oslo Sentrum;Gardermoen Næringspark;Levering og service;51,2;64,00',
].join('\n');

/** @type {Record<Exclude<TransportSlug, 'abax'>, { brand: string, title: string, lead: string, eyebrow: string, sampleCsv: string }>} */
const ORDER_APPS = {
  opter: {
    brand: 'Opter TMS',
    title: 'Opter Transport & Freight Billing',
    lead: 'Import completed Opter TMS transport assignments and freight invoices directly into ReAI draft customer orders ready for EHF billing.',
    eyebrow: 'TRANSPORT & COURIER TMS',
    sampleCsv: 'OrdreNr;Dato;Kunde;Belop;Beskrivelse\nOPT-9101;2026-10-14;Nordic Grossist AS;6850,00;Palltransport Oslo–Trondheim (4 EUR-paller)\nOPT-9108;2026-10-16;Fjord Industri AS;3200,00;Ekspressbud og kranbil levering',
  },
  autonet: {
    brand: 'AutoNet / GNX Bilverksted',
    title: 'AutoNet / Bilverksted DMS Sync',
    lead: 'Import completed Norwegian car workshop orders (parts, labor 25% VAT, EU-kontroll and tire hotel) directly into ReAI customer orders.',
    eyebrow: 'AUTO WORKSHOPS & DEALER DMS',
    sampleCsv: 'OrdreNr;Dato;Kunde;Belop;Beskrivelse\nWRK-5501;2026-10-15;Viken Flåtedrift AS;7420,00;EU-kontroll, bremseskiver og 3,5t arbeid\nWRK-5504;2026-10-18;Oslo Budbil AS;1960,00;Dekkhotell høstsesong + hjulskift',
  },
  logistra: {
    brand: 'Logistra Cargonizer & Shipmondo',
    title: 'Logistra Cargonizer / Shipmondo Freight',
    lead: 'Import shipping manifests and billable freight surcharges from Logistra Cargonizer, Shipmondo or nShift into ReAI draft customer orders.',
    eyebrow: 'EDI SHIPPING & FREIGHT BILLING',
    sampleCsv: 'OrdreNr;Dato;Kunde;Belop;Beskrivelse\nLOG-3301;2026-10-14;Kyst Handel AS;1490,00;Bring Bedriftspakke 12 kolli (EDI)\nLOG-3305;2026-10-17;Nordlys Retail AS;890,00;PostNord MyPack Collect sending',
  },
};

/** @param {string} raw */
function parseNum(raw) {
  const n = Number(raw.replace(/[\s\u00A0]/g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
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
  return doc.rows
    .map((r) => ({
      date: (r[dIdx] ?? '').trim().slice(0, 10),
      from: fIdx >= 0 ? (r[fIdx] ?? '').trim() || 'Start' : 'Start',
      to: tIdx >= 0 ? (r[tIdx] ?? '').trim() || 'Destination' : 'Destination',
      purpose: pIdx >= 0 ? (r[pIdx] ?? '').trim() || 'Business trip (ABAX)' : 'Business trip (ABAX)',
      km: Number(parseNum(r[kIdx] ?? '0').toFixed(1)),
      toll: bIdx >= 0 ? Number(parseNum(r[bIdx] ?? '0').toFixed(2)) : 0,
    }))
    .filter((x) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x.date) && x.km >= 0.1);
}

/** @param {string} csvText @param {string} slug @returns {OrderRow[]} */
function parseOrdersCsv(csvText, slug) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const rIdx = norm.findIndex((h) => h.includes('ordre') || h.includes('ref') || h.includes('id'));
  const dIdx = norm.findIndex((h) => h.includes('dato') || h.includes('date'));
  const cIdx = norm.findIndex((h) => h.includes('kunde') || h.includes('customer'));
  const aIdx = norm.findIndex((h) => h.includes('belop') || h.includes('beløp') || h.includes('amount') || h.includes('sum'));
  const descIdx = norm.findIndex((h) => h.includes('beskrivelse') || h.includes('desc'));
  if (dIdx < 0 || aIdx < 0) throw new HttpError(400, 'CSV must include Dato/Date and Beløp/Amount columns.');
  return doc.rows
    .map((r, i) => ({
      ref: rIdx >= 0 && (r[rIdx] ?? '').trim() ? (r[rIdx] ?? '').trim() : `${slug.toUpperCase()}-${i + 1}`,
      date: (r[dIdx] ?? '').trim().slice(0, 10),
      customerName: cIdx >= 0 ? (r[cIdx] ?? '').trim() || '—' : '—',
      amountExVat: Number(parseNum(r[aIdx] ?? '0').toFixed(2)),
      description: descIdx >= 0 ? (r[descIdx] ?? '').trim() || 'Service order' : 'Service order',
    }))
    .filter((x) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x.date) && x.amountExVat > 0);
}

/**
 * Handles /app/{abax,opter,autonet,logistra}/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @param {TransportSlug} slug
 * @returns {Promise<Response>}
 */
export async function handleTransportAuto(request, env, slug) {
  const { pathname } = new URL(request.url);
  const basePath = `/app/${slug}`;
  const isAbax = slug === 'abax';
  const orderCfg = !isAbax ? ORDER_APPS[slug] : null;
  const title = isAbax ? 'ABAX Electronic Driving Log (Kjørebok)' : (orderCfg?.title ?? '');
  const lead = isAbax
    ? 'Import business trips and road tolls exported from ABAX Triplog straight into ReAI Driving Log (/api/driving-log/trips) for automatic mileage vouchers and A-melding.'
    : (orderCfg?.lead ?? '');

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  }
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    /** @type {SimpleItem[]} */
    let employees = [];
    /** @type {SimpleItem[]} */
    let vehicles = [];
    /** @type {SimpleItem[]} */
    let customers = [];
    if (session && session.tenantId > 0) {
      try {
        if (isAbax) {
          const [e, v] = await Promise.all([
            reaiRequest(env, '/api/employees', { token: session.accessToken, tenantId: session.tenantId }).catch(() => []),
            reaiRequest(env, '/api/driving-log/vehicles', { token: session.accessToken, tenantId: session.tenantId }).catch(() => []),
          ]);
          employees = Array.isArray(e) ? /** @type {SimpleItem[]} */ (e) : [];
          vehicles = Array.isArray(v) ? /** @type {SimpleItem[]} */ (v) : [];
        } else {
          customers = /** @type {SimpleItem[]} */ (await reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId, query: { archived: 'false' } }));
        }
      } catch {
        // leave empty
      }
    }

    const body = html`
      <section class="app-intro">
        <p class="eyebrow">${isAbax ? 'FLEET & DRIVING LOG (KJØREBOK)' : (orderCfg?.eyebrow ?? '')}</p>
        <h1>${title}</h1>
        <p class="lead">${lead}</p>
      </section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${slug}-web`, clientName: `ReAI ${title} (Web)` })}
        ${TRANSPORT_API_UI[slug]
          ? renderApiFetchCard({
              basePath,
              targetId: 'ta-output',
              brand: TRANSPORT_API_UI[slug].brand,
              hint: TRANSPORT_API_UI[slug].hint,
              fields: TRANSPORT_API_UI[slug].fields,
              sampleAction: true,
            })
          : ''}
        ${reaiCard({
          eyebrow: isAbax ? 'ABAX TRIPLOG CSV → REAI DRIVING LOG' : `${(orderCfg?.brand ?? '').toUpperCase()} → REAI ORDERS`,
          title: isAbax ? 'Upload ABAX business trip export CSV' : `Upload ${orderCfg?.brand ?? ''} order export CSV`,
          body: html`
            <form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#ta-output" hx-swap="innerHTML">
              ${isAbax
                ? html`<div class="mapping-grid">
                    <div class="field"><label for="ab-emp">ReAI employee (for mileage allowance)</label><select id="ab-emp" name="employeeId"><option value="0">${employees.length > 0 ? 'Select employee…' : 'Connect to ReAI first'}</option>${employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}</select></div>
                    <div class="field"><label for="ab-veh">ReAI vehicle (optional if sole vehicle)</label><select id="ab-veh" name="vehicleId"><option value="0">Auto / default vehicle</option>${vehicles.map((v) => html`<option value="${v.id}">${v.name}${v.registrationNumber ? ` (${v.registrationNumber})` : ''}</option>`)}</select></div>
                  </div>`
                : html`<div class="inline-row"><div class="field"><label for="ta-cust">Fallback ReAI customer</label><select id="ta-cust" name="defaultCustomerId"><option value="0">${customers.length > 0 ? 'Match by name or choose…' : 'Connect to ReAI first'}</option>${customers.slice(0, 200).map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select></div></div>`}
              ${reaiDropzone({
                inputId: 'ta-csv',
                name: 'file',
                accept: '.csv,text/csv,text/plain',
                label: isAbax ? 'Choose ABAX CSV' : `Choose ${orderCfg?.brand ?? ''} CSV`,
                hint: isAbax
                  ? 'CSV with Dato, Fra, Til, Formål, Km and optional Bompenger (business trips only).'
                  : 'CSV with OrdreNr, Dato, Kunde, Beløp (ex. VAT) and Beskrivelse.',
              })}
              <div class="inline-row">
                <button type="submit" class="button primary">Preview</button>
                <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#ta-output" hx-swap="innerHTML">Load sample export</button>
              </div>
            </form>
          `,
        })}
        <div id="ta-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  /** @param {TripRow[]} trips @param {number} employeeId @param {number} vehicleId @param {boolean} isSample */
  const renderTrips = (trips, employeeId, vehicleId, isSample) => {
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
          <tbody>${trips.map(
            (t, idx) => html`<tr id="ab-t-${idx}">
              <td class="mono">${t.date}</td>
              <td>${t.from} → ${t.to}</td>
              <td>${t.purpose}</td>
              <td class="num">${t.km.toFixed(1)}</td>
              <td class="num">${t.toll.toFixed(2)}</td>
              <td>${isSample
                ? html`<span class="muted-note">Demo only</span>`
                : html`<form hx-post="/app/abax/book-trip" hx-target="#ab-t-${idx}" hx-swap="outerHTML">
                    <input type="hidden" name="employeeId" value="${employeeId}">
                    <input type="hidden" name="vehicleId" value="${vehicleId}">
                    <input type="hidden" name="date" value="${t.date}">
                    <input type="hidden" name="from" value="${t.from}">
                    <input type="hidden" name="to" value="${t.to}">
                    <input type="hidden" name="purpose" value="${t.purpose}">
                    <input type="hidden" name="km" value="${t.km.toFixed(1)}">
                    <input type="hidden" name="toll" value="${t.toll.toFixed(2)}">
                    <button type="submit" class="button primary">Record trip</button>
                  </form>`}</td>
            </tr>`,
          )}</tbody>
        </table></div>
      `,
    });
  };

  /** @param {Array<{ row: OrderRow, customerId: number | null }>} rows @param {number} defaultCust @param {boolean} isSample */
  const renderOrders = (rows, defaultCust, isSample) => {
    const total = rows.reduce((s, r) => s + r.row.amountExVat, 0);
    return reaiCard({
      eyebrow: `${(orderCfg?.brand ?? '').toUpperCase()} → REAI DRAFT ORDERS`,
      title: `${rows.length} orders (${formatMinor(Math.round(total * 100))} NOK ex. VAT)`,
      badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Ready to stage', tone: 'success' }),
      body: html`<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Ref</th><th>Date</th><th>Customer</th><th>Description</th><th class="num">Ex. VAT (NOK)</th><th>Action</th></tr></thead>
        <tbody>${rows.map(({ row, customerId }, idx) => {
          const cid = customerId ?? defaultCust;
          return html`<tr id="ta-o-${idx}">
            <td class="mono">${row.ref}</td>
            <td class="mono">${row.date}</td>
            <td><strong>${row.customerName}</strong></td>
            <td>${row.description}</td>
            <td class="num">${formatMinor(Math.round(row.amountExVat * 100))}</td>
            <td>${isSample || cid <= 0
              ? html`<span class="muted-note">${isSample ? 'Demo only' : 'Select fallback customer above'}</span>`
              : html`<form hx-post="${basePath}/create-order" hx-target="#ta-o-${idx}" hx-swap="outerHTML">
                  <input type="hidden" name="ref" value="${row.ref}">
                  <input type="hidden" name="date" value="${row.date}">
                  <input type="hidden" name="description" value="${row.description}">
                  <input type="hidden" name="amount" value="${row.amountExVat.toFixed(2)}">
                  <input type="hidden" name="customerId" value="${cid}">
                  <button type="submit" class="button primary">Stage order</button>
                </form>`}</td>
          </tr>`;
        })}</tbody>
      </table></div>`,
    });
  };

  if (pathname === `${basePath}/sample`) {
    if (isAbax) return htmlResponse(renderTrips(parseAbaxCsv(SAMPLE_ABAX_CSV), 1, 1, true));
    return htmlResponse(renderOrders(parseOrdersCsv(orderCfg?.sampleCsv ?? '', slug).map((row) => ({ row, customerId: 1 })), 1, true));
  }

  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api` && slug !== 'autonet') {
      /** @type {Record<string, string>} */
      const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      if (isAbax) {
        const trips = await fetchAbaxTripsApi(creds);
        return htmlResponse(renderTrips(trips, 0, 0, false));
      }
      const orders = await fetchTransportOrdersApi(slug, creds);
      return htmlResponse(renderOrders(orders.map((row) => ({ row, customerId: null })), 0, false));
    }
    if (pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a CSV file or load sample.');
      const csvText = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
      if (isAbax) {
        return htmlResponse(renderTrips(parseAbaxCsv(csvText), Number(form.get('employeeId') ?? '0'), Number(form.get('vehicleId') ?? '0'), false));
      }
      const session = await readSession(env, request);
      /** @type {SimpleItem[]} */
      let custs = [];
      if (session && session.tenantId > 0) {
        custs = /** @type {SimpleItem[]} */ (await reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId, query: { archived: 'false' } }));
      }
      const parsed = parseOrdersCsv(csvText, slug);
      return htmlResponse(
        renderOrders(
          parsed.map((row) => ({ row, customerId: custs.find((c) => c.name.trim().toLowerCase() === row.customerName.toLowerCase())?.id ?? null })),
          Number(form.get('defaultCustomerId') ?? '0'),
          false,
        ),
      );
    }

    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');

    if (isAbax && pathname === '/app/abax/book-trip') {
      const employeeId = Number(form.get('employeeId') ?? '0');
      const vehicleId = Number(form.get('vehicleId') ?? '0');
      const tripDate = String(form.get('date') ?? '').trim();
      const fromLocation = String(form.get('from') ?? '').trim().slice(0, 200);
      const toLocation = String(form.get('to') ?? '').trim().slice(0, 200);
      const purpose = String(form.get('purpose') ?? '').trim().slice(0, 1000);
      const kilometers = Number(form.get('km') ?? '0');
      const roadTollAmount = Number(form.get('toll') ?? '0');
      const created = /** @type {{ id: number, bookedAmount?: number, webUrl?: string }} */ (
        await reaiRequest(env, '/api/driving-log/trips', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: {
            ...(employeeId > 0 ? { employeeId } : {}),
            ...(vehicleId > 0 ? { vehicleId } : {}),
            tripDate,
            fromLocation,
            toLocation,
            purpose: `[ABAX] ${purpose}`,
            kilometers: Number(kilometers.toFixed(1)),
            roadTollAmount: Number(roadTollAmount.toFixed(2)),
          },
        })
      );
      return htmlResponse(html`<tr>
        <td class="mono">${tripDate}</td>
        <td>${fromLocation} → ${toLocation}</td>
        <td>${purpose}</td>
        <td class="num">${kilometers.toFixed(1)}</td>
        <td class="num">${roadTollAmount.toFixed(2)}</td>
        <td>${reaiBadge({ text: `Trip #${created.id}`, tone: 'success' })}</td>
      </tr>`);
    }

    if (!isAbax && pathname === `${basePath}/create-order`) {
      const ref = String(form.get('ref') ?? '').trim();
      const date = String(form.get('date') ?? '').trim();
      const description = String(form.get('description') ?? '').trim().slice(0, 255);
      const amount = Number(form.get('amount') ?? '0');
      const customerId = Number(form.get('customerId') ?? '0');
      const created = /** @type {{ id: number }} */ (
        await reaiRequest(env, '/api/orders', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: {
            customerId,
            currencyCode: 'NOK',
            daysUntilDue: 14,
            issueDate: date,
            orderDate: date,
            externalReference: `${slug}-${ref}`.slice(0, 100),
            comment: `Imported from ${orderCfg?.brand ?? slug} (${ref})`,
            orderLines: [{ itemName: description, quantity: 1, unitPrice: Number(amount.toFixed(2)) }],
          },
        })
      );
      const url = `${reaiOrigin(env)}/order/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(html`<tr><td class="mono">${ref}</td><td class="mono">${date}</td><td>Customer #${customerId}</td><td>${description}</td><td class="num">${formatMinor(Math.round(amount * 100))}</td><td><a href="${url}" target="_blank" rel="noopener">Order #${created.id} ↗</a></td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${title} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }

  return errorResponse('Unknown transport route.', 404);
}
