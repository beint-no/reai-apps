// @ts-check
import { assertPublicHttpsUrl, fetchJson, isoDate, num } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';
import { extractNorwegianOrg } from './recman-core.js';

/**
 * @typedef {{ id: string, name: string, orgnr: string, city: string }} CrmCompany
 * @typedef {{ id: string, title: string, companyId: string, companyName: string, value: number, date: string }} CrmSale
 * @typedef {{ id: number, name?: string | null, organizationNumber?: string | null }} ReAICust
 */

/**
 * Reads the list envelope of a Limeobject collection: HAL `_embedded.limeobjects`, or a plain array as in the
 * published example specification.
 * @param {any} body
 * @returns {any[]}
 */
function limeobjects(body) {
  if (Array.isArray(body)) return body;
  return Array.isArray(body?._embedded?.limeobjects) ? body._embedded.limeobjects : [];
}

/**
 * Normalizes the Lime CRM application URL to its Limeobject API root.
 * @param {string} raw e.g. https://customer.lime-crm.com/lime-crm or .../api/v1/
 */
export function limeobjectRoot(raw) {
  const parsed = assertPublicHttpsUrl(raw);
  const app = parsed.pathname.replace(/\/+$/, '').replace(/\/api\/v1(\/(limeobject|docs))?$/i, '');
  return `${parsed.origin}${app}/api/v1/limeobject`;
}

/**
 * Fetches won Lime CRM deals and their companies with the Limeobject API.
 * Docs: https://docs.lime-crm.com/integration/rest-apis/start (x-api-key header, API users in LISA,
 * interactive docs at <application>/api/v1/docs/) and the example Limeobject specification
 * http://static.lime-crm.com/crm-api-docs/spec/limeobject (GET /deal/ with filters such as dealstatus and
 * min-closeddate, _sort and _limit up to 50; GET /company/{id}/; deal fields name, company, value, dealstatus,
 * closeddate; company fields name, registrationno, visitingcity). Property names follow the standard Lime CRM
 * data model and can differ in customized applications.
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<{ companies: CrmCompany[], sales: CrmSale[] }>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const root = limeobjectRoot(creds.baseUrl ?? '');
  const key = (creds.apiToken ?? '').trim();
  if (!key) throw new HttpError(400, 'Enter the Lime CRM API key.');
  const since = isoDate(creds.since, `${new Date().toISOString().slice(0, 7)}-01`);
  const headers = { 'x-api-key': key, accept: 'application/hal+json, application/json' };
  const query = new URLSearchParams({ dealstatus: 'agreement', 'min-closeddate': since, _sort: '-closeddate', _limit: '50' });
  const deals = limeobjects(await fetchJson(`${root}/deal/?${query}`, { headers }, 'Lime CRM', fetchImpl));
  /** @type {Map<string, CrmCompany>} */
  const companies = new Map();
  for (const id of [...new Set(deals.map((d) => String(d.company ?? '')).filter((id) => /^[0-9]+$/.test(id)))]) {
    const c = await fetchJson(`${root}/company/${id}/`, { headers }, 'Lime CRM', fetchImpl);
    const name = String(c?.name ?? '').trim();
    if (name) companies.set(id, { id, name, orgnr: extractNorwegianOrg(String(c.registrationno ?? '')), city: String(c.visitingcity ?? c.postalcity ?? '').trim() });
  }
  const sales = deals
    .map((d) => ({ id: String(d.id ?? ''), title: String(d.name ?? '').trim() || `Lime deal ${d.id}`, companyId: String(d.company ?? ''), companyName: companies.get(String(d.company ?? ''))?.name ?? '', value: Number(num(d.value).toFixed(2)), date: isoDate(d.closeddate, since) }))
    .filter((x) => x.id && x.value > 0);
  return { companies: [...companies.values()], sales };
}

