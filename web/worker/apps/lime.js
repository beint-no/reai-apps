// @ts-check
import { assertPublicHttpsUrl } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';
import { extractNorwegianOrg } from './recman-core.js';

/**
 * @typedef {{ id: string, name: string, orgnr: string, city: string }} CrmCompany
 * @typedef {{ id: string, title: string, companyName: string, value: number, date: string }} CrmSale
 * @typedef {{ id: number, name?: string | null, organizationNumber?: string | null }} ReAICust
 */

/**
 * @param {string} baseUrl
 * @param {string} token
 * @returns {Promise<{ companies: CrmCompany[], sales: CrmSale[] }>}
 */
async function fetchCrm(baseUrl, token) {
  const parsed = assertPublicHttpsUrl(baseUrl);
  const base = parsed.origin + parsed.pathname.replace(/\/+$/, '');
  const headers = { 'x-api-key': token, accept: 'application/json' };
  const [cUrl, sUrl] = [`${base}/company/?_limit=50`, `${base}/deal/?_limit=50`];
  const [cRes, sRes] = await Promise.all([
    fetch(cUrl, { headers, redirect: 'manual', signal: AbortSignal.timeout(20_000) }),
    fetch(sUrl, { headers, redirect: 'manual', signal: AbortSignal.timeout(20_000) }),
  ]);
  if (!cRes.ok || !sRes.ok) throw new HttpError(400, `Lime CRM rejected the URL or API credentials (HTTP ${!cRes.ok ? cRes.status : sRes.status}).`);
  const cJson = /** @type {any} */ (await cRes.json());
  const sJson = /** @type {any} */ (await sRes.json());
  const cArr = Array.isArray(cJson.value) ? cJson.value : Array.isArray(cJson._embedded?.limeobject) ? cJson._embedded.limeobject : Array.isArray(cJson) ? cJson : [];
  const sArr = Array.isArray(sJson.value) ? sJson.value : Array.isArray(sJson._embedded?.limeobject) ? sJson._embedded.limeobject : Array.isArray(sJson) ? sJson : [];
  const companies = cArr
    .map((/** @type {any} */ c) => ({ id: String(c.ContactId ?? c._id ?? c.id ?? ''), name: String(c.Name ?? c.name ?? '').trim(), orgnr: extractNorwegianOrg(String(c.OrgNr ?? c.orgnr ?? c.registrationno ?? '')), city: String(c.City ?? c.visitingcity ?? c.city ?? '').trim() }))
    .filter((/** @type {CrmCompany} */ x) => x.name.length > 0);
  const sales = sArr
    .map((/** @type {any} */ s) => ({ id: String(s.SaleId ?? s._id ?? s.id ?? ''), title: String(s.Heading ?? s.name ?? s.title ?? 'CRM Deal').trim(), companyName: String(s.ContactName ?? s.company?.name ?? '').trim(), value: Number(s.Amount ?? s.value ?? 0), date: String(s.Saledate ?? s.closeddate ?? new Date().toISOString()).slice(0, 10) }))
    .filter((/** @type {CrmSale} */ x) => x.value > 0);
  return { companies, sales };
}

/** @param {{ companies: Array<{ c: CrmCompany, reaiId: number | null }>, sales: Array<{ s: CrmSale, customerId: number | null }>, isSample?: boolean }} state */
function renderCrm(state) {
  const missing = state.companies.filter((x) => !x.reaiId).length;
  const ready = state.sales.filter((x) => x.customerId !== null).length;
  return html`
    <div class="metric-grid">
      ${reaiMetric({ label: 'Companies scanned', value: String(state.companies.length), detail: `${missing} new to ReAI` })}
      ${reaiMetric({ label: 'Won sales scanned', value: String(state.sales.length), detail: `${ready} matched to ReAI customer` })}
      ${reaiMetric({ label: 'Order protection', value: 'External ref', detail: 'Idempotent per CRM deal ID' })}
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
  const lead = "Sync Lime CRM companies into ReAI customers and turn won Lime deals directly into idempotent ReAI draft orders ready for EHF invoicing.";

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">NORDIC B2B CRM</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-lime-web', clientName: 'ReAI Lime CRM (Web)' })}
        ${reaiCard({
          eyebrow: 'CONNECT LIME CRM',
          title: 'Scan companies & won sales',
          body: html`<p class="muted-note">Credentials are used only for this single HTTPS scan and are never stored.</p>
            <form class="stack" hx-post="${basePath}/scan" hx-target="#crm-output" hx-swap="innerHTML">
              <div class="inline-row">
                <div class="field"><label for="crm-url">Lime CRM API Base URL</label><input id="crm-url" name="baseUrl" type="url" required placeholder="https://company.lime-crm.com/company/api/v1/limeobject"></div>
                <div class="field"><label for="crm-tok">Lime x-api-key</label><input id="crm-tok" name="apiToken" type="password" autocomplete="off" required placeholder="API token"></div>
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
        { s: { id: '701', title: 'Annual Support SLA 2027', companyName: 'Nordic Maritime AS', value: 145000, date: '2026-10-20' }, customerId: 21 },
        { s: { id: '702', title: 'Onboarding Workshop', companyName: 'Sørlandet Industri AS', value: 38000, date: '2026-10-22' }, customerId: null },
      ],
    }));
  }

  try {
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    const form = await request.formData();

    if (pathname === `${basePath}/scan`) {
      const [crm, custRaw] = await Promise.all([
        fetchCrm(String(form.get('baseUrl') ?? ''), String(form.get('apiToken') ?? '').trim()),
        reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId }),
      ]);
      const custs = /** @type {ReAICust[]} */ (custRaw);
      /** @param {string} name @param {string} [org] */
      const findId = (name, org = '') =>
        (org ? custs.find((x) => (x.organizationNumber ?? '').replace(/\s+/g, '') === org)?.id : undefined) ??
        custs.find((x) => (x.name ?? '').trim().toLowerCase() === name.trim().toLowerCase())?.id ?? null;
      return htmlResponse(renderCrm({ companies: crm.companies.map((c) => ({ c, reaiId: findId(c.name, c.orgnr) })), sales: crm.sales.map((s) => ({ s, customerId: s.companyName ? findId(s.companyName) : null })) }));
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
      const created = /** @type {{ id: number }} */ (
        await reaiRequest(env, '/api/orders', {
          token: session.accessToken, tenantId: session.tenantId, method: 'POST',
          body: { customerId, currencyCode: 'NOK', daysUntilDue: 14, issueDate: date, orderDate: date, externalReference: `lime-${dealId}`.slice(0, 100), comment: `Won in Lime CRM (#${dealId})`, orderLines: [{ itemName: dealTitle, quantity: 1, unitPrice: Number(value.toFixed(2)) }] },
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
