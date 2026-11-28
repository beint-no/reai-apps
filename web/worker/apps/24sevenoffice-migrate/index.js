// @ts-check
import { fetchJson, num, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiRequest } from '../../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';
import { extractNorwegianOrg } from '../../lib/norway.js';

/** @typedef {{ kind: 'customer' | 'supplier' | 'product', externalId: string, name: string, orgnr: string, email: string, price: number }} MigrateItem */

const SLUG = '24sevenoffice-migrate';
const BRAND = 'Finago Office';
const BASE_PATH = `/app/${SLUG}`;
const TITLE = 'Switch from Finago Office (24SevenOffice) to ReAI';
const LEAD = 'Fetch customers, suppliers and products from the Finago Office API (formerly 24SevenOffice) and import them into ReAI with their numbers and organization numbers.';
const API_HINT = 'Create an application in the Finago Office Developer admin panel with read access to customers and products, connect it under Administration → Integrations, and copy the client ID, client secret and organization ID. Ask the Finago Office API team to enable the Developer admin panel if the menu is missing.';
/** @type {import('../../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [
  { name: 'clientId', label: 'Client ID (Application ID)' },
  { name: 'clientSecret', label: 'Client secret', type: 'password' },
  { name: 'organizationId', label: 'Organization ID' },
];
const AUTH_URL = 'https://login.24sevenoffice.com/oauth/token';
const API = 'https://rest.api.24sevenoffice.com/v1';
const PAGE_SIZE = 100;
const MAX_ITEMS = 2000;

/** @type {MigrateItem[]} */
const SAMPLE = [
  { kind: 'customer', externalId: '10001', name: 'Fjord Bygg AS', orgnr: '935606403', email: 'post+fjordbygg@aiak.no', price: 0 },
  { kind: 'supplier', externalId: '20001', name: 'Norsk Grossist AS', orgnr: '923609016', email: 'post+grossist@aiak.no', price: 0 },
  { kind: 'product', externalId: 'KONS-1', name: 'Konsulenttime', orgnr: '', email: '', price: 1450 },
];

/**
 * Returns the rel="next" URL from an RFC 8288 Link header when it stays on the API host.
 * @param {string | null} link
 */
function nextLink(link) {
  const m = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(link ?? '');
  if (!m || !m[1]) return '';
  const url = new URL(m[1], API);
  return url.origin === new URL(API).origin ? url.toString() : '';
}

/**
 * Performs one authorized GET and returns the JSON body and Link header.
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 */
async function getPage(url, headers, fetchImpl) {
  const res = await fetchImpl(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new HttpError(400, `${BRAND} API ${res.status === 401 || res.status === 403 ? 'rejected the token. Check the scopes of the application' : `returned HTTP ${res.status}`}.`);
  return { body: /** @type {unknown} */ (await res.json()), link: res.headers.get('link') };
}

/**
 * Fetches customers, suppliers and products from the Finago Office (24SevenOffice) REST API.
 * Docs: https://rest-api.developer.24sevenoffice.com/doc/v1/topic/topic-get-access-token (POST https://login.24sevenoffice.com/oauth/token,
 * client_credentials with audience https://api.24sevenoffice.com, client_id, client_secret, login_organization),
 * https://rest-api.developer.24sevenoffice.com/doc/v1/operation/operation-getcustomers (GET /customers with limit and a Link
 * header for the next page; fields id, name, person, isCompany, isSupplier, organizationNumber, email.contact, email.billing) and
 * https://rest-api.developer.24sevenoffice.com/doc/v1/group/endpoint-products (GET /products with page and limit; id, number, name, salesPrice, status).
 * Suppliers are customers with isSupplier set.
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<MigrateItem[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const clientId = (creds.clientId ?? '').trim();
  const clientSecret = (creds.clientSecret ?? '').trim();
  const organizationId = (creds.organizationId ?? '').trim();
  if (!clientId || !clientSecret || !organizationId) throw new HttpError(400, 'Enter the client ID, client secret and organization ID.');
  const login = await fetchJson(AUTH_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', audience: 'https://api.24sevenoffice.com', client_id: clientId, client_secret: clientSecret, login_organization: organizationId }).toString(),
  }, BRAND, fetchImpl);
  const token = typeof login?.access_token === 'string' ? login.access_token : '';
  if (!token) throw new HttpError(400, 'Finago Office did not return an access token. Check the client ID, secret and organization ID.');
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };

  /** @type {any[]} */ const customers = [];
  let url = `${API}/customers?${new URLSearchParams({ limit: String(PAGE_SIZE) })}`;
  for (let i = 0; i < 20 && url && customers.length < MAX_ITEMS; i++) {
    const page = await getPage(url, headers, fetchImpl);
    const rows = Array.isArray(page.body) ? page.body : [];
    customers.push(...rows);
    const next = rows.length > 0 ? nextLink(page.link) : '';
    url = next !== url ? next : '';
  }
  /** @type {any[]} */ const products = [];
  for (let p = 1; p <= 20 && products.length < MAX_ITEMS; p++) {
    const page = await getPage(`${API}/products?${new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) })}`, headers, fetchImpl);
    const rows = Array.isArray(page.body) ? page.body : [];
    products.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }

  /** @type {MigrateItem[]} */
  const items = [];
  for (const c of customers) {
    const name = String(c.name ?? '').trim() || [c.person?.firstName, c.person?.lastName].filter(Boolean).join(' ').trim();
    if (!name) continue;
    const base = { externalId: String(c.id ?? ''), name, orgnr: extractNorwegianOrg(String(c.organizationNumber ?? '')), email: String(c.email?.contact ?? c.email?.billing ?? '').trim(), price: 0 };
    items.push({ kind: 'customer', ...base });
    if (c.isSupplier === true) items.push({ kind: 'supplier', ...base });
  }
  for (const p of products) {
    if (/inactive|expired/i.test(String(p.status ?? '')) || !String(p.name ?? '').trim()) continue;
    items.push({ kind: 'product', externalId: String(p.number ?? p.id ?? ''), name: String(p.name).trim(), orgnr: '', email: '', price: Math.max(0, num(p.salesPrice)) });
  }
  if (items.length === 0) throw new HttpError(400, 'Finago Office returned no customers, suppliers or products.');
  return items.slice(0, MAX_ITEMS);
}

/** @param {MigrateItem} it @param {import('../../lib/html.js').HtmlValue} action */
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
 * @param {import('../../lib/types.d.ts').Env} env
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
 * Handles /app/24sevenoffice-migrate/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
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
