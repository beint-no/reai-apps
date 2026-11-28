// @ts-check
import { assertPublicHttpsUrl, fetchJson, isoDate, num, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';
import { extractNorwegianOrg } from './recman-core.js';

/**
 * @typedef {{ name: string, quantity: number, unitPrice: number, ratePct: number | null }} OrderLine
 * @typedef {{ id: string, number: string, date: string, currency: string, customerName: string, customerEmail: string, orgnr: string, company: boolean, lines: OrderLine[] }} ShopOrder
 * @typedef {{ code: string, rate: number, vatType: string }} VatCode
 */

const SLUG = 'salesforce';
const BRAND = 'Salesforce';
const BASE_PATH = '/app/salesforce';
const TITLE = 'Salesforce Won Opportunities to ReAI';
const EYEBROW = 'CRM · ORDERS';
const LEAD = 'Stage Closed Won Salesforce opportunities as ReAI orders for invoicing, with their products and the account as customer.';
const API_HINT = 'In Salesforce Setup create an external client app (or connected app) with OAuth scope api, enable the client credentials flow and choose a run as user. Copy the consumer key and consumer secret, and use your My Domain URL.';
/** @type {import('../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [
  { name: 'domainUrl', label: 'My Domain URL', type: 'url', placeholder: 'https://yourcompany.my.salesforce.com' },
  { name: 'clientId', label: 'Consumer key' },
  { name: 'clientSecret', label: 'Consumer secret', type: 'password' },
  { name: 'from', label: 'Close date from', type: 'date', defaultValue: '$MONTH_START' },
  { name: 'to', label: 'To', type: 'date', defaultValue: '$TODAY' },
  { name: 'currency', label: 'Currency', defaultValue: 'NOK' },
  { name: 'orgField', label: 'Account field with org number (optional)', required: false, placeholder: 'Organisasjonsnummer__c' },
];
const API_VERSION = 'v66.0';

/** @type {ShopOrder[]} */
const SAMPLE = [
  {
    id: '006SAMPLE000001', number: 'Serviceavtale 2027', date: '2026-10-20', currency: 'NOK', customerName: 'Nordic Maritime AS', customerEmail: '', orgnr: '935606403', company: true,
    lines: [
      { name: 'Serviceavtale, årlig', quantity: 1, unitPrice: 145000, ratePct: null },
      { name: 'Oppstartsworkshop', quantity: 2, unitPrice: 9500, ratePct: null },
    ],
  },
];

/**
 * Splits an ex VAT line total into quantity and a unit price with two decimals.
 * @param {string} name @param {number} quantity @param {number} total @param {number | null} pct
 * @returns {OrderLine}
 */
function line(name, quantity, total, pct) {
  const q = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
  const unit = Math.round((total * 100) / q) / 100;
  if (Math.round(unit * q * 100) === Math.round(total * 100)) return { name, quantity: q, unitPrice: unit, ratePct: pct };
  return { name: `${quantity} x ${name}`, quantity: 1, unitPrice: Math.round(total * 100) / 100, ratePct: pct };
}

/**
 * Fetches Closed Won opportunities in a close date range with their products.
 * Docs: https://developer.salesforce.com/blogs/2023/03/using-the-client-credentials-flow-for-easier-api-authentication
 * (POST https://MyDomain.my.salesforce.com/services/oauth2/token, grant_type client_credentials, returns access_token and
 * instance_url), https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_query.htm
 * (GET /services/data/vXX.X/query?q=SOQL, records[], done, nextRecordsUrl) and the Opportunity and OpportunityLineItem objects in
 * https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_opportunity.htm.
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<ShopOrder[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const domain = assertPublicHttpsUrl(creds.domainUrl ?? '');
  if (!/\.salesforce\.com$/i.test(domain.hostname)) throw new HttpError(400, 'Use your Salesforce My Domain URL, for example https://yourcompany.my.salesforce.com.');
  const clientId = (creds.clientId ?? '').trim();
  const clientSecret = (creds.clientSecret ?? '').trim();
  if (!clientId || !clientSecret) throw new HttpError(400, 'Enter the consumer key and consumer secret.');
  const from = isoDate(creds.from);
  const to = isoDate(creds.to);
  const currency = (creds.currency ?? 'NOK').trim().toUpperCase() || 'NOK';
  if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, 'Enter a three letter currency code.');
  const orgField = (creds.orgField ?? '').trim();
  if (orgField && !/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(orgField)) throw new HttpError(400, 'Enter the API name of the account field, for example Organisasjonsnummer__c.');
  const tok = await fetchJson(`${domain.origin}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
  }, BRAND, fetchImpl);
  if (typeof tok?.access_token !== 'string') throw new HttpError(400, 'Salesforce did not return an access token.');
  const instance = assertPublicHttpsUrl(typeof tok.instance_url === 'string' ? tok.instance_url : domain.origin);
  const headers = { authorization: `Bearer ${tok.access_token}`, accept: 'application/json' };
  const soql = `SELECT Id, Name, Amount, CloseDate, Account.Name${orgField ? `, Account.${orgField}` : ''}, (SELECT Name, Quantity, TotalPrice FROM OpportunityLineItems) FROM Opportunity WHERE IsWon = true AND CloseDate >= ${from} AND CloseDate <= ${to} ORDER BY CloseDate LIMIT 500`;
  /** @type {ShopOrder[]} */
  const orders = [];
  let url = `${instance.origin}/services/data/${API_VERSION}/query?${new URLSearchParams({ q: soql })}`;
  for (let page = 0; page < 5; page++) {
    const data = await fetchJson(url, { headers }, BRAND, fetchImpl);
    for (const r of /** @type {any[]} */ (Array.isArray(data?.records) ? data.records : [])) {
      /** @type {any[]} */ const items = Array.isArray(r.OpportunityLineItems?.records) ? r.OpportunityLineItems.records : [];
      /** @type {OrderLine[]} */
      const lines = items.length > 0
        ? items.map((li) => line(String(li.Name ?? 'Product').slice(0, 200), num(li.Quantity), num(li.TotalPrice), null))
        : [line(String(r.Name ?? 'Opportunity').slice(0, 200), 1, num(r.Amount), null)];
      orders.push({
        id: String(r.Id ?? ''),
        number: String(r.Name ?? r.Id ?? '').slice(0, 80),
        date: isoDate(r.CloseDate),
        currency,
        customerName: String(r.Account?.Name ?? '').trim(),
        customerEmail: '',
        orgnr: orgField ? extractNorwegianOrg(String(r.Account?.[orgField] ?? '')) : '',
        company: true,
        lines: lines.filter((l) => l.unitPrice !== 0),
      });
    }
    if (data?.done !== false || typeof data?.nextRecordsUrl !== 'string' || !data.nextRecordsUrl.startsWith('/services/data/')) break;
    url = `${instance.origin}${data.nextRecordsUrl}`;
  }
  return orders.filter((o) => o.id && o.customerName && o.lines.length > 0);
}

