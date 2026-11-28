// @ts-check
import { fetchJson, isoDate, num, pickList, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/** @typedef {{ ref: string, date: string, customerName: string, description: string, amountExVat: number }} OrderRow */
/** @typedef {{ id: number, name: string }} SimpleItem */

const BRAND = "Logistra Cargonizer & Shipmondo";
const TITLE = "Logistra Cargonizer / Shipmondo Freight";
const LEAD = "Import shipping manifests and billable freight surcharges from Logistra Cargonizer, Shipmondo or nShift into ReAI draft customer orders.";
const SAMPLE_CSV = "OrdreNr;Dato;Kunde;Belop;Beskrivelse\nLOG-3301;2026-10-14;Kyst Handel AS;1490,00;Bring Bedriftspakke 12 kolli (EDI)\nLOG-3305;2026-10-17;Nordlys Retail AS;890,00;PostNord MyPack Collect sending";

/** @param {Record<string, string>} creds @param {import('../lib/api-http.js').FetchLike} [fetchImpl] */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const senderId = (creds.senderId ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!token || !senderId) throw new HttpError(400, 'Enter both X-Cargonizer-Key and X-Cargonizer-Sender ID.');
  const data = await fetchJson(`https://cargonizer.no/consignments.json?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: { 'x-cargonizer-key': token, 'x-cargonizer-sender': senderId, accept: 'application/json' } }, 'Logistra Cargonizer', fetchImpl);
  const orders = pickList(data).map((o, i) => ({ ref: String(o.number ?? o.id ?? `LOG-${i + 1}`), date: isoDate(o.createdAt ?? o.date, to), customerName: String(o.consignee?.name ?? o.customerName ?? '—'), description: String(o.product ?? o.description ?? 'Freight consignment'), amountExVat: Number(num(o.freightCost ?? o.price ?? o.amountExVat ?? 0).toFixed(2)) })).filter((o) => o.amountExVat > 0);
  if (orders.length === 0) throw new HttpError(400, `Logistra Cargonizer returned 0 priced consignments for ${from}–${to}.`);
  return orders;
}

/** @param {string} csvText @returns {OrderRow[]} */
function parseOrdersCsv(csvText) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const rIdx = norm.findIndex((h) => h.includes('ordre') || h.includes('ref') || h.includes('id'));
  const dIdx = norm.findIndex((h) => h.includes('dato') || h.includes('date'));
  const cIdx = norm.findIndex((h) => h.includes('kunde') || h.includes('customer'));
  const aIdx = norm.findIndex((h) => h.includes('belop') || h.includes('beløp') || h.includes('amount') || h.includes('sum'));
  const descIdx = norm.findIndex((h) => h.includes('beskrivelse') || h.includes('desc'));
  if (dIdx < 0 || aIdx < 0) throw new HttpError(400, 'CSV must include Dato/Date and Beløp/Amount columns.');
  return doc.rows.map((r, i) => ({
    ref: rIdx >= 0 && (r[rIdx] ?? '').trim() ? (r[rIdx] ?? '').trim() : `LOGISTRA-${i + 1}`,
    date: (r[dIdx] ?? '').trim().slice(0, 10),
    customerName: cIdx >= 0 ? (r[cIdx] ?? '').trim() || '—' : '—',
    amountExVat: Number(Math.max(0, num(r[aIdx])).toFixed(2)),
    description: descIdx >= 0 ? (r[descIdx] ?? '').trim() || 'Order' : 'Order',
  })).filter((x) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x.date) && x.amountExVat > 0);
}

/** @param {Array<{ row: OrderRow, customerId: number | null }>} rows @param {number} defaultCust @param {boolean} isSample */
function renderOrders(rows, defaultCust, isSample) {
  const total = rows.reduce((s, r) => s + r.row.amountExVat, 0);
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI DRAFT ORDERS`,
    title: `${rows.length} orders (${formatMinor(Math.round(total * 100))} NOK ex. VAT)`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Ready to stage', tone: 'success' }),
    body: html`<div class="table-wrap"><table class="data-table">
      <thead><tr><th>Ref</th><th>Date</th><th>Customer</th><th>Description</th><th class="num">Ex. VAT</th><th>Action</th></tr></thead>
      <tbody>${rows.map(({ row, customerId }, idx) => {
        const cid = customerId ?? defaultCust;
        return html`<tr id="ta-o-${idx}"><td class="mono">${row.ref}</td><td class="mono">${row.date}</td><td><strong>${row.customerName}</strong></td><td>${row.description}</td><td class="num">${formatMinor(Math.round(row.amountExVat * 100))}</td><td>${isSample || cid <= 0 ? html`<span class="muted-note">${isSample ? 'Demo only' : 'Select fallback customer above'}</span>` : html`<form hx-post="/app/logistra/create-order" hx-target="#ta-o-${idx}" hx-swap="outerHTML"><input type="hidden" name="ref" value="${row.ref}"><input type="hidden" name="date" value="${row.date}"><input type="hidden" name="description" value="${row.description}"><input type="hidden" name="amount" value="${row.amountExVat.toFixed(2)}"><input type="hidden" name="customerId" value="${cid}"><button type="submit" class="button primary">Stage order</button></form>`}</td></tr>`;
      })}</tbody>
    </table></div>`,
  });
}

