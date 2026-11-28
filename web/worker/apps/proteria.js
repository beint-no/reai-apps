// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/**
 * Proteria Frakt has a public CloudConnect API (https://cloudconnect.proteria.com/swagger.json), but it only creates
 * shipments, labels and print jobs; it has no endpoint that lists shipments or freight costs. Freight costs are
 * documented only in the invoice report export ("Fakturarapport", semicolon CSV, UTF-8):
 * https://proteria.no/hjelpesenter/hvordan-hente-ut-fakturaspesifikasjoner/ and
 * https://proteria.atlassian.net/wiki/spaces/PFWS/pages/790233140 (documented columns include ProTeriaInvoiceNr,
 * SenderName and AmountWithoutVAT). The full column list is not published, so the user maps columns after upload.
 */

/** @typedef {{ ref: string, date: string, customerName: string, description: string, amountExVat: number }} FreightRow */
/** @typedef {{ ref: number, date: number, customer: number, description: number, amount: number }} ColumnMap */
/** @typedef {{ id: number, name: string }} SimpleItem */

const BRAND = 'Proteria Frakt';
const TITLE = 'Proteria Frakt Freight Rebilling';
const LEAD = 'Import the Proteria Frakt invoice report (Fakturarapport) and stage freight per shipment as ReAI draft customer orders for rebilling.';
const MAX_CSV_CHARS = 2_000_000;
const MAX_ROWS = 1000;
const SAMPLE_CSV = 'Shipment;Date;Receiver;Product;ProTeriaInvoiceNr;SenderName;AmountWithoutVAT\n70701234567890001;14.10.2026;Kyst Handel AS;Bring Pakke til bedrift;910001;Demo Lager AS;214,50\n70701234567890002;15.10.2026;Nordlys Retail AS;PostNord MyPack Collect;910001;Demo Lager AS;98,00';

