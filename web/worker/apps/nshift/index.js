// @ts-check
import { fetchJson, num } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard } from '../../lib/ui.js';

/**
 * @typedef {{ ref: string, date: string, customerName: string, orderNo: string, description: string, amountExVat: number }} FreightRow
 * @typedef {{ orders: FreightRow[], nextFetchId: string, fetched: number, more: boolean, namesPartial: boolean }} FetchResult
 * @typedef {{ id: number, name: string }} SimpleItem
 */

const BRAND = 'nShift Delivery';
const TITLE = 'nShift Delivery Freight Rebilling';
const LEAD = 'Fetch stored freight prices for shipments printed in nShift Delivery and stage them as ReAI draft customer orders for rebilling freight.';
const API = 'https://api.unifaun.com/rs-extapi/v1';
// Subrequest budget per fetch: 1 token + up to 10 price batches (100 each) + up to 25 history pages (50 each) + ReAI customers.
const MAX_PRICE_CALLS = 10;
const MAX_HISTORY_PAGES = 25;
const OSLO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * Converts an nShift timestamp (for example 2015-06-02T14:05:56.342+0000) to the Europe/Oslo calendar day.
 * @param {unknown} value
 * @returns {string}
 */
function osloDay(value) {
  const raw = String(value ?? '').trim();
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(raw)) return '';
  if (raw.length <= 10) return raw.slice(0, 10);
  const ms = Date.parse(raw.replace(/([+-][0-9]{2})([0-9]{2})$/, '$1:$2'));
  return Number.isNaN(ms) ? raw.slice(0, 10) : OSLO_DAY.format(new Date(ms));
}

