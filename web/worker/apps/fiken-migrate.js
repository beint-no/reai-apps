// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiRequest } from '../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { extractNorwegianOrg } from './recman-core.js';

/** @typedef {{ kind: 'customer' | 'supplier', externalId: string, name: string, orgnr: string, email: string }} MigrateItem */

const SLUG = 'fiken-migrate';
const BRAND = 'Fiken';
const BASE_PATH = `/app/${SLUG}`;
const TITLE = 'Switch from Fiken to ReAI';
const LEAD = 'Upload the SAF-T Financial file from Fiken and import its customers and suppliers into ReAI, with their customer and supplier numbers.';
const EXPORT_HINT = 'Export the SAF-T Financial file (SAF-T Regnskap) from Fiken for the latest year and upload the XML file here. Unzip it first if Fiken gives you a ZIP file.';
const MAX_ITEMS = 2000;

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<n1:AuditFile xmlns:n1="urn:StandardAuditFile-Taxation-Financial:NO">
  <n1:MasterFiles>
    <n1:Customers>
      <n1:Customer><n1:RegistrationNumber>935606403</n1:RegistrationNumber><n1:Name>Fjord Bygg AS</n1:Name><n1:Contact><n1:Email>post+fjordbygg@aiak.no</n1:Email></n1:Contact><n1:CustomerID>10001</n1:CustomerID><n1:AccountID>1500</n1:AccountID></n1:Customer>
    </n1:Customers>
    <n1:Suppliers>
      <n1:Supplier><n1:RegistrationNumber>923609016</n1:RegistrationNumber><n1:Name>Norsk Grossist AS</n1:Name><n1:Contact><n1:Email>post+grossist@aiak.no</n1:Email></n1:Contact><n1:SupplierID>20001</n1:SupplierID><n1:AccountID>2400</n1:AccountID></n1:Supplier>
    </n1:Suppliers>
  </n1:MasterFiles>