/** @param {string} raw Norwegian or plain decimal amount. */
function parseAmount(raw) {
  let s = raw.replace(/[\s ]/g, '').replace(/[^0-9,.-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** @param {string} raw @returns {string} YYYY-MM-DD or '' */
function parseDate(raw) {
  const s = raw.trim();
  const iso = /^([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const no = /^([0-9]{1,2})[./]([0-9]{1,2})[./]([0-9]{4})/.exec(s);
  if (no) return `${no[3]}-${(no[2] ?? '').padStart(2, '0')}-${(no[1] ?? '').padStart(2, '0')}`;
  return '';
}

/** @param {string[]} headers @returns {ColumnMap} Preselects only the documented AmountWithoutVAT column. */
function defaultMap(headers) {
  const amount = headers.findIndex((h) => h.trim().toLowerCase() === 'amountwithoutvat');
  return { ref: -1, date: -1, customer: -1, description: -1, amount };
}

/**
 * Maps report rows to freight lines with the user's column choices.
 * @param {string} csvText
 * @param {ColumnMap} map
 * @returns {FreightRow[]}
 */
export function mapRows(csvText, map) {
  const doc = parseCsv(csvText);
  if (map.amount < 0 || map.date < 0) throw new HttpError(400, 'Choose the amount (ex. VAT) and date columns.');
  /** @param {string[]} r @param {number} i */
  const cell = (r, i) => (i >= 0 ? (r[i] ?? '').trim() : '');
  return doc.rows.slice(0, MAX_ROWS).map((r, i) => ({
    ref: cell(r, map.ref) || `PROTERIA-${i + 1}`,
    date: parseDate(cell(r, map.date)),
    customerName: cell(r, map.customer),
    description: (cell(r, map.description) ? `Freight ${cell(r, map.description)}` : 'Freight').concat(cell(r, map.ref) ? `, shipment ${cell(r, map.ref)}` : '').slice(0, 255),
    amountExVat: Number(parseAmount(cell(r, map.amount)).toFixed(2)),
  })).filter((x) => x.date && x.amountExVat > 0);
}

/** @param {string[]} headers @param {string} csvText @param {ColumnMap} map @param {number} defaultCustomerId */
function renderMapping(headers, csvText, map, defaultCustomerId) {
  /** @param {string} name @param {string} label @param {number} selected @param {boolean} required */
  const select = (name, label, selected, required) => html`<div class="field"><label for="pf-${name}">${label}</label><select id="pf-${name}" name="${name}"${required ? html` required` : ''}>
    <option value="-1">${required ? 'Choose column…' : 'Not used'}</option>
    ${headers.map((h, i) => html`<option value="${i}"${i === selected ? html` selected` : ''}>${h || `Column ${i + 1}`}</option>`)}
  </select></div>`;
  return reaiCard({
    eyebrow: 'MAP REPORT COLUMNS',
    title: `${headers.length} columns found`,
    body: html`<p class="muted-note">Proteria does not publish the full column list, so pick the columns from your report. AmountWithoutVAT is preselected when present.</p>
      <form class="stack" hx-post="/app/proteria/map" hx-target="#pf-output" hx-swap="innerHTML">
        <textarea name="csvText" hidden>${csvText}</textarea>
        <input type="hidden" name="defaultCustomerId" value="${defaultCustomerId}">
        <div class="mapping-grid">
          ${select('amount', 'Freight amount ex. VAT', map.amount, true)}
          ${select('date', 'Shipment or invoice date', map.date, true)}
          ${select('ref', 'Shipment number', map.ref, false)}
          ${select('customer', 'Receiver or customer', map.customer, false)}
          ${select('description', 'Carrier or product', map.description, false)}
        </div>
        <div><button type="submit" class="button primary">Preview freight lines</button></div>
      </form>`,
  });
}

/** @param {Array<{ row: FreightRow, customerId: number | null }>} rows @param {number} defaultCust @param {boolean} isSample */
function renderOrders(rows, defaultCust, isSample) {
  const total = rows.reduce((s, r) => s + r.row.amountExVat, 0);
  return reaiCard({
    eyebrow: 'PROTERIA FRAKT → REAI DRAFT ORDERS',
    title: `${rows.length} freight lines (${formatMinor(Math.round(total * 100))} NOK ex. VAT)`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Ready to stage', tone: 'success' }),
    body: rows.length === 0 ? reaiCallout({ tone: 'warn', body: 'No rows with a valid date and a positive amount.' }) : html`<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Shipment</th><th>Date</th><th>Customer</th><th>Description</th><th class="num">Ex. VAT</th><th>Action</th></tr></thead>
      <tbody>${rows.map(({ row, customerId }, idx) => {
        const cid = customerId ?? defaultCust;
        return html`<tr id="pf-o-${idx}"><td class="mono">${row.ref}</td><td class="mono">${row.date}</td><td><strong>${row.customerName || '—'}</strong></td><td>${row.description}</td><td class="num">${formatMinor(Math.round(row.amountExVat * 100))}</td><td>${isSample || cid <= 0
          ? html`<span class="muted-note">${isSample ? 'Demo only' : 'Select fallback customer'}</span>`
          : html`<form hx-post="/app/proteria/create-order" hx-target="#pf-o-${idx}" hx-swap="outerHTML"><input type="hidden" name="ref" value="${row.ref}"><input type="hidden" name="date" value="${row.date}"><input type="hidden" name="description" value="${row.description}"><input type="hidden" name="amount" value="${row.amountExVat.toFixed(2)}"><input type="hidden" name="customerId" value="${cid}"><button type="submit" class="button primary">Stage order</button></form>`}</td></tr>`;
      })}</tbody>
    </table></div>`,
  });
}

/** @param {import('../lib/types.d.ts').Env} env @param {Request} request @returns {Promise<SimpleItem[]>} */
async function loadCustomers(env, request) {
  const session = await readSession(env, request);
  if (!session || session.tenantId <= 0) return [];
  try { return /** @type {SimpleItem[]} */ (await reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId, query: { archived: 'false' } })); } catch { return []; }
}

/**
 * Handles /app/proteria/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/proteria';
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const customers = await loadCustomers(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">SHIPPING & FREIGHT BILLING</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-proteria-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${reaiCard({
          eyebrow: 'PROTERIA FAKTURARAPPORT CSV',
          title: 'Upload the Proteria invoice report',
          body: html`<p class="muted-note">The Proteria Frakt API only books shipments and has no freight cost list, so this app reads the invoice report. In reportingweb.proteria.com choose Lag Rapport → Fakturarapport and download it as CSV.</p>
            <form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#pf-output" hx-swap="innerHTML">
              <div class="inline-row"><div class="field"><label for="pf-cust">Fallback ReAI customer</label><select id="pf-cust" name="defaultCustomerId"><option value="0">${customers.length > 0 ? 'Match by name or choose…' : 'Connect to ReAI first'}</option>${customers.slice(0, 200).map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select></div></div>
              ${reaiDropzone({ inputId: 'pf-csv', name: 'file', accept: '.csv,text/csv,text/plain', label: 'Choose Fakturarapport CSV', hint: 'Semicolon separated, one row per shipment (simplified report).' })}
              <div class="inline-row"><button type="submit" class="button primary">Read columns</button><button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#pf-output" hx-swap="innerHTML">Load sample report</button></div>
            </form>`,
        })}
        <div id="pf-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${basePath}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) {
    const rows = mapRows(SAMPLE_CSV, { ref: 0, date: 1, customer: 2, description: 3, amount: 6 });
    return htmlResponse(renderOrders(rows.map((row) => ({ row, customerId: 1 })), 1, true));
  }
  try {
    const form = await request.formData();
    if (pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a CSV file first.');
      const text = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
      if (text.length > MAX_CSV_CHARS) throw new HttpError(400, 'Choose a report smaller than 2 MB, for example one invoice period.');
      const doc = parseCsv(text);
      if (doc.headers.length < 2 || doc.rows.length === 0) throw new HttpError(400, 'The file has no header row or no data rows.');
      return htmlResponse(renderMapping(doc.headers, text, defaultMap(doc.headers), Number(form.get('defaultCustomerId') ?? '0')));
    }
    if (pathname === `${basePath}/map`) {
      const text = String(form.get('csvText') ?? '');
      if (text.length > MAX_CSV_CHARS) throw new HttpError(413, 'Report too large.');
      /** @param {string} k */
      const idx = (k) => Number(form.get(k) ?? '-1');
      const rows = mapRows(text, { ref: idx('ref'), date: idx('date'), customer: idx('customer'), description: idx('description'), amount: idx('amount') });
      const byName = new Map((await loadCustomers(env, request)).map((c) => [c.name.trim().toLowerCase(), c.id]));
      return htmlResponse(renderOrders(rows.map((row) => ({ row, customerId: row.customerName ? byName.get(row.customerName.toLowerCase()) ?? null : null })), Number(form.get('defaultCustomerId') ?? '0'), false));
    }
    if (pathname === `${basePath}/create-order`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const ref = String(form.get('ref') ?? '').trim();
      const date = String(form.get('date') ?? '').slice(0, 10);
      const description = String(form.get('description') ?? 'Freight').trim().slice(0, 255);
      const amount = Number(form.get('amount') ?? '0');
      const customerId = Number(form.get('customerId') ?? '0');
      if (!ref || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !(amount > 0) || customerId <= 0) throw new HttpError(400, 'Shipment, date, amount and customer are required.');
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/orders', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { customerId, currencyCode: 'NOK', daysUntilDue: 14, issueDate: date, orderDate: date, externalReference: `proteria-${ref}`.slice(0, 100), comment: `${BRAND} ${ref}`, orderLines: [{ itemName: description, quantity: 1, unitPrice: Number(amount.toFixed(2)) }] } }));
      const url = `${reaiOrigin(env)}/order/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(html`<tr><td class="mono">${ref}</td><td class="mono">${date}</td><td>Customer #${customerId}</td><td>${description}</td><td class="num">${formatMinor(Math.round(amount * 100))}</td><td><a href="${url}" target="_blank" rel="noopener">Order #${created.id} ↗</a></td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
