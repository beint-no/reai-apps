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
 * @typedef {{ name: string, quantity: number, unitPrice: number }} CrmLine
 * @typedef {{ id: number, number: string, title: string, value: number, currency: string, orgId: number, orgName: string, orderDate: string, lines: CrmLine[] }} CrmDelivery
 * @typedef {{ id: number, name?: string | null, organizationNumber?: string | null }} ReAICustomer
 */

const SLUG = 'upsales';
const BRAND = 'Upsales';
const BASE_PATH = `/app/${SLUG}`;
const TITLE = 'Upsales Won Orders to ReAI';
const LEAD = 'Turn won Upsales orders into draft ReAI orders with their order rows, and create the missing customers from the Upsales companies.';
const API = 'https://integration.upsales.com/api/v2';
const PAGE_SIZE = 2000;
const MAX_PAGES = 3;
const MAX_ORGS = 500;

/** @param {number} n */
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Reads won orders (probability 100) dated in a period and their companies from the Upsales API v2.
 * Docs: https://api.upsales.com/ (key as ?token=, limit max 2000 with offset, sort on id, filters
 * attribute=comparisontype:value and multiple values id=eq:1,2,3; Order fields id, description, date, probability,
 * currency, value, client {id, name}, orderRow[] quantity, price, product.name; Company fields id, name, orgNo,
 * mailAddress {address, zipcode, city, country}) and
 * https://support.upsales.com/hc/en-us/articles/360010164973 (API keys under Settings → Account → Security → API keys).
 * @param {Record<string, string>} creds `apiToken`, `from` (YYYY-MM-DD) and `to` (YYYY-MM-DD, inclusive)
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<{ orgs: CrmOrg[], deliveries: CrmDelivery[] }>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const apiToken = (creds.apiToken ?? '').trim();
  if (!apiToken) throw new HttpError(400, 'Enter your Upsales API key.');
  const from = isoDate(creds.from);
  const to = isoDate(creds.to);
  if (to < from) throw new HttpError(400, 'The end date is before the start date.');
  const headers = { 'content-type': 'application/json', accept: 'application/json' };

  /** @type {any[]} */ const raw = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ token: apiToken, probability: '100', date: `gte:${from}`, sort: 'id', limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
    const res = await fetchJson(`${API}/orders?${q}`, { headers }, BRAND, fetchImpl);
    const items = Array.isArray(res?.data) ? res.data : [];
    raw.push(...items);
    const total = Number(res?.metadata?.total ?? 0);
    if (items.length < PAGE_SIZE || raw.length >= total) break;
    if (page === MAX_PAGES - 1) throw new HttpError(400, `Upsales has more than ${MAX_PAGES * PAGE_SIZE} won orders from that date. Choose a later start date.`);
  }
  const wanted = raw.filter((o) => Number(o?.probability) === 100 && isoDate(o?.date, '') >= from && isoDate(o?.date, '') <= to && Number(o?.value ?? 0) > 0);
  const orgIds = [...new Set(wanted.map((o) => Number(o?.client?.id)).filter((id) => Number.isInteger(id) && id > 0))];
  if (orgIds.length > MAX_ORGS) throw new HttpError(400, `The orders belong to more than ${MAX_ORGS} companies. Choose a shorter period.`);
  /** @type {CrmOrg[]} */ const orgs = [];
  for (let i = 0; i < orgIds.length; i += 100) {
    const q = new URLSearchParams({ token: apiToken, id: `eq:${orgIds.slice(i, i + 100).join(',')}`, limit: '100' });
    const res = await fetchJson(`${API}/accounts?${q}`, { headers }, BRAND, fetchImpl);
    for (const c of Array.isArray(res?.data) ? res.data : []) {
      const name = String(c?.name ?? '').trim();
      if (!name) continue;
      const addr = c?.mailAddress ?? (Array.isArray(c?.addresses) ? c.addresses[0] : null) ?? {};
      const country = String(addr?.country ?? '').trim().toUpperCase();
      orgs.push({
        id: Number(c.id),
        name: name.slice(0, 75),
        orgnr: extractNorwegianOrg(String(c?.orgNo ?? '')),
        address: String(addr?.address ?? '').trim(),
        postalCode: String(addr?.zipcode ?? '').trim(),
        city: String(addr?.city ?? '').trim(),
        country: /^[A-Z]{2}$/.test(country) ? country : '',
      });
    }
  }
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  /** @type {CrmDelivery[]} */ const deliveries = wanted.map((o) => {
    const value = round2(Number(o.value));
    /** @type {CrmLine[]} */ const rows = (Array.isArray(o?.orderRow) ? o.orderRow : [])
      .map((/** @type {any} */ r) => ({ name: String(r?.product?.name ?? '').trim().slice(0, 200), quantity: round2(Number(r?.quantity ?? 0)), unitPrice: round2(Number(r?.price ?? 0)) }))
      .filter((/** @type {CrmLine} */ r) => r.quantity !== 0 && r.unitPrice !== 0);
    const rowSum = round2(rows.reduce((t, r) => t + r.quantity * r.unitPrice, 0));
    const title = String(o?.description ?? `Order ${o?.id}`).trim().slice(0, 200);
    return {
      id: Number(o.id),
      number: String(o.id),
      title,
      value,
      currency: String(o?.currency ?? '').trim().toUpperCase(),
      orgId: Number(o?.client?.id ?? 0),
      orgName: orgName.get(Number(o?.client?.id)) ?? String(o?.client?.name ?? ''),
      orderDate: isoDate(o?.date),
      // Rows are used only when they add up to the order value; otherwise one line with the order value.
      lines: rows.length > 0 && Math.abs(rowSum - value) < 0.005 ? rows.map((r) => ({ ...r, name: r.name || title })) : [{ name: title, quantity: 1, unitPrice: value }],
    };
  });
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
      ${reaiMetric({ label: 'Companies', value: String(s.orgs.length), detail: `${missing} not yet in ReAI` })}
      ${reaiMetric({ label: 'Won orders', value: String(s.deliveries.length), detail: `${ready} ready to stage` })}
      ${reaiMetric({ label: 'Duplicate guard', value: 'External ref', detail: 'One ReAI order per Upsales order' })}
    </div>
    ${reaiCard({
      eyebrow: 'UPSALES COMPANIES → REAI CUSTOMERS',
      title: 'Companies with won orders',
      badge: reaiBadge({ text: `${missing} missing`, tone: missing > 0 ? 'accent' : 'success' }),
      body: html`<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Company</th><th>Org. no.</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>${s.orgs.map(({ org, reaiId }, idx) => html`<tr id="us-org-${idx}">${orgRow(org,
          reaiId > 0 ? reaiBadge({ text: `Matched #${reaiId}`, tone: 'neutral' }) : reaiBadge({ text: 'New customer', tone: 'warn' }),
          reaiId > 0 || s.isSample
            ? html`<span class="muted-note">${s.isSample && reaiId <= 0 ? 'Demo only' : 'In ReAI'}</span>`
            : html`<form class="inline-row" hx-post="${BASE_PATH}/create-customer" hx-target="#us-org-${idx}" hx-swap="outerHTML">
                <input type="hidden" name="orgJson" value="${JSON.stringify(org)}">
                <input type="text" name="orgnr" value="${org.orgnr}" pattern="[0-9]{9}" maxlength="9" placeholder="Org. no. (optional)" style="width:150px">
                <button type="submit" class="button primary">Create</button>
              </form>`)}</tr>`)}</tbody>
      </table></div>`,
    })}
    ${reaiCard({
      eyebrow: 'UPSALES WON ORDERS → REAI DRAFT ORDERS',
      title: 'Stage won orders as ReAI orders',
      badge: reaiBadge({ text: `${ready} ready`, tone: ready > 0 ? 'success' : 'neutral' }),
      body: html`<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Order</th><th>Company</th><th>Order date</th><th class="num">Order value</th><th>Action</th></tr></thead>
        <tbody>${s.deliveries.map(({ d, customerId }, idx) => html`<tr id="us-del-${idx}">${deliveryRow(d,
          s.isSample || customerId <= 0 || !d.currency
            ? html`<span class="muted-note">${s.isSample ? 'Demo only' : !d.currency ? 'Currency missing in Upsales' : 'Create the customer first, then fetch again'}</span>`
            : html`<form hx-post="${BASE_PATH}/create-order" hx-target="#us-del-${idx}" hx-swap="outerHTML">
                <input type="hidden" name="deliveryJson" value="${JSON.stringify(d)}">
                <input type="hidden" name="customerId" value="${customerId}">
                <button type="submit" class="button primary">Stage order</button>
              </form>`)}</tr>`)}</tbody>
      </table></div>
      <p class="muted-note">Order rows become draft order lines when they add up to the Upsales order value, otherwise one line with the order value. Prices are taken as excluding VAT and ReAI applies its default VAT code for the customer; check it before invoicing.</p>`,
    })}
    ${s.isSample ? reaiCallout({ tone: 'info', body: 'Sample Upsales data loaded. Connect to ReAI and fetch with your API key to stage real orders.' }) : ''}
  `;
}

/** @type {{ orgs: CrmOrg[], deliveries: CrmDelivery[] }} */
const SAMPLE = {
  orgs: [
    { id: 1, name: 'Fjord Logistikk AS', orgnr: '935606403', address: 'Kaigaten 14', postalCode: '5015', city: 'Bergen', country: 'NO' },
    { id: 2, name: 'Viken Energi AS', orgnr: '', address: 'Storgata 50', postalCode: '3015', city: 'Drammen', country: 'NO' },
  ],
  deliveries: [
    { id: 501, number: '501', title: 'Lisenser 2027', value: 85000, currency: 'NOK', orgId: 1, orgName: 'Fjord Logistikk AS', orderDate: '2026-10-18', lines: [{ name: 'Brukerlisens', quantity: 10, unitPrice: 7500 }, { name: 'Oppstart', quantity: 1, unitPrice: 10000 }] },
    { id: 502, number: '502', title: 'Implementering', value: 42000, currency: 'NOK', orgId: 2, orgName: 'Viken Energi AS', orderDate: '2026-10-21', lines: [{ name: 'Implementering', quantity: 1, unitPrice: 42000 }] },
  ],
};

/**
 * Handles /app/upsales/* routes.
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
          eyebrow: 'LIVE UPSALES API',
          title: 'Fetch won Upsales orders',
          body: html`<p class="muted-note">An Upsales admin creates the key under Settings → Account → Security → API keys. The API product must be active in the billing portal. The key is used only for this request and is never stored.</p>
            <form class="stack" hx-post="${BASE_PATH}/scan" hx-target="#${SLUG}-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="us-token">Upsales API key</label><input id="us-token" name="apiToken" type="password" autocomplete="off" required></div>
                <div class="field"><label for="us-from">Order date from</label><input id="us-from" name="from" type="date" value="${today.slice(0, 7)}-01" required></div>
                <div class="field"><label for="us-to">Order date to</label><input id="us-to" name="to" type="date" value="${today}" required></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Fetch from Upsales</button>
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
      if (crm.deliveries.length === 0) throw new HttpError(400, 'Upsales has no won orders with a value in that period.');
      const customers = /** @type {ReAICustomer[]} */ (customersRaw);
      const byOrg = new Map(crm.orgs.map((org) => [org.id, matchCustomer(org, customers)?.id ?? 0]));
      return htmlResponse(renderResults({ isSample: false, orgs: crm.orgs.map((org) => ({ org, reaiId: byOrg.get(org.id) ?? 0 })), deliveries: crm.deliveries.map((d) => ({ d, customerId: byOrg.get(d.orgId) ?? 0 })) }));
    }
    if (pathname === `${BASE_PATH}/create-customer`) {
      const org = /** @type {CrmOrg} */ (JSON.parse(String(form.get('orgJson') ?? '{}')));
      const name = String(org.name ?? '').trim().slice(0, 75);
      const typed = String(form.get('orgnr') ?? '').replace(/\s+/g, '');
      const orgnr = typed ? extractNorwegianOrg(typed) : '';
      if (!name) throw new HttpError(400, 'The company has no name.');
      if (typed && !orgnr) throw new HttpError(400, 'Enter a valid 9 digit Norwegian organisation number, or leave it empty.');
      if (orgnr) {
        const found = /** @type {{ items: Array<{ id: number }> }} */ (await reaiRequest(env, '/api/customers', { ...auth, query: { organizationNumber: orgnr, pageSize: '1' } }));
        const existingId = found.items[0]?.id;
        if (existingId) return htmlResponse(html`<tr>${orgRow({ ...org, orgnr }, reaiBadge({ text: `Already in ReAI #${existingId}`, tone: 'neutral' }), html`<span class="muted-note">Fetch again to match orders</span>`)}</tr>`);
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
      return htmlResponse(html`<tr>${orgRow({ ...org, orgnr }, reaiBadge({ text: `Created #${created.id}`, tone: 'success' }), html`<span class="muted-note">Fetch again to match orders</span>`)}</tr>`);
    }
    if (pathname === `${BASE_PATH}/create-order`) {
      const d = /** @type {CrmDelivery} */ (JSON.parse(String(form.get('deliveryJson') ?? '{}')));
      const customerId = Number(form.get('customerId') ?? '0');
      const value = Math.round(Number(d.value) * 100) / 100;
      const currency = String(d.currency ?? '').toUpperCase();
      const date = String(d.orderDate ?? '');
      const lines = (Array.isArray(d.lines) ? d.lines : [])
        .map((l) => ({ name: String(l?.name ?? '').slice(0, 200) || 'Upsales order', quantity: Math.round(Number(l?.quantity) * 100) / 100, unitPrice: Math.round(Number(l?.unitPrice) * 100) / 100 }))
        .filter((l) => Number.isFinite(l.quantity) && Number.isFinite(l.unitPrice) && l.quantity !== 0 && l.unitPrice !== 0);
      if (lines.length === 0 || Math.abs(lines.reduce((t, l) => t + l.quantity * l.unitPrice, 0) - value) >= 0.005) throw new HttpError(400, 'The order lines do not add up to the Upsales order value. Fetch again.');
      if (!Number.isInteger(Number(d.id)) || Number(d.id) <= 0 || !(value > 0) || customerId <= 0 || !/^[A-Z]{3}$/.test(currency) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
        throw new HttpError(400, 'An order id, positive value, currency, order date and customer are required.');
      }
      const externalReference = `upsales-order-${Number(d.id)}`;
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
          comment: `Won in Upsales (#${Number(d.id)})`,
          orderLines: lines.map((l) => ({ itemName: l.name, quantity: l.quantity, unitPrice: l.unitPrice })),
        },
      }));
      return htmlResponse(html`<tr>${deliveryRow(d, html`<a href="${reaiOrigin(env)}/order/${created.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Order #${created.id} ↗</a>`)}</tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
