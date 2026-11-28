// @ts-check
import { fetchJson, isoDate } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { extractNorwegianOrg } from '../../lib/norway.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/**
 * @typedef {{ id: number, name: string, orgnr: string, address: string, postalCode: string, city: string, country: string }} CrmOrg
 * @typedef {{ id: number, number: string, title: string, value: number, currency: string, orgId: number, orgName: string, orderDate: string }} CrmDelivery
 * @typedef {{ id: number, name?: string | null, organizationNumber?: string | null }} ReAICustomer
 */

const SLUG = 'webcrm';
const BRAND = 'webCRM';
const BASE_PATH = `/app/${SLUG}`;
const TITLE = 'webCRM Deliveries to ReAI Orders';
const LEAD = 'Turn webCRM deliveries (won orders) into draft ReAI orders ready for invoicing, and create the missing customers from their webCRM organisations.';
const API = 'https://api.webcrm.com';
const PAGE_SIZE = 1000;
const MAX_PAGES = 3;
const MAX_ORGS = 20;

/** @param {string} iso */
function osloDate(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

/** @param {string} date @param {number} days */
function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Reads deliveries created in a period and their organisations from the webCRM REST API v1.
 * Docs: https://api.webcrm.com/documentation/index.html (250 requests per minute per token),
 * https://api.webcrm.com/swagger/v1/swagger.json (POST /Auth/ApiLogin with form field authCode returns AccessToken,
 * Bearer auth; GET /Deliveries/FindByCreateDates/{startDate}/{endDate} with startDate <= createDate < endDate,
 * Page and Size (max 1000); GET /Organisations/{id}; DeliveryDto and OrganisationDto fields) and
 * https://webcrm.com/nl/support/api/rest-api (token under Configuration → Integration → API → REST, Plus or Enterprise).
 * @param {Record<string, string>} creds `apiToken`, `from` (YYYY-MM-DD) and `to` (YYYY-MM-DD, inclusive)
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<{ orgs: CrmOrg[], deliveries: CrmDelivery[] }>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const apiToken = (creds.apiToken ?? '').trim();
  if (!apiToken) throw new HttpError(400, 'Enter your webCRM API token.');
  const from = isoDate(creds.from);
  const to = isoDate(creds.to);
  if (to < from) throw new HttpError(400, 'The end date is before the start date.');
  const login = await fetchJson(`${API}/Auth/ApiLogin`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ authCode: apiToken }).toString(),
  }, BRAND, fetchImpl);
  const accessToken = typeof login?.AccessToken === 'string' ? login.AccessToken : '';
  if (!accessToken || login?.IsError) throw new HttpError(400, `webCRM did not accept the API token${login?.ErrorDescription ? `: ${String(login.ErrorDescription)}` : ''}.`);
  const headers = { authorization: `Bearer ${accessToken}`, accept: 'application/json' };

  /** @type {any[]} */ const raw = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams({ Page: String(page), Size: String(PAGE_SIZE) });
    const batch = await fetchJson(`${API}/Deliveries/FindByCreateDates/${from}/${addDays(to, 1)}?${q}`, { headers }, BRAND, fetchImpl);
    const items = Array.isArray(batch) ? batch : [];
    raw.push(...items);
    if (items.length < PAGE_SIZE) break;
    if (page === MAX_PAGES) throw new HttpError(400, `webCRM has more than ${MAX_PAGES * PAGE_SIZE} deliveries in the period. Choose a shorter period.`);
  }
  const wanted = raw.filter((d) => Number(d.DeliveryOrderValue ?? 0) > 0);
  const orgIds = [...new Set(wanted.map((d) => Number(d.DeliveryOrganisationId)).filter((id) => Number.isInteger(id) && id > 0))];
  if (orgIds.length > MAX_ORGS) throw new HttpError(400, `The deliveries belong to more than ${MAX_ORGS} organisations. Choose a shorter period.`);
  /** @type {CrmOrg[]} */ const orgs = [];
  for (let i = 0; i < orgIds.length; i += 5) {
    const chunk = orgIds.slice(i, i + 5);
    const res = await Promise.all(chunk.map((id) => fetchJson(`${API}/Organisations/${id}`, { headers }, BRAND, fetchImpl)));
    for (const o of res) {
      const name = String(o?.OrganisationName ?? '').trim();
      if (!name) continue;
      const iso = String(o?.OrganisationCountryData?.CodeISO ?? o?.OrganisationCountry ?? '').trim().toUpperCase();
      orgs.push({
        id: Number(o.OrganisationId),
        name: name.slice(0, 75),
        orgnr: extractNorwegianOrg(String(o?.OrganisationVatNumber ?? '')),
        address: String(o?.OrganisationAddress ?? '').trim(),
        postalCode: String(o?.OrganisationPostCode ?? '').trim(),
        city: String(o?.OrganisationCity ?? '').trim(),
        country: /^[A-Z]{2}$/.test(iso) ? iso : '',
      });
    }
  }
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  /** @type {CrmDelivery[]} */ const deliveries = wanted.map((d) => ({
    id: Number(d.DeliveryId),
    number: String(d.DeliveryNumber ?? '').trim(),
    title: String(d.DeliveryDescription || d.DeliveryOpportunityDescription || d.DeliveryProduct || `Delivery ${d.DeliveryNumber ?? d.DeliveryId}`).trim().slice(0, 200),
    value: Math.round(Number(d.DeliveryOrderValue) * 100) / 100,
    currency: String(d.DeliveryCurrencySymbol || d.DeliveryOpportunityCurrencySymbol || '').trim().toUpperCase(),
    orgId: Number(d.DeliveryOrganisationId ?? 0),
    orgName: orgName.get(Number(d.DeliveryOrganisationId)) ?? '',
    orderDate: osloDate(String(d.DeliveryOrderDate || d.DeliveryWonDate || d.DeliveryCreatedAt || '')),
  }));
  return { orgs: orgs.sort((a, b) => a.name.localeCompare(b.name, 'nb')), deliveries };
}

