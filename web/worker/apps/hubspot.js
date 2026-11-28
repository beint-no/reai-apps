// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiRequest } from '../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * @typedef {{ id: string, name: string, domain: string, phone: string, address: string, zip: string, city: string, country: string, orgnr: string }} HubSpotCompany
 * @typedef {{ company: HubSpotCompany, matchedReaiId: number | null, status: 'matched' | 'ready' | 'needs_orgnr' }} SyncRow
 */

/**
 * @param {string} value
 * @returns {boolean}
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

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeCountry(raw) {
  const c = raw.trim().toUpperCase();
  if (!c || c === 'NORWAY' || c === 'NORGE') {
    return 'NO';
  }
  if (c === 'SWEDEN' || c === 'SVERIGE') {
    return 'SE';
  }
  if (c === 'DENMARK' || c === 'DANMARK') {
    return 'DK';
  }
  return /^[A-Z]{2}$/.test(c) ? c : 'NO';
}

/**
 * Fetches all HubSpot companies, following the `paging.next.after` cursor.
 * HubSpot has no standard organization number property, so the caller names its own custom property.
 * Docs: https://developers.hubspot.com/docs/api-reference/latest/crm/objects/companies/get-companies
 * (GET /crm/objects/2026-09/companies, limit/after/properties, scope crm.objects.companies.read) and
 * https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys
 * (service key sent as Authorization: Bearer).
 * @param {string} token
 * @param {string} orgProperty
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<HubSpotCompany[]>}
 */
export async function fetchHubSpotCompanies(token, orgProperty, fetchImpl = fetch) {
  const properties = ['name', 'domain', 'phone', 'address', 'zip', 'city', 'country', ...(orgProperty ? [orgProperty] : [])];
  /** @type {Array<{ id: string, properties?: Record<string, string | null> }>} */
  const results = [];
  let after = '';
  for (let page = 0; page < 50; page++) {
    const url = new URL('https://api.hubapi.com/crm/objects/2026-09/companies');
    url.searchParams.set('limit', '100');
    url.searchParams.set('archived', 'false');
    url.searchParams.set('properties', properties.join(','));
    if (after) url.searchParams.set('after', after);
    const res = await fetchImpl(url, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      throw new HttpError(
        400,
        res.status === 401 || res.status === 403
          ? 'HubSpot rejected this key. Give it the crm.objects.companies.read scope.'
          : `HubSpot returned HTTP ${res.status}.`,
      );
    }
    const body = /** @type {{ results?: Array<{ id: string, properties?: Record<string, string | null> }>, paging?: { next?: { after?: string } } }} */ (await res.json());
    results.push(...(body.results ?? []));
    after = body.paging?.next?.after ?? '';
    if (!after) break;
  }
  return results
    .map((r) => {
      const p = r.properties ?? {};
      const orgRaw = orgProperty ? String(p[orgProperty] ?? '').replace(/\s+/g, '') : '';
      return {
        id: String(r.id),
        name: String(p.name ?? '').trim(),
        domain: String(p.domain ?? '').trim(),
        phone: String(p.phone ?? '').trim(),
        address: String(p.address ?? '').trim(),
        zip: String(p.zip ?? '').trim(),
        city: String(p.city ?? '').trim(),
        country: normalizeCountry(String(p.country ?? '')),
        orgnr: orgRaw,
      };
    })
    .filter((c) => c.name.length > 0);
}

/**
 * @param {HubSpotCompany[]} companies
 * @param {Array<{ id: number, name?: string | null, organizationNumber?: string | null }>} reaiCustomers
 * @returns {SyncRow[]}
 */
function buildSyncRows(companies, reaiCustomers) {
  return companies.map((company) => {
    const byOrg = company.orgnr
      ? reaiCustomers.find((c) => (c.organizationNumber ?? '').replace(/\s+/g, '') === company.orgnr)
      : undefined;
    const byName = reaiCustomers.find((c) => (c.name ?? '').trim().toLowerCase() === company.name.toLowerCase());
    const matched = byOrg ?? byName;
    if (matched) {
      return { company, matchedReaiId: matched.id, status: 'matched' };
    }
    if (company.country === 'NO' && !validNorwegianOrg(company.orgnr)) {
      return { company, matchedReaiId: null, status: 'needs_orgnr' };
    }
    return { company, matchedReaiId: null, status: 'ready' };
  });
}

/**
 * @param {{ rows: SyncRow[], isSample?: boolean }} state
 */