/** @param {string} day @param {number} offset */
function addDays(day, offset) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/**
 * Fetches stored shipment prices since a fetchId cursor, with receiver names from shipment history.
 * Docs: https://developers.nshiftone.com/delivery/authentication (GET /sessions/jwt with Basic Id:Secret Id, then Bearer),
 * https://developers.nshiftone.com/delivery/prices (POST /prices/history?fetchId, licence "REST API price enquiry"),
 * https://developers.nshiftone.com/delivery/shipment-history/get-shipments-history (GET /shipments-history?page&dateFrom&dateTo&dateType),
 * RAML: https://api.unifaun.com/rs-extapi/v1/documentation/root-resource-v1.raml
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<FetchResult>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const keyId = (creds.keyId ?? '').trim();
  const secretId = (creds.secretId ?? '').trim();
  const startFetchId = (creds.fetchId ?? '').trim() || '-1';
  if (!keyId || !secretId) throw new HttpError(400, 'Enter the nShift Delivery API key Id and Secret Id.');
  if (!/^-?[0-9A-Za-z_-]{1,64}$/.test(startFetchId)) throw new HttpError(400, 'fetchId must be -1 or the value returned by the previous fetch.');
  const session = await fetchJson(`${API}/sessions/jwt`, { method: 'GET', headers: { authorization: `Basic ${btoa(`${keyId}:${secretId}`)}`, accept: 'application/json' } }, BRAND, fetchImpl);
  const token = String(session?.token ?? '');
  if (!token) throw new HttpError(400, 'nShift Delivery did not return a session token.');
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json', 'content-type': 'application/json' };

  /** @type {any[]} */
  const prices = [];
  let fetchId = startFetchId;
  let more = false;
  for (let call = 0; call < MAX_PRICE_CALLS; call++) {
    // An empty body means no additional surcharges (documented body: { percent, amount }).
    const res = await fetchJson(`${API}/prices/history?fetchId=${encodeURIComponent(fetchId)}`, { method: 'POST', headers, body: '{}' }, BRAND, fetchImpl);
    const list = Array.isArray(res?.priceHistoryList) ? res.priceHistoryList : [];
    if (call === 0 && list.length === 0 && Number(res?.minDelay ?? 0) > 1000) {
      throw new HttpError(429, `nShift Delivery asks to wait ${Math.ceil(Number(res.minDelay) / 1000)} seconds before the next price fetch.`);
    }
    prices.push(...list);
    if (res?.fetchId !== undefined && res?.fetchId !== null) fetchId = String(res.fetchId);
    more = res?.done === false;
    if (!more) break;
  }

  // shipDate/printDate per PriceHistory.jsonschema; the RAML example uses lower-case shipdate/printdate.
  const shipDate = (/** @type {any} */ p) => osloDay(p.shipDate ?? p.shipdate ?? p.printDate ?? p.printdate);
  const dated = prices.map((p) => ({ p, date: shipDate(p) })).filter((x) => x.date);
  /** @type {Map<string, string>} */
  const receiverByShipment = new Map();
  /** @type {Map<string, string>} */
  const receiverByOrder = new Map();
  let namesPartial = false;
  if (dated.length > 0) {
    const days = dated.map((x) => x.date).sort();
    // Oslo days are at most two hours ahead of UTC, so one extra day on each side covers the window.
    const dateFrom = `${addDays(days[0] ?? '', -1)}T00:00:00+00:00`;
    const dateTo = `${addDays(days.at(-1) ?? days[0] ?? '', 1)}T00:00:00+00:00`;
    try {
      // The documented example response starts at page 0; 50 shipments per page.
      let done = false;
      for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
        const res = await fetchJson(`${API}/shipments-history?page=${page}&dateType=ship&dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`, { headers }, BRAND, fetchImpl);
        const list = Array.isArray(res?.shipments) ? res.shipments : [];
        for (const s of list) {
          if (!s?.rcvName) continue;
          if (s.shipmentNo) receiverByShipment.set(String(s.shipmentNo), String(s.rcvName));
          if (s.orderNo) receiverByOrder.set(String(s.orderNo), String(s.rcvName));
        }
        if (list.length === 0 || page + 1 >= Number(res?.totalPages ?? 0)) { done = true; break; }
      }
      namesPartial = !done;
    } catch {
      // Shipment History needs its own licence; receiver names are optional.
    }
  }

  /** @type {Map<string, FreightRow>} */
  const byRef = new Map();
  for (const { p, date } of dated) {
    const pd = p.priceData ?? {};
    const amount = Number(num(pd.priceWithAdditionalSurcharges ?? pd.price ?? 0).toFixed(2));
    const shipmentNo = String(p.shipmentNo ?? '').trim();
    const parcels = Number(p.parcelCount ?? 0);
    const service = [p.partnerId, p.serviceId].filter(Boolean).join(' ');
    const row = {
      ref: shipmentNo || String(p.orderNo ?? ''),
      date,
      customerName: receiverByShipment.get(shipmentNo) ?? receiverByOrder.get(String(p.orderNo ?? '').trim()) ?? '',
      orderNo: String(p.orderNo ?? '').trim(),
      description: `Freight ${service || 'shipment'}${parcels > 0 ? `, ${parcels} ${parcels === 1 ? 'parcel' : 'parcels'}` : ''}${shipmentNo ? `, shipment ${shipmentNo}` : ''}`.slice(0, 255),
      amountExVat: amount,
    };
    if (row.ref && row.amountExVat > 0) byRef.set(row.ref, row);
  }
  return { orders: [...byRef.values()], nextFetchId: fetchId, fetched: prices.length, more, namesPartial };
}

const SAMPLE = /** @type {FetchResult} */ ({
  orders: [
    { ref: '70712345678901234', date: '2026-10-14', customerName: 'Kyst Handel AS', orderNo: 'SO-3301', description: 'Freight PNL P19NO, 2 parcels, shipment 70712345678901234', amountExVat: 189 },
    { ref: '70712345678901299', date: '2026-10-15', customerName: 'Nordlys Retail AS', orderNo: 'SO-3305', description: 'Freight BRING PAF, 1 parcel, shipment 70712345678901299', amountExVat: 129 },
  ],
  nextFetchId: '123456',
  fetched: 2,
  more: false,
  namesPartial: false,
});