</n1:AuditFile>`;

/**
 * Returns the text of the first direct or nested element with this local name (any namespace prefix).
 * @param {string} xml
 * @param {string} tag
 */
function xmlText(xml, tag) {
  const m = new RegExp(`<(?:[A-Za-z0-9_]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${tag}>`).exec(xml);
  return m ? decodeXml((m[1] ?? '').trim()) : '';
}

/**
 * Returns the inner XML of every element with this local name.
 * @param {string} xml
 * @param {string} tag
 */
function xmlBlocks(xml, tag) {
  const re = new RegExp(`<(?:[A-Za-z0-9_]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_]+:)?${tag}>`, 'g');
  return [...xml.matchAll(re)].map((m) => m[1] ?? '');
}

/** @param {string} s */
function decodeXml(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/**
 * Reads customers and suppliers from the MasterFiles section of a Norwegian SAF-T Financial file.
 * Format: Skatteetaten SAF-T Financial v1.30, https://github.com/Skatteetaten/saf-t
 * (Customer: RegistrationNumber, Name, Contact/Email, CustomerID; Supplier: same with SupplierID).
 * @param {string} xml
 * @returns {MigrateItem[]}
 */
export function parseSaftParties(xml) {
  const start = xml.search(/<(?:[A-Za-z0-9_]+:)?MasterFiles[\s>]/);
  const end = xml.search(/<\/(?:[A-Za-z0-9_]+:)?MasterFiles>/);
  if (start < 0 || end < start) throw new HttpError(400, 'This is not a SAF-T Financial file. The MasterFiles section is missing.');
  const master = xml.slice(start, end);
  /** @type {MigrateItem[]} */
  const items = [];
  for (const [kind, tag, idTag] of /** @type {const} */ ([['customer', 'Customer', 'CustomerID'], ['supplier', 'Supplier', 'SupplierID']])) {
    for (const block of xmlBlocks(master, tag)) {
      const name = xmlText(block, 'Name');
      if (!name) continue;
      const contact = xmlText(block, 'Contact');
      items.push({
        kind,
        externalId: xmlText(block, idTag),
        name,
        orgnr: extractNorwegianOrg(xmlText(block, 'RegistrationNumber') || xmlText(block, 'TaxRegistrationNumber')),
        email: contact ? xmlText(contact, 'Email') : '',
      });
    }
  }
  if (items.length === 0) throw new HttpError(400, 'The SAF-T file has no customers or suppliers.');
  return items.slice(0, MAX_ITEMS);
}

/** @param {MigrateItem} it @param {import('../lib/html.js').HtmlValue} action */
function itemRow(it, action) {
  return html`<td>${reaiBadge({ text: it.kind, tone: it.kind === 'supplier' ? 'accent' : 'neutral' })}</td>
    <td class="mono">${it.externalId || '—'}</td>
    <td><strong>${it.name}</strong>${it.email ? html`<br><span class="muted-note">${it.email}</span>` : ''}</td>
    <td class="mono">${it.orgnr || '—'}</td>
    <td>${action}</td>`;
}

/** @param {MigrateItem[]} items @param {boolean} isSample */
function renderItems(items, isSample) {
  const custs = items.filter((i) => i.kind === 'customer').length;
  const supps = items.filter((i) => i.kind === 'supplier').length;
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} SAF-T → REAI`,
    title: 'Customers and suppliers ready to import',
    badge: isSample ? reaiBadge({ text: 'Sample', tone: 'accent' }) : reaiBadge({ text: 'Ready to import', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Customers', value: String(custs) })}
        ${reaiMetric({ label: 'Suppliers', value: String(supps) })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Type</th><th>Number</th><th>Name</th><th>Org.nr</th><th>Action</th></tr></thead>
        <tbody>${items.map((it, idx) => html`<tr id="sw-row-${idx}">${itemRow(it, isSample
          ? html`<span class="muted-note">Sample only</span>`
          : html`<form hx-post="${BASE_PATH}/import-one" hx-target="#sw-row-${idx}" hx-swap="outerHTML">
              <input type="hidden" name="row" value="${idx}"><input type="hidden" name="itemJson" value="${JSON.stringify(it)}"><button type="submit" class="button primary">Import to ReAI</button>
            </form>`)}</tr>`)}</tbody>
      </table></div>
      ${reaiCallout({ tone: 'info', body: html`Opening balances come from the same file in the <a href="/app/saft/">SAF-T tool</a>.` })}
    `,
  });
}

/**
 * Creates one customer or supplier in ReAI unless the organization number already exists there.
 * @param {import('../lib/types.d.ts').Env} env
 * @param {{ accessToken: string, tenantId: number }} session
 * @param {MigrateItem} it
 * @returns {Promise<string>}
 */
async function importItem(env, session, it) {
  const path = it.kind === 'supplier' ? '/api/suppliers' : '/api/customers';
  const auth = { token: session.accessToken, tenantId: session.tenantId };
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
 * Handles /app/fiken-migrate/* routes.
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
        ${reaiCard({
          eyebrow: 'SAF-T FINANCIAL FILE',
          title: `Upload the SAF-T file from ${BRAND}`,
          body: html`<p class="muted-note">${EXPORT_HINT}</p>
            <form class="stack" hx-post="${BASE_PATH}/preview" hx-encoding="multipart/form-data" hx-target="#sw-output" hx-swap="innerHTML">
              ${reaiDropzone({ inputId: 'sw-file', name: 'file', accept: '.xml,application/xml,text/xml', label: 'Choose SAF-T XML file', hint: 'SAF-T Financial XML from Skatteetaten format 1.10 or 1.30.' })}
              <div class="inline-row"><button type="submit" class="button primary">Preview customers and suppliers</button><button type="button" class="button secondary" hx-post="${BASE_PATH}/sample" hx-target="#sw-output" hx-swap="innerHTML">Load sample</button></div>
            </form>`,
        })}
        <div id="sw-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderItems(parseSaftParties(SAMPLE_XML), true));

  const form = await request.formData();
  if (pathname === `${BASE_PATH}/import-one`) {
    /** @type {MigrateItem} */
    let it = { kind: 'customer', externalId: '', name: '', orgnr: '', email: '' };
    try { it = { ...it, ...JSON.parse(String(form.get('itemJson') ?? '{}')) }; } catch { /* rejected below */ }
    const row = Number(form.get('row') ?? 0) || 0;
    try {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if ((it.kind !== 'customer' && it.kind !== 'supplier') || !it.name) throw new HttpError(400, 'Invalid record.');
      const result = await importItem(env, session, it);
      return htmlResponse(html`<tr id="sw-row-${row}">${itemRow(it, reaiBadge({ text: result, tone: 'success' }))}</tr>`);
    } catch (err) {
      return htmlResponse(html`<tr id="sw-row-${row}">${itemRow(it, reaiBadge({ text: err instanceof Error ? err.message : 'Failed.', tone: 'danger' }))}</tr>`);
    }
  }
  try {
    if (pathname === `${BASE_PATH}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a SAF-T XML file first.');
      return htmlResponse(renderItems(parseSaftParties(new TextDecoder('utf-8').decode(await file.arrayBuffer())), false));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