/** @param {{ companies: Array<{ c: CrmCompany, reaiId: number | null }>, sales: Array<{ s: CrmSale, customerId: number | null }>, isSample?: boolean }} state */
function renderCrm(state) {
  const missing = state.companies.filter((x) => !x.reaiId).length;
  const ready = state.sales.filter((x) => x.customerId !== null).length;
  return html`
    <div class="metric-grid">
      ${reaiMetric({ label: 'Companies scanned', value: String(state.companies.length), detail: `${missing} new to ReAI` })}
      ${reaiMetric({ label: 'Won sales scanned', value: String(state.sales.length), detail: `${ready} matched to ReAI customer` })}
      ${reaiMetric({ label: 'Duplicate check', value: 'External ref', detail: 'One ReAI order per Lime deal' })}
    </div>
    ${reaiCard({
      eyebrow: 'LIME CRM COMPANIES → REAI',
      title: 'Companies',
      badge: reaiBadge({ text: `${missing} new`, tone: missing > 0 ? 'accent' : 'success' }),
      body: html`<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Company</th><th>Org.nr</th><th>City</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>${state.companies.map(
          ({ c, reaiId }, idx) => html`<tr id="crm-c-${idx}">
            <td><strong>${c.name}</strong></td><td class="mono">${c.orgnr || '—'}</td><td>${c.city || '—'}</td>
            <td>${reaiId ? reaiBadge({ text: `Matched #${reaiId}`, tone: 'neutral' }) : reaiBadge({ text: 'New', tone: 'warn' })}</td>
            <td>${reaiId || state.isSample
              ? html`<span class="muted-note">${state.isSample && !reaiId ? 'Demo only' : 'In ReAI'}</span>`
              : html`<form class="inline-row" hx-post="/app/lime/create-customer" hx-target="#crm-c-${idx}" hx-swap="outerHTML">
                  <input type="hidden" name="name" value="${c.name}"><input type="text" name="orgnr" pattern="[0-9]{9}" maxlength="9" value="${c.orgnr}" required placeholder="9-digit org.nr" style="width:120px">
                  <button type="submit" class="button primary">Create</button>
                </form>`}</td>
          </tr>`,
        )}</tbody>
      </table></div>`,
    })}
    ${reaiCard({
      eyebrow: 'WON DEALS → REAI DRAFT ORDERS',
      title: 'Stage won sales as draft orders',
      badge: reaiBadge({ text: `${ready} ready`, tone: ready > 0 ? 'success' : 'neutral' }),
      body: html`<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Deal</th><th>Company</th><th>Date</th><th class="num">Value (NOK)</th><th>Action</th></tr></thead>
        <tbody>${state.sales.map(
          ({ s, customerId }, idx) => html`<tr id="crm-s-${idx}">
            <td><strong>${s.title}</strong></td><td>${s.companyName || '—'}</td><td class="mono">${s.date}</td><td class="num">${formatMinor(Math.round(s.value * 100))}</td>
            <td>${state.isSample || !customerId
              ? html`<span class="muted-note">${state.isSample ? 'Demo only' : 'Create customer above first'}</span>`
              : html`<form hx-post="/app/lime/create-order" hx-target="#crm-s-${idx}" hx-swap="outerHTML">
                  <input type="hidden" name="dealId" value="${s.id}"><input type="hidden" name="title" value="${s.title}">
                  <input type="hidden" name="value" value="${s.value.toFixed(2)}"><input type="hidden" name="date" value="${s.date}">
                  <input type="hidden" name="customerId" value="${customerId}"><button type="submit" class="button primary">Stage order</button>
                </form>`}</td>
          </tr>`,
        )}</tbody>
      </table></div>`,
    })}
  `;
}

/**
 * Handles /app/lime/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/lime';
  const title = "Lime CRM Sync";
  const lead = "Read won Lime CRM deals and their companies, create missing ReAI customers and stage each won deal as one ReAI order.";

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">NORDIC B2B CRM</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-lime-web', clientName: 'ReAI Lime CRM (Web)' })}
        ${reaiCard({
          eyebrow: 'CONNECT LIME CRM',
          title: 'Scan won deals',
          body: html`<p class="muted-note">Credentials are used only for this single HTTPS scan and are never stored.</p>
            <form class="stack" hx-post="${basePath}/scan" hx-target="#crm-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="crm-url">Lime CRM application URL</label><input id="crm-url" name="baseUrl" type="url" required placeholder="https://customer.lime-crm.com/lime-crm"></div>
                <div class="field"><label for="crm-tok">Lime CRM API key</label><input id="crm-tok" name="apiToken" type="password" autocomplete="off" required placeholder="API key of the API user"></div>
                <div class="field"><label for="crm-since">Won since</label><input id="crm-since" name="since" type="date" value="${new Date().toISOString().slice(0, 7)}-01" required></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Scan Lime CRM</button>
                <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#crm-output" hx-swap="innerHTML">Load sample sync</button>
              </div>
            </form>`,
        })}
        <div id="crm-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${basePath}/sample`) {
    return htmlResponse(renderCrm({
      isSample: true,
      companies: [
        { c: { id: '1', name: 'Nordic Maritime AS', orgnr: '935606403', city: 'Ålesund' }, reaiId: 21 },
        { c: { id: '2', name: 'Sørlandet Industri AS', orgnr: '923609016', city: 'Kristiansand' }, reaiId: null },
      ],
      sales: [
        { s: { id: '701', title: 'Annual Support SLA 2027', companyId: '1', companyName: 'Nordic Maritime AS', value: 145000, date: '2026-10-20' }, customerId: 21 },
        { s: { id: '702', title: 'Onboarding Workshop', companyId: '2', companyName: 'Sørlandet Industri AS', value: 38000, date: '2026-10-22' }, customerId: null },
      ],
    }));
  }

  try {
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    const form = await request.formData();

    if (pathname === `${basePath}/scan`) {
      const [crm, custRaw] = await Promise.all([
        fetchApi({ baseUrl: String(form.get('baseUrl') ?? ''), apiToken: String(form.get('apiToken') ?? ''), since: String(form.get('since') ?? '') }),
        reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId }),
      ]);
      const custs = /** @type {ReAICust[]} */ (custRaw);
      /** @param {string} name @param {string} [org] */
      const findId = (name, org = '') =>
        (org ? custs.find((x) => (x.organizationNumber ?? '').replace(/\s+/g, '') === org)?.id : undefined) ??
        custs.find((x) => (x.name ?? '').trim().toLowerCase() === name.trim().toLowerCase())?.id ?? null;
      const companies = crm.companies.map((c) => ({ c, reaiId: findId(c.name, c.orgnr) }));
      const byLimeId = new Map(companies.map((x) => [x.c.id, x.reaiId]));
      return htmlResponse(renderCrm({ companies, sales: crm.sales.map((s) => ({ s, customerId: byLimeId.get(s.companyId) ?? null })) }));
    }
    if (pathname === `${basePath}/create-customer`) {
      const name = String(form.get('name') ?? '').trim().slice(0, 75);
      const orgnr = extractNorwegianOrg(String(form.get('orgnr') ?? ''));
      if (!name || !orgnr) throw new HttpError(400, 'Enter a valid 9-digit Norwegian organization number.');
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { name, organizationNumber: orgnr, countryCode: 'NO', privateContact: false, skipRegistryLookup: true } }));
      return htmlResponse(html`<tr><td><strong>${name}</strong></td><td class="mono">${orgnr}</td><td>—</td><td>${reaiBadge({ text: `Created #${created.id}`, tone: 'success' })}</td><td><span class="muted-note">Synced</span></td></tr>`);
    }
    if (pathname === `${basePath}/create-order`) {
      const dealId = String(form.get('dealId') ?? '').trim();
      const dealTitle = String(form.get('title') ?? 'CRM Sale').trim().slice(0, 255);
      const value = Number(form.get('value') ?? '0');
      const date = String(form.get('date') ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
      const customerId = Number(form.get('customerId') ?? '0');
      if (!dealId || value <= 0 || customerId <= 0) throw new HttpError(400, 'Valid deal ID, value and customer required.');
      const externalReference = `lime-${dealId}`.slice(0, 100);
      const existing = /** @type {{ items: Array<{ id: number, number?: string }> }} */ (await reaiRequest(env, '/api/orders', { token: session.accessToken, tenantId: session.tenantId, query: { externalReference, status: 'all' } }));
      const dup = existing.items?.[0];
      if (dup) return htmlResponse(html`<tr><td><strong>${dealTitle}</strong></td><td>Customer #${customerId}</td><td class="mono">${date}</td><td class="num">${formatMinor(Math.round(value * 100))}</td><td><a href="${reaiOrigin(env)}/order/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Already staged ↗</a></td></tr>`);
      const created = /** @type {{ id: number }} */ (
        await reaiRequest(env, '/api/orders', {
          token: session.accessToken, tenantId: session.tenantId, method: 'POST',
          body: { customerId, currencyCode: 'NOK', daysUntilDue: 14, issueDate: date, orderDate: date, externalReference, comment: `Won in Lime CRM (#${dealId})`, orderLines: [{ itemName: dealTitle, quantity: 1, unitPrice: Number(value.toFixed(2)) }] },
        })
      );
      const url = `${reaiOrigin(env)}/order/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(html`<tr><td><strong>${dealTitle}</strong></td><td>Customer #${customerId}</td><td class="mono">${date}</td><td class="num">${formatMinor(Math.round(value * 100))}</td><td><a href="${url}" target="_blank" rel="noopener">Order #${created.id} ↗</a></td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Lime CRM error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown CRM route.', 404);
}