/** @param {Array<{ row: FreightRow, customerId: number | null }>} rows @param {number} defaultCust @param {FetchResult} result @param {boolean} isSample @param {string} currency */
function renderOrders(rows, defaultCust, result, isSample, currency) {
  const { nextFetchId } = result;
  const total = rows.reduce((s, r) => s + r.row.amountExVat, 0);
  return html`
    ${reaiCallout({ tone: 'info', title: `Next fetchId: ${nextFetchId}`, body: 'Save this value and enter it next time to get only prices stored after this fetch. nShift advises at most one new fetch every five minutes.' })}
    ${result.more ? reaiCallout({ tone: 'warn', body: 'More stored prices are waiting. Stage these, then fetch again with the fetchId above to get the next batch.' }) : ''}
    ${result.namesPartial ? reaiCallout({ tone: 'warn', body: 'Shipment History had more pages than one fetch reads, so some receiver names are missing. Pick the customer for those lines.' }) : ''}
    ${reaiCard({
      eyebrow: 'NSHIFT DELIVERY → REAI DRAFT ORDERS',
      title: `${rows.length} shipments (${formatMinor(Math.round(total * 100))} ex. VAT)`,
      badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Ready to stage', tone: 'success' }),
      body: rows.length === 0
        ? reaiCallout({ tone: 'warn', body: 'No new stored prices since this fetchId. Prices are stored within about 15 minutes after a shipment is printed.' })
        : html`<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Shipment</th><th>Ship date</th><th>Receiver</th><th>Description</th><th class="num">Ex. VAT</th><th>Action</th></tr></thead>
          <tbody>${rows.map(({ row, customerId }, idx) => {
            const cid = customerId ?? defaultCust;
            return html`<tr id="nsh-o-${idx}"><td class="mono">${row.ref}${row.orderNo ? html`<br><span class="muted-note">${row.orderNo}</span>` : ''}</td><td class="mono">${row.date}</td><td><strong>${row.customerName || '—'}</strong></td><td>${row.description}</td><td class="num">${formatMinor(Math.round(row.amountExVat * 100))}</td><td>${isSample || cid <= 0
              ? html`<span class="muted-note">${isSample ? 'Demo only' : 'Select fallback customer above'}</span>`
              : html`<form hx-post="/app/nshift/create-order" hx-target="#nsh-o-${idx}" hx-swap="outerHTML"><input type="hidden" name="ref" value="${row.ref}"><input type="hidden" name="orderNo" value="${row.orderNo}"><input type="hidden" name="date" value="${row.date}"><input type="hidden" name="description" value="${row.description}"><input type="hidden" name="amount" value="${row.amountExVat.toFixed(2)}"><input type="hidden" name="customerId" value="${cid}"><button type="submit" class="button primary">Stage order</button></form>`}</td></tr>`;
          })}</tbody>
        </table></div>
        <p class="muted-note">nShift prices follow your carrier agreement and have no currency field; orders are staged in ${currency}, the company currency. Check amounts against the carrier invoice.</p>`,
    })}
  `;
}

