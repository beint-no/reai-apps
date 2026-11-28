// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiRequest } from '../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';
import { extractNorwegianOrg } from './recman-core.js';

/** @typedef {{ kind: 'customer' | 'supplier' | 'product', externalId: string, name: string, orgnr: string, email: string, price: number }} MigrateItem */

/** @type {MigrateItem[]} */
const SAMPLE = [{"kind": "customer", "externalId": "10001", "name": "Fjord Bygg & Montage AS", "orgnr": "935606403", "email": "faktura@fjordbygg.no", "price": 0}, {"kind": "supplier", "externalId": "20001", "name": "Norsk Grossist Partner AS", "orgnr": "923609016", "email": "ordre@norskgrossist.no", "price": 0}, {"kind": "product", "externalId": "SKU-100", "name": "Konsulenttime senior", "orgnr": "", "email": "", "price": 1450}];



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
    eyebrow: 'TRIPLETEX → REAI MIGRATION',
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
              : html`<form hx-post="/app/tripletex-migrate/import-one" hx-target="#sw-row-${idx}" hx-swap="outerHTML">
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
 * Handles /app/tripletex-migrate/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/tripletex-migrate';
  const title = "Tripletex Direct Migration Tool";
  const lead = "Move your customers, suppliers and products straight from Tripletex to ReAI via the Tripletex v2 API or CSV export \u2014 with Norwegian org.nr validation and zero re-typing.";

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">SWITCH FROM TRIPLETEX TO REAI</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-tripletex-migrate-web', clientName: 'ReAI Tripletex Switcher' })}
        ${reaiCard({
          eyebrow: 'DIRECT TRIPLETEX API IMPORT',
          title: 'Fetch live contacts & products from Tripletex',
          body: html`<p class="muted-note">Your Tripletex session token is used for this single HTTPS request and never stored.</p>
            <form class="stack" hx-post="${basePath}/scan-api" hx-target="#sw-output" hx-swap="innerHTML">
              <div class="inline-row"><div class="field"><label for="sw-tok">Tripletex session token</label><input id="sw-tok" name="apiToken" type="password" autocomplete="off" required placeholder="Paste token"></div></div>
              <div class="inline-row"><button type="submit" class="button primary">Fetch from Tripletex API</button><button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#sw-output" hx-swap="innerHTML">Load sample migration</button></div>
            </form>`,
        })}
        ${reaiCard({
          eyebrow: 'CSV EXPORT IMPORT',
          title: 'Upload Tripletex customer, supplier or product CSV',
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
    if (pathname === `${basePath}/scan-api`) {
      const token = String(form.get('apiToken') ?? '').trim();
      if (!token) throw new HttpError(400, 'Enter an API token.');
      const auth = `Basic ${btoa(`0:${token}`)}`;
      const [cRes, sRes, pRes] = await Promise.all([
        fetch('https://tripletex.no/v2/customer?count=50&fields=id,customerNumber,name,organizationNumber,email', { headers: { authorization: auth, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) }),
        fetch('https://tripletex.no/v2/supplier?count=50&fields=id,supplierNumber,name,organizationNumber,email', { headers: { authorization: auth, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) }),
        fetch('https://tripletex.no/v2/product?count=50&fields=id,number,name,priceExcludingVatCurrency', { headers: { authorization: auth, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) }),
      ]);
      if (!cRes.ok) throw new HttpError(400, `Tripletex API returned HTTP ${cRes.status}. Verify your session token.`);
      const [cData, sData, pData] = await Promise.all([cRes.json(), sRes.ok ? sRes.json() : { values: [] }, pRes.ok ? pRes.json() : { values: [] }]);
      /** @type {MigrateItem[]} */
      const items = [];
      for (const c of /** @type {any} */ (cData).values ?? []) items.push({ kind: 'customer', externalId: String(c.customerNumber ?? c.id ?? ''), name: String(c.name ?? ''), orgnr: extractNorwegianOrg(String(c.organizationNumber ?? '')), email: String(c.email ?? ''), price: 0 });
      for (const s of /** @type {any} */ (sData).values ?? []) items.push({ kind: 'supplier', externalId: String(s.supplierNumber ?? s.id ?? ''), name: String(s.name ?? ''), orgnr: extractNorwegianOrg(String(s.organizationNumber ?? '')), email: String(s.email ?? ''), price: 0 });
      for (const p of /** @type {any} */ (pData).values ?? []) items.push({ kind: 'product', externalId: String(p.number ?? p.id ?? ''), name: String(p.name ?? ''), orgnr: '', email: '', price: Number(p.priceExcludingVatCurrency ?? 0) || 0 });
      return htmlResponse(renderItems(items.filter((i) => i.name), false));
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
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Tripletex error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown switcher route.', 404);
}