/**
 * Handles /app/logistra/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/logistra';
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    /** @type {SimpleItem[]} */ let customers = [];
    if (session && session.tenantId > 0) {
      try { customers = /** @type {SimpleItem[]} */ (await reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId, query: { archived: 'false' } })); } catch { /* ignore */ }
    }
    const body = html`
      <section class="app-intro"><p class="eyebrow">EDI SHIPPING & FREIGHT BILLING</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-logistra-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({ basePath, targetId: 'ta-output', brand: BRAND, hint: "Connect official Logistra Cargonizer API with your X-Cargonizer-Key and Sender ID.", fields: [{"name": "apiToken", "label": "X-Cargonizer-Key", "type": "password", "placeholder": "Cargonizer API key"}, {"name": "senderId", "label": "X-Cargonizer-Sender ID", "type": "text", "placeholder": "Sender ID"}, {"name": "fromDate", "label": "From date", "type": "date", "defaultValue": "$MONTH_START"}, {"name": "toDate", "label": "To date", "type": "date", "defaultValue": "$TODAY"}], sampleAction: true })}
        ${reaiCard({
          eyebrow: `${BRAND.toUpperCase()} → REAI ORDERS`,
          title: `Upload ${BRAND} order export CSV`,
          body: html`<form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#ta-output" hx-swap="innerHTML">
            <div class="inline-row"><div class="field"><label for="ta-cust">Fallback ReAI customer</label><select id="ta-cust" name="defaultCustomerId"><option value="0">${customers.length > 0 ? 'Match by name or choose…' : 'Connect to ReAI first'}</option>${customers.slice(0, 200).map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select></div></div>
            ${reaiDropzone({ inputId: 'ta-csv', name: 'file', accept: '.csv,text/csv,text/plain', label: `Choose ${BRAND} CSV`, hint: 'CSV with OrdreNr, Dato, Kunde, Beløp (ex. VAT) and Beskrivelse.' })}
            <div class="inline-row"><button type="submit" class="button primary">Preview</button><button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#ta-output" hx-swap="innerHTML">Load sample export</button></div>
          </form>`,
        })}
        <div id="ta-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${basePath}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) return htmlResponse(renderOrders(parseOrdersCsv(SAMPLE_CSV).map((row) => ({ row, customerId: 1 })), 1, true));
  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderOrders((await fetchApi(creds)).map((row) => ({ row, customerId: null })), 0, false));
    }
    if (pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a CSV file first.');
      const parsed = parseOrdersCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer())));
      const session = await readSession(env, request);
      /** @type {SimpleItem[]} */ let custs = [];
      if (session && session.tenantId > 0) {
        try { custs = /** @type {SimpleItem[]} */ (await reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId, query: { archived: 'false' } })); } catch { /* ignore */ }
      }
      const byName = new Map(custs.map((c) => [c.name.trim().toLowerCase(), c.id]));
      return htmlResponse(renderOrders(parsed.map((row) => ({ row, customerId: byName.get(row.customerName.trim().toLowerCase()) ?? null })), Number(form.get('defaultCustomerId') ?? '0'), false));
    }
    if (pathname === `${basePath}/create-order`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const ref = String(form.get('ref') ?? '').trim();
      const date = String(form.get('date') ?? '').slice(0, 10);
      const description = String(form.get('description') ?? BRAND).trim().slice(0, 255);
      const amount = Number(form.get('amount') ?? '0');
      const customerId = Number(form.get('customerId') ?? '0');
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/orders', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { customerId, currencyCode: 'NOK', daysUntilDue: 14, issueDate: date, orderDate: date, externalReference: `logistra-${ref}`.slice(0, 100), comment: `${BRAND} ${ref}`, orderLines: [{ itemName: description, quantity: 1, unitPrice: Number(amount.toFixed(2)) }] } }));
      const url = `${reaiOrigin(env)}/order/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(html`<tr><td class="mono">${ref}</td><td class="mono">${date}</td><td>Customer #${customerId}</td><td>${description}</td><td class="num">${formatMinor(Math.round(amount * 100))}</td><td><a href="${url}" target="_blank" rel="noopener">Order #${created.id} ↗</a></td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
