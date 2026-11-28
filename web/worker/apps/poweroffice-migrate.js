// @ts-check
import { fetchJson, num, pickList, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiRequest } from '../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';
import { extractNorwegianOrg } from './recman-core.js';

/** @typedef {{ kind: 'customer' | 'supplier' | 'product', externalId: string, name: string, orgnr: string, email: string, price: number }} MigrateItem */

/** @type {MigrateItem[]} */
const SAMPLE = [{"kind": "customer", "externalId": "10100", "name": "Vesterålen Logistikk AS", "orgnr": "935606403", "email": "regnskap@vesteralenlog.no", "price": 0}, {"kind": "supplier", "externalId": "20100", "name": "Trondheim Kontor & IT AS", "orgnr": "923609016", "email": "faktura@trondheimit.no", "price": 0}, {"kind": "product", "externalId": "PO-500", "name": "Serviceavtale bedrift", "orgnr": "", "email": "", "price": 8500}];

/**
 * Fetches customers, suppliers, and products from PowerOffice Go v2 API.
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<MigrateItem[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const subKey = (creds.subscriptionKey ?? '').trim();
  if (!token) throw new HttpError(400, 'Enter your PowerOffice Go API token.');
  if (!subKey) throw new HttpError(400, 'Enter your PowerOffice Go Ocp-Apim-Subscription-Key.');
  const headers = { authorization: `Bearer ${token}`, 'ocp-apim-subscription-key': subKey, accept: 'application/json' };
  const [cData, sData, pData] = await Promise.all([
    fetchJson('https://goapi.poweroffice.net/v2/Customers', { headers }, 'PowerOffice Go', fetchImpl),
    fetchJson('https://goapi.poweroffice.net/v2/Suppliers', { headers }, 'PowerOffice Go', fetchImpl).catch(() => []),
    fetchJson('https://goapi.poweroffice.net/v2/Products', { headers }, 'PowerOffice Go', fetchImpl).catch(() => []),
  ]);
  /** @type {MigrateItem[]} */
  const items = [];
  for (const c of pickList(cData)) items.push({ kind: 'customer', externalId: String(c.Code ?? c.Id ?? ''), name: String(c.Name ?? ''), orgnr: extractNorwegianOrg(String(c.OrganizationNumber ?? '')), email: String(c.EmailAddress ?? ''), price: 0 });
  for (const s of pickList(sData)) items.push({ kind: 'supplier', externalId: String(s.Code ?? s.Id ?? ''), name: String(s.Name ?? ''), orgnr: extractNorwegianOrg(String(s.OrganizationNumber ?? '')), email: String(s.EmailAddress ?? ''), price: 0 });
  for (const p of pickList(pData)) items.push({ kind: 'product', externalId: String(p.Code ?? p.Id ?? ''), name: String(p.Name ?? ''), orgnr: '', email: '', price: num(p.SalesPrice ?? 0) });
  return items.filter((i) => i.name.length > 0);
}