/**
 * Handles /app/nshift/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/nshift';
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    /** @type {SimpleItem[]} */ let customers = [];
    if (session && session.tenantId > 0) {
      try { customers = /** @type {SimpleItem[]} */ (await reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId, query: { archived: 'false' } })); } catch { customers = []; }
    }
    const body = html`
      <section class="app-intro"><p class="eyebrow">MULTI-CARRIER SHIPPING & FREIGHT BILLING</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-nshift-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${reaiCard({
          eyebrow: 'LIVE NSHIFT DELIVERY API',
          title: 'Fetch freight prices from nShift Delivery',
          body: html`<p class="muted-note">Create a key in nShift Delivery under Maintenance → API keys → New API key. Prices need the REST API price enquiry licence; receiver names use REST API Shipment History when available. The key is used for this single request and never stored.</p>
            <form class="stack" hx-post="${basePath}/fetch-api" hx-target="#nsh-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="nsh-id">API key Id</label><input id="nsh-id" name="keyId" type="text" autocomplete="off" required></div>
                <div class="field"><label for="nsh-secret">Secret Id</label><input id="nsh-secret" name="secretId" type="password" autocomplete="off" required></div>
                <div class="field"><label for="nsh-fetch">Continue from fetchId</label><input id="nsh-fetch" name="fetchId" type="text" value="-1" required></div>
                <div class="field"><label for="nsh-cust">Fallback ReAI customer</label><select id="nsh-cust" name="defaultCustomerId"><option value="0">${customers.length > 0 ? 'Match receiver by name or choose…' : 'Connect to ReAI first'}</option>${customers.slice(0, 200).map((c) => html`<option value="${c.id}">${c.name}</option>`)}</select></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Fetch from nShift API</button>
                <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#nsh-output" hx-swap="innerHTML">Load sample preview</button>
              </div>
            </form>`,
        })}
        <div id="nsh-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${basePath}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) return htmlResponse(renderOrders(SAMPLE.orders.map((row) => ({ row, customerId: 1 })), 1, SAMPLE, true, 'NOK'));
  try {
    const form = await request.formData();
    const session = await readSession(env, request);
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      const result = await fetchApi(creds);
      /** @type {SimpleItem[]} */ let custs = [];
      if (session && session.tenantId > 0) {
        try { custs = /** @type {SimpleItem[]} */ (await reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId, query: { archived: 'false' } })); } catch { custs = []; }
      }
      const byName = new Map(custs.map((c) => [c.name.trim().toLowerCase(), c.id]));
      const currency = session?.tenants.find((t) => t.id === session.tenantId)?.currencyCode ?? 'NOK';
      return htmlResponse(renderOrders(result.orders.map((row) => ({ row, customerId: byName.get(row.customerName.trim().toLowerCase()) ?? null })), Number(creds.defaultCustomerId ?? '0'), result, false, currency));
    }
    if (pathname === `${basePath}/create-order`) {
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const ref = String(form.get('ref') ?? '').trim();
      const orderNo = String(form.get('orderNo') ?? '').trim();
      const date = String(form.get('date') ?? '').slice(0, 10);
      const description = String(form.get('description') ?? 'Freight').trim().slice(0, 255);
      const amount = Number(form.get('amount') ?? '0');
      const customerId = Number(form.get('customerId') ?? '0');
      if (!ref || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !(amount > 0) || customerId <= 0) throw new HttpError(400, 'Shipment, date, amount and customer are required.');
      const currencyCode = session.tenants.find((t) => t.id === session.tenantId)?.currencyCode ?? 'NOK';
      const externalReference = `nshift-${ref}`.slice(0, 100);
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const existing = /** @type {{ items: Array<{ id: number }> }} */ (await reaiRequest(env, '/api/orders', { ...auth, query: { externalReference, page: '1', pageSize: '1' } }));
      const dup = existing.items?.[0];
      if (dup) {
        const dupUrl = `${reaiOrigin(env)}/order/${dup.id}?tenantId=${session.tenantId}`;
        return htmlResponse(html`<tr><td class="mono">${ref}</td><td class="mono">${date}</td><td>Already staged</td><td>${description}</td><td class="num">${formatMinor(Math.round(amount * 100))}</td><td><a href="${dupUrl}" target="_blank" rel="noopener">Order #${dup.id} ↗</a></td></tr>`);
      }
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/orders', { ...auth, method: 'POST', body: { customerId, currencyCode, daysUntilDue: 14, issueDate: date, orderDate: date, externalReference, comment: `${BRAND} shipment ${ref}${orderNo ? ` (order ${orderNo})` : ''}`, orderLines: [{ itemName: description, quantity: 1, unitPrice: Number(amount.toFixed(2)) }] } }));
      const url = `${reaiOrigin(env)}/order/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(html`<tr><td class="mono">${ref}</td><td class="mono">${date}</td><td>Customer #${customerId}</td><td>${description}</td><td class="num">${formatMinor(Math.round(amount * 100))}</td><td><a href="${url}" target="_blank" rel="noopener">Order #${created.id} ↗</a></td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
