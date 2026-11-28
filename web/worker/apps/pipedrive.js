// @ts-check
import { fetchJson, isoDate } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * @typedef {{ id: number, name: string, address: string, country: string, orgnr: string }} PipedriveOrg
 * @typedef {{ id: number, title: string, value: number, currency: string, orgName: string, wonDate: string }} PipedriveDeal
 * @typedef {{ id: number, name?: string | null, organizationNumber?: string | null }} ReAICustomer
 */

/**
 * @param {string} value
 */
function validNorwegianOrg(value) {
  if (!/^[0-9]{9}$/.test(value) || value === '000000000') {
    return false;
  }
  const w = [3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += Number(value[i]) * (w[i] ?? 0);
  }
  const check = (11 - (sum % 11)) % 11;
  return check < 10 && check === Number(value[8]);
}

const PIPEDRIVE_API = 'https://api.pipedrive.com/api/v2';

/**
 * Reads every page of a Pipedrive API v2 list endpoint (cursor pagination, at most 500 items per page).
 * @param {string} path
 * @param {Record<string, string>} query
 * @param {string} token
 * @param {import('../lib/api-http.js').FetchLike} fetchImpl
 * @returns {Promise<any[]>}
 */
async function listAll(path, query, token, fetchImpl) {
  /** @type {any[]} */
  const all = [];
  let cursor = '';
  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ ...query, limit: '500', ...(cursor ? { cursor } : {}) });
    const body = await fetchJson(`${PIPEDRIVE_API}${path}?${params}`, { headers: { 'x-api-token': token, accept: 'application/json' } }, 'Pipedrive', fetchImpl);
    if (Array.isArray(body?.data)) all.push(...body.data);
    cursor = typeof body?.additional_data?.next_cursor === 'string' ? body.additional_data.next_cursor : '';
    if (!cursor) return all;
  }
  return all;
}

/**
 * Reads organizations and won deals from the Pipedrive API v2.
 * Docs: https://developers.pipedrive.com/docs/api/v1/Organizations#getOrganizations (GET /api/v2/organizations),
 * https://developers.pipedrive.com/docs/api/v1/Deals#getDeals (GET /api/v2/deals?status=won),
 * https://pipedrive.readme.io/docs/how-to-find-the-api-token (personal token, sent as the x-api-token header per the v2 OpenAPI api_key scheme) and
 * https://developers.pipedrive.com/changelog/post/deprecated-apiv1-endpoints-become-out-of-support (v1 lists replaced).
 * @param {string} token
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<{ orgs: PipedriveOrg[], deals: PipedriveDeal[] }>}
 */
export async function fetchApi(token, fetchImpl = fetch) {
  const [orgRows, dealRows] = await Promise.all([
    listAll('/organizations', {}, token, fetchImpl),
    listAll('/deals', { status: 'won', sort_by: 'update_time', sort_direction: 'desc' }, token, fetchImpl),
  ]);
  /** @type {Map<number, string>} */
  const orgNames = new Map();
  const orgs = orgRows
    .map((o) => {
      const name = String(o.name ?? '').trim();
      orgNames.set(Number(o.id), name);
      return { id: Number(o.id), name, address: String(o.address?.value ?? '').trim(), country: String(o.address?.country ?? '').trim(), orgnr: '' };
    })
    .filter((o) => o.name.length > 0);
  const deals = dealRows
    .map((d) => ({
      id: Number(d.id),
      title: String(d.title ?? `Deal #${d.id}`).trim(),
      value: Number(d.value ?? 0),
      currency: String(d.currency ?? 'NOK').toUpperCase(),
      orgName: d.org_id ? (orgNames.get(Number(d.org_id)) ?? '') : '',
      wonDate: isoDate(d.local_won_date ?? d.won_time),
    }))
    .filter((d) => d.value > 0);
  return { orgs, deals };
}

/**
 * @param {{ orgs: Array<{ org: PipedriveOrg, reaiId: number | null }>, deals: Array<{ deal: PipedriveDeal, customerId: number | null }>, isSample?: boolean }} state
 */
