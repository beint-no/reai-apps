// @ts-check
import { fetchJson, num, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiRequest } from '../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';
import { extractNorwegianOrg } from './recman-core.js';

/** @typedef {{ kind: 'customer' | 'supplier' | 'product', externalId: string, name: string, orgnr: string, email: string, price: number }} MigrateItem */

const SLUG = 'poweroffice-migrate';
const BRAND = 'PowerOffice Go';
const BASE_PATH = `/app/${SLUG}`;
const TITLE = 'Switch from PowerOffice Go to ReAI';
const LEAD = 'Fetch customers, suppliers and products from the PowerOffice Go API and import them into ReAI with their numbers and organization numbers.';
const API_HINT = 'PowerOffice issues the application key and subscription key when you register your own integration with PowerOffice (go-api@poweroffice.no). The client key appears when you activate that integration in PowerOffice Go.';
/** @type {import('../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [
  { name: 'subscriptionKey', label: 'Subscription key', type: 'password', placeholder: 'Ocp-Apim-Subscription-Key' },
  { name: 'applicationKey', label: 'Application key', type: 'password' },
  { name: 'clientKey', label: 'Client key', type: 'password' },
];
const AUTH_URL = 'https://goapi.poweroffice.net/OAuth/Token';
const API = 'https://goapi.poweroffice.net/v2';
const PAGE_SIZE = 1000;
const MAX_ITEMS = 2000;

/** @type {MigrateItem[]} */
const SAMPLE = [
  { kind: 'customer', externalId: '10001', name: 'Fjord Bygg AS', orgnr: '935606403', email: 'post+fjordbygg@aiak.no', price: 0 },
  { kind: 'supplier', externalId: '20001', name: 'Norsk Grossist AS', orgnr: '923609016', email: 'post+grossist@aiak.no', price: 0 },
  { kind: 'product', externalId: 'KONS-1', name: 'Konsulenttime', orgnr: '', email: '', price: 1450 },
];

/**
 * Reads every page of one PowerOffice Go v2 list endpoint.
 * @param {string} path
 * @param {Record<string, string>} headers
 * @param {import('../lib/api-http.js').FetchLike} fetchImpl
 * @returns {Promise<any[]>}
 */