/** @param {string} csvText @returns {MigrateItem[]} */
function parseMigrationCsv(csvText) {
  const doc = parseCsv(csvText);
  const h = doc.headers.map((x) => x.toLowerCase().trim());
  const typeIdx = h.findIndex((x) => x.includes('type') || x.includes('kind'));
  const idIdx = h.findIndex((x) => x.includes('number') || x.includes('nummer') || x.includes('sku') || x.includes('id'));
  const nameIdx = h.findIndex((x) => x.includes('name') || x.includes('navn') || x.includes('title') || x.includes('kunde') || x.includes('leverand'));
  const orgIdx = h.findIndex((x) => x.includes('org'));
  const emailIdx = h.findIndex((x) => x.includes('email') || x.includes('epost'));
  const priceIdx = h.findIndex((x) => x.includes('price') || x.includes('pris'));
  if (nameIdx < 0) throw new HttpError(400, 'CSV needs a Name / Navn / Title column.');
  return doc.rows
    .map((r, idx) => {
      const rawType = typeIdx >= 0 ? (r[typeIdx] ?? '').toLowerCase() : '';
      const price = priceIdx >= 0 ? Number((r[priceIdx] ?? '0').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0 : 0;
      /** @type {'customer' | 'supplier' | 'product'} */
      const kind = rawType.includes('supp') || rawType.includes('lev') ? 'supplier' : rawType.includes('prod') || rawType.includes('vare') || price > 0 ? 'product' : 'customer';
      return { kind, externalId: idIdx >= 0 ? (r[idIdx] ?? '').trim() : String(idx + 1), name: (r[nameIdx] ?? '').trim(), orgnr: orgIdx >= 0 ? extractNorwegianOrg(r[orgIdx] ?? '') : '', email: emailIdx >= 0 ? (r[emailIdx] ?? '').trim() : '', price };
    })
    .filter((i) => i.name.length > 0);
}

/** @param {MigrateItem[]} items @param {boolean} isSample */
function renderItems(items, isSample) {
  const custs = items.filter((i) => i.kind === 'customer').length;
  const supps = items.filter((i) => i.kind === 'supplier').length;
  const prods = items.filter((i) => i.kind === 'product').length;
  return reaiCard({
    eyebrow: 'POWEROFFICE GO → REAI MIGRATION',
    title: `${items.length} records ready to import`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Ready to import', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Customers', value: String(custs), detail: 'POST /api/customers' })}
        ${reaiMetric({ label: 'Suppliers', value: String(supps), detail: 'POST /api/suppliers' })}
        ${reaiMetric({ label: 'Products', value: String(prods), detail: 'POST /api/products' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Type</th><th>ID / SKU</th><th>Name</th><th>Org.nr / Price</th><th>Action</th></tr></thead>
        <tbody>${items.slice(0, 120).map(
          (it, idx) => html`<tr id="sw-row-${idx}">
            <td>${reaiBadge({ text: it.kind, tone: it.kind === 'product' ? 'accent' : 'neutral' })}</td>
            <td class="mono">${it.externalId || '—'}</td>
            <td><strong>${it.name}</strong>${it.email ? html`<br><span class="muted-note">${it.email}</span>` : ''}</td>
            <td class="mono">${it.kind === 'product' ? `${it.price.toFixed(2)} NOK` : it.orgnr || '—'}</td>
            <td>${isSample
              ? html`<span class="muted-note">Demo only</span>`
              : html`<form hx-post="/app/poweroffice-migrate/import-one" hx-target="#sw-row-${idx}" hx-swap="outerHTML">
                  <input type="hidden" name="itemJson" value="${JSON.stringify(it)}"><button type="submit" class="button primary">Import to ReAI</button>
                </form>`}</td>
          </tr>`,
        )}</tbody>
      </table></div>
      ${reaiCallout({ tone: 'info', body: html`Also bringing over your opening trial balance? Upload your SAF-T XML in our <a href="/app/saft/">SAF-T Norway Switcher →</a> to post directly to <code>PUT /api/opening-balance</code>.` })}
    `,
  });
}

/**
 * Handles /app/poweroffice-migrate/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/poweroffice-migrate';
  const title = "PowerOffice Go Migration Tool";
  const lead = "Connect PowerOffice Go v2 API or upload CSV exports to migrate customers, suppliers and products straight into ReAI \u2014 combine with our SAF-T tool for opening balances.";

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">SWITCH FROM POWEROFFICE GO TO REAI</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-poweroffice-migrate-web', clientName: 'ReAI PowerOffice Go Switcher' })}
        ${renderApiFetchCard({
          basePath,
          targetId: 'sw-output',
          brand: 'PowerOffice Go',
          hint: 'Connect PowerOffice Go v2 API (Ocp-Apim-Subscription-Key + Bearer token) to migrate customers, suppliers & products directly.',
          fields: [
            { name: 'subscriptionKey', label: 'Ocp-Apim-Subscription-Key', type: 'password', placeholder: 'Subscription Key' },
            { name: 'apiToken', label: 'PowerOffice Go Bearer token', type: 'password', placeholder: 'Bearer access token' },
          ],
          sampleAction: true,
        })}
        ${reaiCard({
          eyebrow: 'CSV EXPORT IMPORT',
          title: 'Upload PowerOffice Go customer, supplier or product CSV',
          body: html`<form class="stack" hx-post="${basePath}/preview-csv" hx-encoding="multipart/form-data" hx-target="#sw-output" hx-swap="innerHTML">
            ${reaiDropzone({ inputId: 'sw-csv', name: 'file', accept: '.csv,text/csv', label: 'Choose CSV file', hint: 'Columns: Type (customer/supplier/product), Number/SKU, Name, OrgNr, Email, Price.' })}
            <div class="inline-row"><button type="submit" class="button primary">Preview CSV records</button><button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#sw-output" hx-swap="innerHTML">Load sample migration</button></div>
          </form>`,
        })}
        <div id="sw-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) return htmlResponse(renderItems(SAMPLE, true));

  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */
      const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderItems(await fetchApi(creds), false));
    }
    if (pathname === `${basePath}/preview-csv`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a CSV file first.');
      return htmlResponse(renderItems(parseMigrationCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer()))), false));
    }
    if (pathname === `${basePath}/import-one`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const it = /** @type {MigrateItem} */ (JSON.parse(String(form.get('itemJson') ?? '{}')));
      /** @type {{ id: number }} */
      let created;
      if (it.kind === 'product') {
        created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/products', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { title: it.name.slice(0, 120), sku: it.externalId || undefined, price: Number(it.price.toFixed(2)), vatCode: '3' } }));
      } else {
        created = /** @type {{ id: number }} */ (await reaiRequest(env, it.kind === 'supplier' ? '/api/suppliers' : '/api/customers', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { name: it.name.slice(0, 75), ...(it.orgnr ? { organizationNumber: it.orgnr } : {}), ...(it.email ? { email: it.email } : {}), countryCode: 'NO', privateContact: !it.orgnr, skipRegistryLookup: true } }));
      }
      return htmlResponse(html`<tr><td>${reaiBadge({ text: it.kind, tone: 'neutral' })}</td><td class="mono">${it.externalId || '—'}</td><td><strong>${it.name}</strong></td><td class="mono">${it.kind === 'product' ? `${it.price.toFixed(2)} NOK` : it.orgnr || '—'}</td><td>${reaiBadge({ text: `Imported #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'PowerOffice Go error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown switcher route.', 404);
}