/** @param {ShopOrder} o */
function orderTotal(o) {
  return o.lines.reduce((t, l) => t + Math.round(l.unitPrice * 100) * l.quantity, 0);
}

/** @param {ShopOrder[]} orders @param {boolean} isSample */
function renderOrders(orders, isSample) {
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} WON DEALS → REAI ORDERS`,
    title: `${orders.length} won deals`,
    badge: isSample ? reaiBadge({ text: 'Sample', tone: 'accent' }) : reaiBadge({ text: 'Live from Salesforce', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Won deals', value: String(orders.length) })}
        ${reaiMetric({ label: 'Total excl. VAT', value: formatMinor(orders.reduce((t, o) => t + orderTotal(o), 0)) })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Deal</th><th>Date</th><th>Customer</th><th>Lines</th><th class="num">Excl. VAT</th><th>Action</th></tr></thead>
        <tbody>${orders.slice(0, 200).map((o, idx) => html`<tr id="${SLUG}-o-${idx}">
          <td class="mono">${o.number}</td><td class="mono">${o.date}</td><td>${o.customerName}${o.orgnr ? ` (${o.orgnr})` : ''}</td>
          <td>${o.lines.map((l) => html`<div>${l.quantity} x ${l.name} (${l.ratePct === null ? 'default VAT' : `${l.ratePct}% VAT`})</div>`)}</td>
          <td class="num">${formatMinor(orderTotal(o))} ${o.currency}</td>
          <td>${isSample
            ? html`<span class="muted-note">Sample only</span>`
            : html`<form hx-post="${BASE_PATH}/stage" hx-target="#${SLUG}-o-${idx}" hx-swap="outerHTML">
                <input type="hidden" name="orderJson" value="${JSON.stringify(o)}">
                <button type="submit" class="button primary">Stage in ReAI</button>
              </form>`}</td>
        </tr>`)}</tbody>
      </table></div>
      <p class="muted-note">Each won deal becomes a ReAI order for review before invoicing, with the ReAI default VAT code on each line. The customer is matched by organization number or name, or created as a new company customer. Orders already staged are skipped by their Salesforce id.</p>
    `,
  });
}