function renderPipedriveResults(state) {
  const newOrgs = state.orgs.filter((o) => o.reaiId === null).length;
  const readyDeals = state.deals.filter((d) => d.customerId !== null).length;
  return html`
    <div class="metric-grid">
      ${reaiMetric({ label: 'Organizations scanned', value: String(state.orgs.length), detail: `${newOrgs} not yet in ReAI` })}
      ${reaiMetric({ label: 'Won deals scanned', value: String(state.deals.length), detail: `${readyDeals} matched to ReAI customer` })}
      ${reaiMetric({ label: 'Order idempotency', value: 'External ref', detail: 'Prevents duplicate orders per deal' })}
    </div>

    ${reaiCard({
      eyebrow: 'ORGANIZATIONS → REAI CUSTOMERS',
      title: 'Pipedrive organizations',
      badge: reaiBadge({ text: `${newOrgs} missing`, tone: newOrgs > 0 ? 'accent' : 'success' }),
      body: html`
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Organization</th>
                <th>Address</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${state.orgs.map(
                ({ org, reaiId }, idx) => html`<tr id="pd-org-${idx}">
                  <td><strong>${org.name}</strong></td>
                  <td>${org.address || '—'}</td>
                  <td>${reaiId ? reaiBadge({ text: `Matched #${reaiId}`, tone: 'neutral' }) : reaiBadge({ text: 'New customer', tone: 'warn' })}</td>
                  <td>
                    ${reaiId || state.isSample
                      ? html`<span class="muted-note">${state.isSample && !reaiId ? 'Demo only' : 'In ReAI'}</span>`
                      : html`<form class="inline-row" hx-post="/app/pipedrive/create-customer" hx-target="#pd-org-${idx}" hx-swap="outerHTML">
                          <input type="hidden" name="name" value="${org.name}">
                          <input type="text" name="orgnr" pattern="[0-9]{9}" maxlength="9" required placeholder="9-digit org.nr" style="width:125px">
                          <button type="submit" class="button primary">Create</button>
                        </form>`}
                  </td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>
      `,
    })}

    ${reaiCard({
      eyebrow: 'WON DEALS → REAI DRAFT ORDERS',
      title: 'Stage won deals as ReAI orders',
      badge: reaiBadge({ text: `${readyDeals} ready`, tone: readyDeals > 0 ? 'success' : 'neutral' }),
      body: html`
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Deal</th>
                <th>Organization</th>
                <th>Won date</th>
                <th class="num">Value</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${state.deals.map(
                ({ deal, customerId }, idx) => html`<tr id="pd-deal-${idx}">
                  <td><strong>${deal.title}</strong></td>
                  <td>${deal.orgName || '—'}</td>
                  <td class="mono">${deal.wonDate}</td>
                  <td class="num">${formatMinor(Math.round(deal.value * 100))} ${deal.currency}</td>
                  <td>
                    ${state.isSample || !customerId
                      ? html`<span class="muted-note">${state.isSample ? 'Demo only' : 'Create customer above first'}</span>`
                      : html`<form hx-post="/app/pipedrive/create-order" hx-target="#pd-deal-${idx}" hx-swap="outerHTML">
                          <input type="hidden" name="dealId" value="${deal.id}">
                          <input type="hidden" name="title" value="${deal.title}">
                          <input type="hidden" name="value" value="${deal.value.toFixed(2)}">
                          <input type="hidden" name="currency" value="${deal.currency}">
                          <input type="hidden" name="wonDate" value="${deal.wonDate}">
                          <input type="hidden" name="customerId" value="${customerId}">
                          <button type="submit" class="button primary">Stage order</button>
                        </form>`}
                  </td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>
      `,
    })}
  `;
}

/**
 * Handles /app/pipedrive/* SSR & HTMX routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handlePipedrive(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === '/app/pipedrive' && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL('/app/pipedrive/', request.url), 301);
  }

  if (pathname === '/app/pipedrive/' && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro">
        <p class="eyebrow">CRM & SALES PIPELINE</p>
        <h1>Pipedrive CRM Sync</h1>
        <p class="lead">Sync Pipedrive organizations into your ReAI customer register and convert won deals directly into draft ReAI customer orders ready for invoicing.</p>
      </section>

      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-pipedrive-web', clientName: 'ReAI Pipedrive Sync (Web)' })}

        ${reaiCard({
          eyebrow: 'SCAN PIPEDRIVE',
          title: 'Connect a Pipedrive API token',
          body: html`
            <p class="muted-note">In Pipedrive, click your account name, then Company settings → Personal preferences → API, and copy your personal API token. Used only for this scan and never stored.</p>
            <form class="stack" hx-post="/app/pipedrive/scan" hx-target="#pd-output" hx-swap="innerHTML">
              <div class="inline-row">
                <div class="field">
                  <label for="pd-token">Pipedrive API token</label>
                  <input id="pd-token" name="apiToken" type="password" autocomplete="off" required placeholder="40-character Pipedrive token">
                </div>
                <button type="submit" class="button primary">Scan Pipedrive</button>
                <button type="button" class="button secondary" hx-post="/app/pipedrive/sample" hx-target="#pd-output" hx-swap="innerHTML">Load sample preview</button>
              </div>
            </form>
          `,
        })}

        <div id="pd-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(
      appShell({
        title: 'Pipedrive CRM Sync',
        description: 'Sync Pipedrive organizations and won deals into ReAI customers and draft orders.',
        activePath: '/app/pipedrive/',
        body,
      }),
    );
  }

  if (request.method !== 'POST') {
    return errorResponse('Method not allowed.', 405);
  }
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  if (pathname === '/app/pipedrive/sample') {
    return htmlResponse(
      renderPipedriveResults({
        isSample: true,
        orgs: [
          { org: { id: 1, name: 'Fjord Logistics AS', address: 'Kaigaten 14, Bergen', country: 'NO', orgnr: '935606403' }, reaiId: 18 },
          { org: { id: 2, name: 'Viken Energi AS', address: 'Storgata 50, Drammen', country: 'NO', orgnr: '' }, reaiId: null },
        ],
        deals: [
          { deal: { id: 501, title: 'Annual ERP Advisory Retainer', value: 85000, currency: 'NOK', orgName: 'Fjord Logistics AS', wonDate: '2026-10-18' }, customerId: 18 },
          { deal: { id: 502, title: 'Q4 Implementation Sprint', value: 42000, currency: 'NOK', orgName: 'Viken Energi AS', wonDate: '2026-10-21' }, customerId: null },
        ],
      }),
    );
  }

  try {
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) {
      throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    }
    const form = await request.formData();

    if (pathname === '/app/pipedrive/scan') {
      const token = String(form.get('apiToken') ?? '').trim();
      if (!token) {
        throw new HttpError(400, 'Enter your Pipedrive API token.');
      }
      const [pd, customersRaw] = await Promise.all([
        fetchApi(token),
        reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId }),
      ]);
      const customers = /** @type {ReAICustomer[]} */ (customersRaw);
      /** @param {string} name */
      const findByName = (name) =>
        customers.find((c) => (c.name ?? '').trim().toLowerCase() === name.trim().toLowerCase())?.id ?? null;

      return htmlResponse(
        renderPipedriveResults({
          orgs: pd.orgs.map((org) => ({ org, reaiId: findByName(org.name) })),
          deals: pd.deals.map((deal) => ({ deal, customerId: deal.orgName ? findByName(deal.orgName) : null })),
        }),
      );
    }

    if (pathname === '/app/pipedrive/create-customer') {
      const name = String(form.get('name') ?? '').trim().slice(0, 75);
      const orgnr = String(form.get('orgnr') ?? '').replace(/\s+/g, '');
      if (!name || !validNorwegianOrg(orgnr)) {
        throw new HttpError(400, 'Enter a valid 9-digit Norwegian organization number.');
      }
      const created = /** @type {{ id: number }} */ (
        await reaiRequest(env, '/api/customers', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: { name, countryCode: 'NO', organizationNumber: orgnr, privateContact: false, skipRegistryLookup: true },
        })
      );
      return htmlResponse(html`<tr>
        <td><strong>${name}</strong></td>
        <td class="mono">${orgnr}</td>
        <td>${reaiBadge({ text: `Created #${created.id}`, tone: 'success' })}</td>
        <td><span class="muted-note">Synced</span></td>
      </tr>`);
    }

    if (pathname === '/app/pipedrive/create-order') {
      const dealId = String(form.get('dealId') ?? '').trim();
      const title = String(form.get('title') ?? 'Pipedrive Deal').trim();
      const value = Number(form.get('value') ?? '0');
      const currency = String(form.get('currency') ?? 'NOK').toUpperCase().slice(0, 3);
      const wonDate = String(form.get('wonDate') ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
      const customerId = Number(form.get('customerId') ?? '0');
      if (!dealId || value <= 0 || customerId <= 0) {
        throw new HttpError(400, 'Valid deal ID, positive value and customer are required.');
      }
      const externalReference = `pipedrive-deal-${dealId}`;
      const existing = /** @type {{ items: Array<{ id: number | null }> }} */ (
        await reaiRequest(env, '/api/orders', { token: session.accessToken, tenantId: session.tenantId, query: { externalReference, pageSize: '1' } })
      );
      const dupId = existing.items[0]?.id;
      if (dupId) {
        return htmlResponse(html`<tr>
        <td><strong>${title}</strong></td>
        <td>Customer #${customerId}</td>
        <td class="mono">${wonDate}</td>
        <td class="num">${formatMinor(Math.round(value * 100))} ${currency}</td>
        <td><a href="${reaiOrigin(env)}/order/${dupId}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Already staged #${dupId} ↗</a></td>
      </tr>`);
      }
      const created = /** @type {{ id: number }} */ (
        await reaiRequest(env, '/api/orders', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: {
            customerId,
            currencyCode: currency,
            daysUntilDue: 14,
            issueDate: wonDate,
            orderDate: wonDate,
            externalReference,
            comment: `Won in Pipedrive (#${dealId})`,
            orderLines: [{ itemName: title, quantity: 1, unitPrice: Number(value.toFixed(2)) }],
          },
        })
      );
      const url = `${reaiOrigin(env)}/order/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(html`<tr>
        <td><strong>${title}</strong></td>
        <td>Customer #${customerId}</td>
        <td class="mono">${wonDate}</td>
        <td class="num">${formatMinor(Math.round(value * 100))} ${currency}</td>
        <td><a href="${url}" target="_blank" rel="noopener">Order #${created.id} ↗</a></td>
      </tr>`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Pipedrive sync failed.';
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Pipedrive sync error', body: msg }));
  }

  return errorResponse('Unknown Pipedrive route.', 404);
}