async function readAll(path, headers, fetchImpl) {
  /** @type {any[]} */ const all = [];
  for (let page = 1; page <= 5 && all.length < MAX_ITEMS; page++) {
    const data = await fetchJson(`${API}${path}?${new URLSearchParams({ PageNumber: String(page), PageSize: String(PAGE_SIZE) })}`, { headers }, BRAND, fetchImpl);
    const rows = Array.isArray(data) ? data : [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

/**
 * Fetches customers, suppliers and products from PowerOffice Go API v2.
 * Docs: https://developer.poweroffice.net/documentation/authentication (POST /OAuth/Token with
 * Basic base64(applicationKey:clientKey), Ocp-Apim-Subscription-Key, grant_type=client_credentials; token lasts 20 minutes),
 * https://swagger.poweroffice.net/openapispecs/customers.json (GET /v2/Customers: Number, Name, OrganizationNumber, EmailAddress, IsArchived),
 * https://swagger.poweroffice.net/openapispecs/suppliers.json (GET /v2/Suppliers) and
 * https://swagger.poweroffice.net/openapispecs/products.json (GET /v2/Products: Code, Name, UnitPrice, IsArchived).
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<MigrateItem[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const subscriptionKey = (creds.subscriptionKey ?? '').trim();
  const applicationKey = (creds.applicationKey ?? '').trim();
  const clientKey = (creds.clientKey ?? '').trim();
  if (!subscriptionKey || !applicationKey || !clientKey) throw new HttpError(400, 'Enter the subscription key, application key and client key.');
  const login = await fetchJson(AUTH_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${applicationKey}:${clientKey}`)}`,
      'ocp-apim-subscription-key': subscriptionKey,
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  }, BRAND, fetchImpl);
  const token = typeof login?.access_token === 'string' ? login.access_token : '';
  if (!token) throw new HttpError(400, 'PowerOffice Go did not return an access token. Check the three keys.');
  const headers = { authorization: `Bearer ${token}`, 'ocp-apim-subscription-key': subscriptionKey, accept: 'application/json' };

  const customers = await readAll('/Customers', headers, fetchImpl);
  const suppliers = await readAll('/Suppliers', headers, fetchImpl);
  const products = await readAll('/Products', headers, fetchImpl);
  /** @param {any} c */
  const contactName = (c) => String(c.Name ?? '').trim() || [c.FirstName, c.LastName].filter(Boolean).join(' ').trim();
  /** @type {MigrateItem[]} */
  const items = [];
  for (const c of customers) {
    if (c.IsArchived === true || !contactName(c)) continue;
    items.push({ kind: 'customer', externalId: String(c.Number ?? ''), name: contactName(c), orgnr: extractNorwegianOrg(String(c.OrganizationNumber ?? '')), email: String(c.EmailAddress ?? c.InvoiceEmailAddress ?? '').trim(), price: 0 });
  }
  for (const s of suppliers) {
    if (s.IsArchived === true || !contactName(s)) continue;
    items.push({ kind: 'supplier', externalId: String(s.Number ?? ''), name: contactName(s), orgnr: extractNorwegianOrg(String(s.OrganizationNumber ?? '')), email: String(s.EmailAddress ?? '').trim(), price: 0 });
  }
  for (const p of products) {
    if (p.IsArchived === true || !String(p.Name ?? '').trim()) continue;
    items.push({ kind: 'product', externalId: String(p.Code ?? p.Id ?? ''), name: String(p.Name).trim(), orgnr: '', email: '', price: Math.max(0, num(p.UnitPrice)) });
  }
  if (items.length === 0) throw new HttpError(400, 'PowerOffice Go returned no active customers, suppliers or products.');
  return items.slice(0, MAX_ITEMS);
}

/** @param {MigrateItem} it @param {import('../lib/html.js').HtmlValue} action */
function itemRow(it, action) {
  return html`<td>${reaiBadge({ text: it.kind, tone: it.kind === 'product' ? 'accent' : 'neutral' })}</td>
    <td class="mono">${it.externalId || '—'}</td>
    <td><strong>${it.name}</strong>${it.email ? html`<br><span class="muted-note">${it.email}</span>` : ''}</td>
    <td class="mono">${it.kind === 'product' ? `${it.price.toFixed(2)} NOK` : it.orgnr || '—'}</td>
    <td>${action}</td>`;
}

/** @param {MigrateItem[]} items @param {boolean} isSample */
function renderItems(items, isSample) {
  /** @param {MigrateItem['kind']} k */
  const count = (k) => String(items.filter((i) => i.kind === k).length);
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI`,
    title: 'Records ready to import',
    badge: isSample ? reaiBadge({ text: 'Sample', tone: 'accent' }) : reaiBadge({ text: 'Ready to import', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Customers', value: count('customer') })}
        ${reaiMetric({ label: 'Suppliers', value: count('supplier') })}
        ${reaiMetric({ label: 'Products', value: count('product'), detail: 'Price excluding VAT' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Type</th><th>Number</th><th>Name</th><th>Org.nr / price</th><th>Action</th></tr></thead>
        <tbody>${items.map((it, idx) => html`<tr id="sw-row-${idx}">${itemRow(it, isSample
          ? html`<span class="muted-note">Sample only</span>`
          : html`<form hx-post="${BASE_PATH}/import-one" hx-target="#sw-row-${idx}" hx-swap="outerHTML">
              <input type="hidden" name="row" value="${idx}"><input type="hidden" name="itemJson" value="${JSON.stringify(it)}"><button type="submit" class="button primary">Import to ReAI</button>
            </form>`)}</tr>`)}</tbody>
      </table></div>
      ${reaiCallout({ tone: 'info', body: html`Opening balances come from the SAF-T file in the <a href="/app/saft/">SAF-T tool</a>. Products get the default VAT code and revenue account in ReAI, so check them after the import.` })}
    `,
  });
}