/**
 * Maps a VAT percentage to a ReAI customer invoice VAT code.
 * @param {VatCode[]} codes @param {number | null} pct
 */
function vatCodeFor(codes, pct) {
  if (pct === null) return undefined;
  const same = codes.filter((c) => Math.abs(c.rate - pct) < 0.001);
  const match = same.find((c) => c.vatType === 'output_vat') ?? (pct === 0 ? (same.find((c) => c.vatType === 'exempt') ?? same.find((c) => c.vatType === 'outside_scope')) : undefined);
  if (!match) throw new HttpError(400, `ReAI has no invoice VAT code for ${pct}% in this company.`);
  return match.code;
}

/**
 * Finds the ReAI customer by organization number or name, or creates a company customer.
 * @param {import('../lib/types.d.ts').Env} env @param {{ token: string, tenantId: number }} auth @param {ShopOrder} o
 */
async function customerFor(env, auth, o) {
  /** @param {Record<string, string>} query */
  const find = async (query) => /** @type {{ items: Array<{ id: number, archived: boolean }> }} */ (await reaiRequest(env, '/api/customers', { ...auth, query: { ...query, pageSize: '5' } })).items.find((c) => !c.archived)?.id;
  const orgnr = extractNorwegianOrg(String(o.orgnr ?? ''));
  const hit = (orgnr ? await find({ organizationNumber: orgnr }) : undefined) ?? (await find({ name: o.customerName }));
  if (hit) return hit;
  const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/customers', { ...auth, method: 'POST', body: { name: o.customerName.slice(0, 200), organizationNumber: orgnr || null, privateContact: false } }));
  return created.id;
}

/**
 * Handles /app/salesforce/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE_PATH && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE_PATH}/`, request.url), 301);
  if (pathname === `${BASE_PATH}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">${EYEBROW}</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${SLUG}-web`, clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({ basePath: BASE_PATH, targetId: `${SLUG}-output`, brand: BRAND, hint: API_HINT, fields: API_FIELDS, sampleAction: true })}
        <div id="${SLUG}-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderOrders(SAMPLE, true));
  try {
    const form = await request.formData();
    if (pathname === `${BASE_PATH}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderOrders(await fetchApi(creds), false));
    }
    if (pathname === `${BASE_PATH}/stage`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const o = /** @type {ShopOrder} */ (JSON.parse(String(form.get('orderJson') ?? '{}')));
      if (!o.id || !Array.isArray(o.lines) || o.lines.length === 0 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(o.date)) || !/^[A-Z]{3}$/.test(String(o.currency))) throw new HttpError(400, 'The deal is incomplete.');
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const externalReference = `salesforce-${o.id}`.slice(0, 100);
      const existing = /** @type {{ items: Array<{ id: number, number: string }> }} */ (await reaiRequest(env, '/api/orders', { ...auth, query: { externalReference } }));
      const dup = existing.items[0];
      const cells = html`<td class="mono">${o.number}</td><td class="mono">${o.date}</td><td>${o.customerName}</td><td></td><td class="num">${formatMinor(orderTotal(o))} ${o.currency}</td>`;
      if (dup) return htmlResponse(html`<tr>${cells}<td><a href="${reaiOrigin(env)}/order/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Already staged (${dup.number}) ↗</a></td></tr>`);
      const codes = /** @type {VatCode[]} */ (await reaiRequest(env, '/api/vat-codes', { ...auth, query: { usage: 'customer_invoice' } }));
      const customerId = await customerFor(env, auth, o);
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/orders', {
        ...auth,
        method: 'POST',
        body: {
          customerId, currencyCode: o.currency, daysUntilDue: 14, issueDate: o.date, orderDate: o.date, externalReference,
          comment: `${BRAND} ${o.number}`.slice(0, 200),
          orderLines: o.lines.map((l) => {
            const vatCode = vatCodeFor(codes, l.ratePct);
            return { itemName: String(l.name).slice(0, 200), quantity: Number(l.quantity), unitPrice: Number(Number(l.unitPrice).toFixed(2)), ...(vatCode ? { vatCode } : {}) };
          }),
        },
      }));
      return htmlResponse(html`<tr>${cells}<td><a href="${reaiOrigin(env)}/order/${created.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Order ${created.number} ↗</a></td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