/** @param {string} s */
const norm = (s) => s.trim().toLowerCase();

/** @param {CrmOrg} org @param {ReAICustomer[]} customers */
function matchCustomer(org, customers) {
  return (org.orgnr ? customers.find((c) => String(c.organizationNumber ?? '') === org.orgnr) : undefined) ?? customers.find((c) => norm(String(c.name ?? '')) === norm(org.name));
}

/** @param {CrmOrg} org @param {import('../../lib/html.js').HtmlValue} status @param {import('../../lib/html.js').HtmlValue} action */
function orgRow(org, status, action) {
  return html`<td><strong>${org.name}</strong></td><td class="mono">${org.orgnr || '—'}</td><td>${status}</td><td>${action}</td>`;
}

/** @param {CrmDelivery} d @param {import('../../lib/html.js').HtmlValue} action */
function deliveryRow(d, action) {
  return html`<td><strong>${d.title}</strong>${d.number ? html`<br><span class="muted-note">${d.number}</span>` : ''}</td><td>${d.orgName || '—'}</td><td class="mono">${d.orderDate || '—'}</td><td class="num">${formatMinor(Math.round(d.value * 100))} ${d.currency}</td><td>${action}</td>`;
}

/** @param {{ orgs: Array<{ org: CrmOrg, reaiId: number }>, deliveries: Array<{ d: CrmDelivery, customerId: number }>, isSample: boolean }} s */
function renderResults(s) {
  const missing = s.orgs.filter((o) => o.reaiId <= 0).length;
  const ready = s.deliveries.filter((x) => x.customerId > 0 && x.d.currency).length;
  return html`
    <div class="metric-grid">
      ${reaiMetric({ label: 'Organisations', value: String(s.orgs.length), detail: `${missing} not yet in ReAI` })}
      ${reaiMetric({ label: 'Deliveries', value: String(s.deliveries.length), detail: `${ready} ready to stage` })}
      ${reaiMetric({ label: 'Duplicate guard', value: 'External ref', detail: 'One ReAI order per delivery' })}
    </div>
    ${reaiCard({
      eyebrow: 'WEBCRM ORGANISATIONS → REAI CUSTOMERS',
      title: 'Organisations with deliveries',
      badge: reaiBadge({ text: `${missing} missing`, tone: missing > 0 ? 'accent' : 'success' }),
      body: html`<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Organisation</th><th>Org. no.</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>${s.orgs.map(({ org, reaiId }, idx) => html`<tr id="wc-org-${idx}">${orgRow(org,
          reaiId > 0 ? reaiBadge({ text: `Matched #${reaiId}`, tone: 'neutral' }) : reaiBadge({ text: 'New customer', tone: 'warn' }),
          reaiId > 0 || s.isSample
            ? html`<span class="muted-note">${s.isSample && reaiId <= 0 ? 'Demo only' : 'In ReAI'}</span>`
            : html`<form class="inline-row" hx-post="${BASE_PATH}/create-customer" hx-target="#wc-org-${idx}" hx-swap="outerHTML">
                <input type="hidden" name="orgJson" value="${JSON.stringify(org)}">
                <input type="text" name="orgnr" value="${org.orgnr}" pattern="[0-9]{9}" maxlength="9" placeholder="Org. no. (optional)" style="width:150px">
                <button type="submit" class="button primary">Create</button>
              </form>`)}</tr>`)}</tbody>
      </table></div>`,
    })}
    ${reaiCard({
      eyebrow: 'WEBCRM DELIVERIES → REAI DRAFT ORDERS',
      title: 'Stage deliveries as ReAI orders',
      badge: reaiBadge({ text: `${ready} ready`, tone: ready > 0 ? 'success' : 'neutral' }),
      body: html`<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Delivery</th><th>Organisation</th><th>Order date</th><th class="num">Order value</th><th>Action</th></tr></thead>
        <tbody>${s.deliveries.map(({ d, customerId }, idx) => html`<tr id="wc-del-${idx}">${deliveryRow(d,
          s.isSample || customerId <= 0 || !d.currency
            ? html`<span class="muted-note">${s.isSample ? 'Demo only' : !d.currency ? 'Currency missing in webCRM' : 'Create the customer first, then fetch again'}</span>`
            : html`<form hx-post="${BASE_PATH}/create-order" hx-target="#wc-del-${idx}" hx-swap="outerHTML">
                <input type="hidden" name="deliveryJson" value="${JSON.stringify(d)}">
                <input type="hidden" name="customerId" value="${customerId}">
                <button type="submit" class="button primary">Stage order</button>
              </form>`)}</tr>`)}</tbody>
      </table></div>
      <p class="muted-note">Each delivery becomes one draft order line with the webCRM order value excluding VAT. ReAI applies its default VAT code for the customer; check it before invoicing.</p>`,
    })}
    ${s.isSample ? reaiCallout({ tone: 'info', body: 'Sample webCRM data loaded. Connect to ReAI and fetch with your API token to stage real orders.' }) : ''}
  `;
}

/** @type {{ orgs: CrmOrg[], deliveries: CrmDelivery[] }} */
const SAMPLE = {
  orgs: [
    { id: 1, name: 'Fjord Logistikk AS', orgnr: '935606403', address: 'Kaigaten 14', postalCode: '5015', city: 'Bergen', country: 'NO' },
    { id: 2, name: 'Viken Energi AS', orgnr: '', address: 'Storgata 50', postalCode: '3015', city: 'Drammen', country: 'NO' },
  ],
  deliveries: [
    { id: 501, number: 'D-1042', title: 'Rådgivning Q4', value: 85000, currency: 'NOK', orgId: 1, orgName: 'Fjord Logistikk AS', orderDate: '2026-10-18' },
    { id: 502, number: 'D-1043', title: 'Implementering', value: 42000, currency: 'NOK', orgId: 2, orgName: 'Viken Energi AS', orderDate: '2026-10-21' },
  ],
};

/**
 * Handles /app/webcrm/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE_PATH && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE_PATH}/`, request.url), 301);
  if (pathname === `${BASE_PATH}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro"><p class="eyebrow">CRM & SALES PIPELINE</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${SLUG}-web`, clientName: `ReAI ${BRAND} (Web)` })}
        ${reaiCard({
          eyebrow: 'LIVE WEBCRM REST API',
          title: 'Fetch webCRM deliveries',
          body: html`<p class="muted-note">Create an application token in webCRM under Configuration → Integration → API → REST (webCRM Plus or Enterprise). The token is used only for this request and is never stored.</p>
            <form class="stack" hx-post="${BASE_PATH}/scan" hx-target="#${SLUG}-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="wc-token">webCRM API token</label><input id="wc-token" name="apiToken" type="password" autocomplete="off" required></div>
                <div class="field"><label for="wc-from">Created from</label><input id="wc-from" name="from" type="date" value="${today.slice(0, 7)}-01" required></div>
                <div class="field"><label for="wc-to">Created to</label><input id="wc-to" name="to" type="date" value="${today}" required></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Fetch from webCRM</button>
                <button type="button" class="button secondary" hx-post="${BASE_PATH}/sample" hx-target="#${SLUG}-output" hx-swap="innerHTML">Load sample preview</button>
              </div>
            </form>`,
        })}
        <div id="${SLUG}-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE_PATH}/sample`) {
    return htmlResponse(renderResults({ isSample: true, orgs: SAMPLE.orgs.map((org, i) => ({ org, reaiId: i === 0 ? 18 : 0 })), deliveries: SAMPLE.deliveries.map((d, i) => ({ d, customerId: i === 0 ? 18 : 0 })) }));
  }
  try {
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    const auth = { token: session.accessToken, tenantId: session.tenantId };
    const form = await request.formData();
    if (pathname === `${BASE_PATH}/scan`) {
      const [crm, customersRaw] = await Promise.all([
        fetchApi({ apiToken: String(form.get('apiToken') ?? ''), from: String(form.get('from') ?? ''), to: String(form.get('to') ?? '') }),
        reaiAll(env, '/api/customers', auth),
      ]);
      if (crm.deliveries.length === 0) throw new HttpError(400, 'webCRM has no deliveries with an order value created in that period.');
      const customers = /** @type {ReAICustomer[]} */ (customersRaw);
      const byOrg = new Map(crm.orgs.map((org) => [org.id, matchCustomer(org, customers)?.id ?? 0]));
      return htmlResponse(renderResults({ isSample: false, orgs: crm.orgs.map((org) => ({ org, reaiId: byOrg.get(org.id) ?? 0 })), deliveries: crm.deliveries.map((d) => ({ d, customerId: byOrg.get(d.orgId) ?? 0 })) }));
    }
    if (pathname === `${BASE_PATH}/create-customer`) {
      const org = /** @type {CrmOrg} */ (JSON.parse(String(form.get('orgJson') ?? '{}')));
      const name = String(org.name ?? '').trim().slice(0, 75);
      const typed = String(form.get('orgnr') ?? '').replace(/\s+/g, '');
      const orgnr = typed ? extractNorwegianOrg(typed) : '';
      if (!name) throw new HttpError(400, 'The organisation has no name.');
      if (typed && !orgnr) throw new HttpError(400, 'Enter a valid 9 digit Norwegian organisation number, or leave it empty.');
      if (orgnr) {
        const found = /** @type {{ items: Array<{ id: number }> }} */ (await reaiRequest(env, '/api/customers', { ...auth, query: { organizationNumber: orgnr, pageSize: '1' } }));
        const existingId = found.items[0]?.id;
        if (existingId) return htmlResponse(html`<tr>${orgRow({ ...org, orgnr }, reaiBadge({ text: `Already in ReAI #${existingId}`, tone: 'neutral' }), html`<span class="muted-note">Fetch again to match deliveries</span>`)}</tr>`);
      }
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/customers', {
        ...auth,
        method: 'POST',
        body: {
          name,
          countryCode: /^[A-Z]{2}$/.test(String(org.country)) ? org.country : 'NO',
          privateContact: false,
          skipRegistryLookup: true,
          ...(orgnr ? { organizationNumber: orgnr } : {}),
          ...(org.address ? { addressPart1: String(org.address) } : {}),
          ...(org.postalCode ? { postalCode: String(org.postalCode) } : {}),
          ...(org.city ? { city: String(org.city) } : {}),
        },
      }));
      return htmlResponse(html`<tr>${orgRow({ ...org, orgnr }, reaiBadge({ text: `Created #${created.id}`, tone: 'success' }), html`<span class="muted-note">Fetch again to match deliveries</span>`)}</tr>`);
    }
    if (pathname === `${BASE_PATH}/create-order`) {
      const d = /** @type {CrmDelivery} */ (JSON.parse(String(form.get('deliveryJson') ?? '{}')));
      const customerId = Number(form.get('customerId') ?? '0');
      const value = Math.round(Number(d.value) * 100) / 100;
      const currency = String(d.currency ?? '').toUpperCase();
      const date = String(d.orderDate ?? '');
      if (!Number.isInteger(Number(d.id)) || Number(d.id) <= 0 || !(value > 0) || customerId <= 0 || !/^[A-Z]{3}$/.test(currency) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
        throw new HttpError(400, 'A delivery id, positive value, currency, order date and customer are required.');
      }
      const externalReference = `webcrm-delivery-${Number(d.id)}`;
      const existing = /** @type {{ items: Array<{ id: number | null }> }} */ (await reaiRequest(env, '/api/orders', { ...auth, query: { externalReference, pageSize: '1' } }));
      const dupId = existing.items[0]?.id;
      if (dupId) return htmlResponse(html`<tr>${deliveryRow(d, html`<a href="${reaiOrigin(env)}/order/${dupId}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Already staged #${dupId} ↗</a>`)}</tr>`);
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/orders', {
        ...auth,
        method: 'POST',
        body: {
          customerId,
          currencyCode: currency,
          daysUntilDue: 14,
          issueDate: date,
          orderDate: date,
          externalReference,
          comment: `webCRM delivery ${d.number || d.id}`.slice(0, 200),
          orderLines: [{ itemName: String(d.title ?? 'webCRM delivery').slice(0, 200), quantity: 1, unitPrice: value }],
        },
      }));
      return htmlResponse(html`<tr>${deliveryRow(d, html`<a href="${reaiOrigin(env)}/order/${created.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Order #${created.id} ↗</a>`)}</tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