/**
 * Creates one customer, supplier or product in ReAI unless it already exists there.
 * @param {import('../lib/types.d.ts').Env} env
 * @param {{ accessToken: string, tenantId: number }} session
 * @param {MigrateItem} it
 * @returns {Promise<string>}
 */
async function importItem(env, session, it) {
  const auth = { token: session.accessToken, tenantId: session.tenantId };
  if (it.kind === 'product') {
    const sku = (it.externalId || it.name).slice(0, 100);
    const found = /** @type {{ items?: Array<{ id: number, variants?: Array<{ sku?: string }> }> }} */ (await reaiRequest(env, '/api/products', { ...auth, query: { query: sku, pageSize: '20' } }));
    const hit = found.items?.find((p) => p.variants?.some((v) => v.sku === sku));
    if (hit) return `Already in ReAI #${hit.id}`;
    const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/products', { ...auth, method: 'POST', body: { title: it.name.slice(0, 120), variants: [{ sku, sellingPrice: Number(it.price.toFixed(2)) }] } }));
    return `Imported #${created.id}`;
  }
  const path = it.kind === 'supplier' ? '/api/suppliers' : '/api/customers';
  if (it.orgnr) {
    const found = /** @type {{ items?: Array<{ id: number }> }} */ (await reaiRequest(env, path, { ...auth, query: { organizationNumber: it.orgnr, pageSize: '1' } }));
    const hit = found.items?.[0];
    if (hit) return `Already in ReAI #${hit.id}`;
  }
  const created = /** @type {{ id: number }} */ (await reaiRequest(env, path, {
    ...auth,
    method: 'POST',
    body: {
      name: it.name.slice(0, 75),
      ...(it.externalId ? { number: it.externalId.slice(0, 50) } : {}),
      ...(it.orgnr ? { organizationNumber: it.orgnr } : {}),
      ...(it.email ? { email: it.email } : {}),
      countryCode: 'NO',
      privateContact: false,
    },
  }));
  return `Imported #${created.id}`;
}

/**
 * Handles /app/poweroffice-migrate/* routes.
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
      <section class="app-intro"><p class="eyebrow">SWITCH FROM ${BRAND.toUpperCase()}</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${SLUG}-web`, clientName: `ReAI ${BRAND} Switcher (Web)` })}
        ${renderApiFetchCard({ basePath: BASE_PATH, targetId: 'sw-output', brand: BRAND, hint: API_HINT, fields: API_FIELDS, sampleAction: true })}
        <div id="sw-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderItems(SAMPLE, true));

  const form = await request.formData();
  if (pathname === `${BASE_PATH}/import-one`) {
    /** @type {MigrateItem} */
    let it = { kind: 'customer', externalId: '', name: '', orgnr: '', email: '', price: 0 };
    try { it = { ...it, ...JSON.parse(String(form.get('itemJson') ?? '{}')) }; } catch { /* rejected below */ }
    const row = Number(form.get('row') ?? 0) || 0;
    try {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (!['customer', 'supplier', 'product'].includes(it.kind) || !it.name) throw new HttpError(400, 'Invalid record.');
      const result = await importItem(env, session, it);
      return htmlResponse(html`<tr id="sw-row-${row}">${itemRow(it, reaiBadge({ text: result, tone: 'success' }))}</tr>`);
    } catch (err) {
      return htmlResponse(html`<tr id="sw-row-${row}">${itemRow(it, reaiBadge({ text: err instanceof Error ? err.message : 'Failed.', tone: 'danger' }))}</tr>`);
    }
  }
  try {
    if (pathname === `${BASE_PATH}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderItems(await fetchApi(creds), false));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