function renderSyncTable(state) {
  const { rows, isSample } = state;
  const matched = rows.filter((r) => r.status === 'matched').length;
  const ready = rows.filter((r) => r.status === 'ready').length;
  const needsOrg = rows.filter((r) => r.status === 'needs_orgnr').length;

  return html`
    ${reaiCard({
      eyebrow: 'HUBSPOT → REAI CUSTOMERS',
      title: `${rows.length} HubSpot companies scanned`,
      badge: isSample
        ? reaiBadge({ text: 'Sample preview', tone: 'accent' })
        : reaiBadge({ text: `${ready} ready to create`, tone: ready > 0 ? 'success' : 'neutral' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Already in ReAI', value: String(matched), detail: 'Matched by org.nr or name' })}
          ${reaiMetric({ label: 'Ready to create', value: String(ready), detail: 'Valid for ReAI customer API' })}
          ${reaiMetric({ label: 'Needs org.nr', value: String(needsOrg), detail: 'Enter 9-digit NO org.nr inline' })}
        </div>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Country</th>
                <th>Org.nr</th>
                <th>City</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(
                (r, idx) => html`<tr id="hs-row-${idx}">
                  <td><strong>${r.company.name}</strong>${r.company.domain ? html`<div class="muted-note">${r.company.domain}</div>` : ''}</td>
                  <td class="mono">${r.company.country}</td>
                  <td class="mono">${r.company.orgnr || '—'}</td>
                  <td>${r.company.city || '—'}</td>
                  <td>
                    ${r.status === 'matched'
                      ? reaiBadge({ text: `Matched #${r.matchedReaiId}`, tone: 'neutral' })
                      : r.status === 'ready'
                        ? reaiBadge({ text: 'Ready', tone: 'success' })
                        : reaiBadge({ text: 'Missing NO org.nr', tone: 'warn' })}
                  </td>
                  <td>
                    ${r.status === 'matched' || isSample
                      ? html`<span class="muted-note">${isSample && r.status !== 'matched' ? 'Demo only' : 'In ReAI'}</span>`
                      : html`<form class="inline-row" hx-post="/app/hubspot/create" hx-target="#hs-row-${idx}" hx-swap="outerHTML">
                          <input type="hidden" name="name" value="${r.company.name}">
                          <input type="hidden" name="country" value="${r.company.country}">
                          <input type="hidden" name="address" value="${r.company.address}">
                          <input type="hidden" name="zip" value="${r.company.zip}">
                          <input type="hidden" name="city" value="${r.company.city}">
                          <input type="hidden" name="phone" value="${r.company.phone}">
                          ${r.status === 'needs_orgnr'
                            ? html`<input type="text" name="orgnr" pattern="[0-9]{9}" maxlength="9" required placeholder="9-digit org.nr" style="width:125px">`
                            : html`<input type="hidden" name="orgnr" value="${r.company.orgnr}">`}
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
  `;
}

/**
 * Handles /app/hubspot/* SSR & HTMX routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handleHubSpot(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === '/app/hubspot' && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL('/app/hubspot/', request.url), 301);
  }

  if (pathname === '/app/hubspot/' && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro">
        <p class="eyebrow">CRM & SALES</p>
        <h1>HubSpot CRM Sync</h1>
        <p class="lead">Compare HubSpot CRM companies against your ReAI customer register and create missing customers cleanly with Norwegian org.nr validation.</p>
      </section>

      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-hubspot-web', clientName: 'ReAI HubSpot Sync (Web)' })}

        ${reaiCard({
          eyebrow: 'SCAN HUBSPOT COMPANIES',
          title: 'Connect a HubSpot service key',
          body: html`
            <p class="muted-note">In HubSpot, go to Development → Keys → Service keys and create a key with the <code>crm.objects.companies.read</code> scope. An existing private app token with that scope also works. The key is used only for this request and never stored.</p>
            <form class="stack" hx-post="/app/hubspot/scan" hx-target="#hubspot-output" hx-swap="innerHTML">
              <div class="inline-row">
                <div class="field">
                  <label for="hs-token">HubSpot service key</label>
                  <input id="hs-token" name="hubspotToken" type="password" autocomplete="off" required placeholder="pat-eu1-…">
                </div>
                <div class="field">
                  <label for="hs-org">Org.nr property (optional)</label>
                  <input id="hs-org" name="orgProperty" type="text" pattern="[a-z0-9_]{1,100}" placeholder="Internal name, e.g. orgnr">
                </div>
                <button type="submit" class="button primary">Scan HubSpot companies</button>
                <button type="button" class="button secondary" hx-post="/app/hubspot/sample" hx-target="#hubspot-output" hx-swap="innerHTML">Load sample preview</button>
              </div>
            </form>
          `,
        })}

        <div id="hubspot-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(
      appShell({
        title: 'HubSpot CRM Sync',
        description: 'Sync HubSpot CRM companies into your ReAI customer register.',
        activePath: '/app/hubspot/',
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

  if (pathname === '/app/hubspot/sample') {
    /** @type {HubSpotCompany[]} */
    const sample = [
      { id: '101', name: 'Nordic Timber AS', domain: 'nordictimber.no', phone: '+4791234567', address: 'Storgata 12', zip: '0184', city: 'Oslo', country: 'NO', orgnr: '935606403' },
      { id: '102', name: 'Fjord Arkitektur AS', domain: 'fjordark.no', phone: '+4798765432', address: 'Bryggen 4', zip: '5003', city: 'Bergen', country: 'NO', orgnr: '923609016' },
      { id: '103', name: 'Kystverket Drift AS', domain: 'kystdrift.no', phone: '', address: 'Havnegata 9', zip: '6002', city: 'Ålesund', country: 'NO', orgnr: '' },
    ];
    const rows = buildSyncRows(sample, [{ id: 42, name: 'Nordic Timber AS', organizationNumber: '935606403' }]);
    return htmlResponse(renderSyncTable({ rows, isSample: true }));
  }

  try {
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) {
      throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    }
    const form = await request.formData();

    if (pathname === '/app/hubspot/scan') {
      const token = String(form.get('hubspotToken') ?? '').trim();
      if (!token) {
        throw new HttpError(400, 'Paste your HubSpot service key.');
      }
      const orgProperty = String(form.get('orgProperty') ?? '').trim();
      if (orgProperty && !/^[a-z0-9_]{1,100}$/.test(orgProperty)) {
        throw new HttpError(400, 'Enter the internal property name in lowercase, as shown in HubSpot property settings.');
      }
      const [companies, customers] = await Promise.all([
        fetchHubSpotCompanies(token, orgProperty),
        reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId }),
      ]);
      const rows = buildSyncRows(
        companies,
        /** @type {Array<{ id: number, name?: string | null, organizationNumber?: string | null }>} */ (customers),
      );
      return htmlResponse(renderSyncTable({ rows }));
    }

    if (pathname === '/app/hubspot/create') {
      const name = String(form.get('name') ?? '').trim().slice(0, 75);
      const country = normalizeCountry(String(form.get('country') ?? 'NO'));
      const orgnr = String(form.get('orgnr') ?? '').replace(/\s+/g, '');
      const address = String(form.get('address') ?? '').trim();
      const zip = String(form.get('zip') ?? '').trim();
      const city = String(form.get('city') ?? '').trim();
      const phoneRaw = String(form.get('phone') ?? '').replace(/[ ()-]/g, '');

      if (!name) {
        throw new HttpError(400, 'Company name is required.');
      }
      if (country === 'NO' && !validNorwegianOrg(orgnr)) {
        throw new HttpError(400, 'Enter a valid 9-digit Norwegian organization number.');
      }
      /** @type {Record<string, unknown>} */
      const payload = {
        name,
        countryCode: country,
        privateContact: false,
        skipRegistryLookup: true,
        ...(orgnr ? { organizationNumber: orgnr } : {}),
        ...(address && city ? { addressPart1: address, city, ...(zip ? { postalCode: zip } : {}) } : {}),
        ...(/^\+[1-9][0-9]{6,14}$/.test(phoneRaw) ? { phone: phoneRaw } : {}),
      };
      const created = /** @type {{ id: number }} */ (
        await reaiRequest(env, '/api/customers', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: payload,
        })
      );
      return htmlResponse(html`<tr>
        <td><strong>${name}</strong></td>
        <td class="mono">${country}</td>
        <td class="mono">${orgnr || '—'}</td>
        <td>${city || '—'}</td>
        <td>${reaiBadge({ text: `Created #${created.id}`, tone: 'success' })}</td>
        <td><span class="muted-note">Synced</span></td>
      </tr>`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'HubSpot sync failed.';
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'HubSpot sync error', body: msg }));
  }

  return errorResponse('Unknown HubSpot route.', 404);
}
