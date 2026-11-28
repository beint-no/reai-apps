// @ts-check
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiRequest } from '../../lib/reai.js';
import { csvAttachment } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../../lib/ui.js';
import { decodeCsvBytes, parseCsv } from '../../lib/csv.js';

/**
 * @typedef {'products' | 'customers' | 'suppliers'} ImportKind
 * @typedef {{ id: string, title: string, aliases: string[], required?: boolean, type?: 'text' | 'decimal' | 'integer' | 'boolean' }} FieldDef
 * @typedef {{ line: number, name: string, state: 'ready' | 'skipped' | 'invalid', detail: string, payload: Record<string, unknown> | null, keys: string[] }} PreparedRow
 */

/** @type {Record<ImportKind, FieldDef[]>} */
const FIELDS = {
  products: [
    { id: 'title', title: 'Product name', aliases: ['name', 'title', 'product', 'produktnavn', 'varenavn', 'navn'], required: true },
    { id: 'sku', title: 'SKU / product number', aliases: ['sku', 'product number', 'product code', 'varenummer', 'artikkelnummer', 'produktnummer'], required: true },
    { id: 'sellingPrice', title: 'Selling price (ex. VAT)', aliases: ['price', 'selling price', 'unit price', 'pris', 'salgspris', 'enhetspris'], required: true, type: 'decimal' },
    { id: 'costPrice', title: 'Cost price', aliases: ['cost', 'cost price', 'kostpris', 'innkjopspris'], type: 'decimal' },
    { id: 'description', title: 'Description', aliases: ['description', 'beskrivelse', 'produktbeskrivelse'] },
    { id: 'brand', title: 'Brand', aliases: ['brand', 'merke', 'merkevare'] },
    { id: 'barcode', title: 'Barcode', aliases: ['barcode', 'ean', 'gtin', 'strekkode'] },
    { id: 'stockItem', title: 'Stock item', aliases: ['stock item', 'stockitem', 'lagervare'], type: 'boolean' },
    { id: 'vatCode', title: 'ReAI VAT code', aliases: ['vat code', 'vatcode', 'mvakode', 'mva kode'] },
    { id: 'revenueAccountCode', title: 'Revenue account', aliases: ['revenue account', 'inntektskonto', 'salgskonto'] },
  ],
  customers: [
    { id: 'name', title: 'Name', aliases: ['name', 'company name', 'customer name', 'navn', 'firmanavn', 'kundenavn'], required: true },
    { id: 'number', title: 'Customer number', aliases: ['number', 'customer number', 'kundenummer', 'kunde nr'] },
    { id: 'organizationNumber', title: 'Organization number', aliases: ['organization number', 'orgnr', 'org nr', 'organisasjonsnummer'] },
    { id: 'privateContact', title: 'Private person', aliases: ['private contact', 'private person', 'privatperson', 'privatkunde'], type: 'boolean' },
    { id: 'email', title: 'Email', aliases: ['email', 'epost', 'e post'] },
    { id: 'invoiceEmail', title: 'Invoice email', aliases: ['invoice email', 'faktura epost', 'fakturaepost'] },
    { id: 'phone', title: 'Phone (+country code)', aliases: ['phone', 'telephone', 'mobile', 'telefon', 'mobil'] },
    { id: 'countryCode', title: 'Country code', aliases: ['country code', 'landkode', 'country', 'land'] },
    { id: 'addressPart1', title: 'Address line 1', aliases: ['address', 'address 1', 'adresse', 'gateadresse'] },
    { id: 'postalCode', title: 'Postal code', aliases: ['postal code', 'zip', 'postnummer', 'postnr'] },
    { id: 'city', title: 'City', aliases: ['city', 'town', 'poststed', 'by'] },
    { id: 'daysUntilDue', title: 'Payment terms (days)', aliases: ['daysuntildue', 'payment days', 'betalingsfrist', 'kredittdager'], type: 'integer' },
  ],
  suppliers: [
    { id: 'name', title: 'Name', aliases: ['name', 'company name', 'supplier name', 'navn', 'firmanavn', 'leverandornavn'], required: true },
    { id: 'number', title: 'Supplier number', aliases: ['number', 'supplier number', 'leverandornummer', 'leverandor nr'] },
    { id: 'organizationNumber', title: 'Organization number', aliases: ['organization number', 'orgnr', 'org nr', 'organisasjonsnummer'] },
    { id: 'privateContact', title: 'Private person', aliases: ['private contact', 'private person', 'privatperson'], type: 'boolean' },
    { id: 'email', title: 'Email', aliases: ['email', 'epost', 'e post'] },
    { id: 'phone', title: 'Phone (+country code)', aliases: ['phone', 'telephone', 'telefon', 'mobil'] },
    { id: 'countryCode', title: 'Country code', aliases: ['country code', 'landkode', 'country', 'land'] },
    { id: 'addressPart1', title: 'Address line 1', aliases: ['address', 'address 1', 'adresse', 'gateadresse'] },
    { id: 'postalCode', title: 'Postal code', aliases: ['postal code', 'zip', 'postnummer', 'postnr'] },
    { id: 'city', title: 'City', aliases: ['city', 'town', 'poststed', 'by'] },
    { id: 'bankAccountNumber', title: 'Bank account number', aliases: ['bank account', 'kontonummer', 'bankkonto'] },
    { id: 'iban', title: 'IBAN', aliases: ['iban'] },
  ],
};

/** @type {Record<ImportKind, string>} */
const SAMPLES = {
  products: [
    'Varenummer;Produktnavn;Salgspris;Kostpris;Lagervare;MVA kode;Inntektskonto',
    'SKU-1001;Merino Wool Sweater;1490,00;620,00;ja;3;3000',
    'SKU-1002;Canvas Weekender Bag;890,00;340,00;ja;3;3000',
    'SKU-1003;Gift Wrapping Service;75,00;10,00;nei;3;3000',
  ].join('\n'),
  customers: [
    'Kundenummer;Navn;Org nr;Epost;Telefon;Landkode;Adresse;Postnr;Poststed;Betalingsfrist',
    '10010;Nordic Timber AS;935606403;faktura@nordictimber.no;+4791234567;NO;Storgata 12;0184;Oslo;14',
    '10011;Fjord Design AS;923609016;post@fjorddesign.no;+4798765432;NO;Bryggen 4;5003;Bergen;30',
  ].join('\n'),
  suppliers: [
    'Leverandornummer;Navn;Org nr;Epost;Landkode;Adresse;Postnr;Poststed;Bankkonto',
    '20010;Oslo Packaging AS;935606403;order@oslopack.no;NO;Industriveien 8;0580;Oslo;15031234567',
  ].join('\n'),
};

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeHeader(raw) {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * @param {string[]} headers
 * @param {ImportKind} kind
 * @returns {string[]}
 */
function autoMatchHeaders(headers, kind) {
  const defs = FIELDS[kind];
  const used = new Set();
  return headers.map((h) => {
    const key = normalizeHeader(h);
    if (!key) {
      return '';
    }
    const found = defs.find(
      (f) =>
        !used.has(f.id) &&
        [f.id, f.title, ...f.aliases].some((alias) => normalizeHeader(alias) === key),
    );
    if (found) {
      used.add(found.id);
      return found.id;
    }
    return '';
  });
}

/**
 * Validates Norwegian 9-digit organization number using Mod11.
 * @param {string} value
 * @returns {boolean}
 */
function validNorwegianOrg(value) {
  if (!/^[0-9]{9}$/.test(value) || value === '000000000') {
    return false;
  }
  const weights = [3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += Number(value[i]) * (weights[i] ?? 0);
  }
  const check = (11 - (sum % 11)) % 11;
  return check < 10 && check === Number(value[8]);
}

/**
 * @param {string} value
 * @param {boolean} decimalComma
 * @returns {number | null}
 */
function parseDecimal(value, decimalComma) {
  const cleaned = value.replace(/[\s\u00A0\u202F]/g, '');
  const normalized = decimalComma ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '');
  if (!/^[0-9]+(?:\.[0-9]{1,8})?$/.test(normalized)) {
    return null;
  }
  const num = Number(normalized);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

/**
 * @param {string} value
 * @returns {boolean | null}
 */
function parseBool(value) {
  const v = value.toLowerCase();
  if (['true', 'yes', 'ja', '1'].includes(v)) {
    return true;
  }
  if (['false', 'no', 'nei', '0'].includes(v)) {
    return false;
  }
  return null;
}

/**
 * @param {Record<string, string>} values
 * @param {ImportKind} kind
 * @returns {string[]}
 */
function dedupKeys(values, kind) {
  const fields = kind === 'products' ? ['sku'] : ['number', 'name', 'email'];
  /** @type {string[]} */
  const out = [];
  for (const f of fields) {
    const v = (values[f] ?? '').trim().toLowerCase();
    if (v) {
      out.push(`${f}:${v}`);
    }
  }
  return out;
}

/**
 * @param {import('../../lib/csv.js').CsvDocument} csv
 * @param {string[]} mapping
 * @param {ImportKind} kind
 * @param {boolean} decimalComma
 * @param {boolean} privatePeople
 * @param {Set<string>} existingKeys
 * @param {Set<string> | null} [vatCodes] ReAI codes for customer_invoice usage; null skips the check.
 * @returns {PreparedRow[]}
 */
function prepareRows(csv, mapping, kind, decimalComma, privatePeople, existingKeys, vatCodes = null) {
  const defs = FIELDS[kind];
  const assigned = mapping.filter(Boolean);
  if (new Set(assigned).size !== assigned.length) {
    throw new HttpError(400, 'Each ReAI field may only be mapped once.');
  }
  const missing = defs.filter((d) => d.required && !assigned.includes(d.id));
  if (missing.length > 0) {
    throw new HttpError(400, `Map required fields: ${missing.map((m) => m.title).join(', ')}.`);
  }

  const seen = new Set(existingKeys);
  /** @type {PreparedRow[]} */
  const result = [];

  for (let i = 0; i < csv.rows.length; i++) {
    const row = csv.rows[i] ?? [];
    /** @type {Record<string, string>} */
    const values = {};
    mapping.forEach((fieldId, col) => {
      if (fieldId) {
        values[fieldId] = (row[col] ?? '').trim();
      }
    });
    const name = values[kind === 'products' ? 'title' : 'name'] ?? '';
    /** @type {string[]} */
    const errs = [];
    /** @type {Record<string, unknown>} */
    const payload = {};

    for (const def of defs) {
      const val = values[def.id] ?? '';
      if (!val) {
        if (def.required) {
          errs.push(`${def.title} is required.`);
        }
        continue;
      }
      if (def.type === 'decimal') {
        const parsed = parseDecimal(val, decimalComma);
        if (parsed === null) {
          errs.push(`${def.title}: invalid number.`);
        } else {
          payload[def.id] = parsed;
        }
      } else if (def.type === 'integer') {
        const parsed = Number(val);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3000) {
          errs.push(`${def.title}: integer 0–3000 required.`);
        } else {
          payload[def.id] = parsed;
        }
      } else if (def.type === 'boolean') {
        const parsed = parseBool(val);
        if (parsed === null) {
          errs.push(`${def.title}: use yes/no or true/false.`);
        } else {
          payload[def.id] = parsed;
        }
      } else {
        payload[def.id] = val;
      }
    }

    if (kind === 'products') {
      if (values.revenueAccountCode && !/^3[0-9]{3}$/.test(values.revenueAccountCode)) {
        errs.push('Revenue account must be a 3xxx account.');
      }
      if (values.vatCode && !/^[0-9]+$/.test(values.vatCode)) {
        errs.push('Use a ReAI VAT code, not a percentage.');
      } else if (values.vatCode && vatCodes && !vatCodes.has(values.vatCode)) {
        errs.push(`VAT code ${values.vatCode} is not a sales VAT code in this ReAI company.`);
      }
      if (payload.stockItem === undefined) {
        payload.stockItem = true;
      }
      /** @type {Record<string, unknown>} */
      const variant = {};
      for (const k of ['sku', 'sellingPrice', 'costPrice', 'barcode']) {
        if (payload[k] !== undefined) {
          variant[k] = payload[k];
          delete payload[k];
        }
      }
      payload.variants = [variant];
    } else {
      const country = (values.countryCode || 'NO').toUpperCase();
      payload.countryCode = country;
      const isPrivate = typeof payload.privateContact === 'boolean' ? payload.privateContact : privatePeople;
      payload.privateContact = isPrivate;
      payload.skipRegistryLookup = true;
      if (name.length > 75) {
        errs.push('Name exceeds 75 characters.');
      }
      if (!/^[A-Z]{2}$/.test(country)) {
        errs.push('Country must be a 2-letter ISO code.');
      }
      const org = (values.organizationNumber ?? '').replace(/\s+/g, '');
      if (!isPrivate && country === 'NO' && !validNorwegianOrg(org)) {
        errs.push('Norwegian company requires a valid 9-digit org.nr.');
      }
      if (org) {
        payload.organizationNumber = org;
      }
      if (isPrivate && org) {
        errs.push('Private people cannot have an organization number.');
      }
      if (values.phone) {
        const normPhone = values.phone.replace(/[ ()-]/g, '');
        if (!/^\+[1-9][0-9]{6,14}$/.test(normPhone)) {
          errs.push('Phone requires +country code.');
        } else {
          payload.phone = normPhone;
        }
      }
      const hasAnyAddress = ['addressPart1', 'city', 'postalCode'].some((k) => Boolean(values[k]));
      if (hasAnyAddress && (!values.addressPart1 || !values.city)) {
        errs.push('Address requires both address line 1 and city.');
      }
    }

    const keys = dedupKeys(values, kind);
    const duplicate = keys.some((k) => seen.has(k));
    if (errs.length === 0) {
      for (const k of keys) {
        seen.add(k);
      }
    }
    const state = errs.length > 0 ? 'invalid' : duplicate ? 'skipped' : 'ready';
    const detail =
      errs.length > 0
        ? errs.join(' ')
        : duplicate
          ? 'Matches an existing ReAI record (active or archived) or an earlier row.'
          : 'Ready to create.';
    result.push({ line: i + 2, name, state, detail, payload: errs.length === 0 ? payload : null, keys });
  }
  return result;
}

/** Subrequests one click may spend on ReAI calls (listing pages, VAT codes and creates). */
const SUBREQUEST_BUDGET = 45;
/** Hard cap on creates per click, also when the tenant is small. */
const MAX_CREATES = 40;

/**
 * Loads existing dedup keys from ReAI for products, customers, or suppliers, active and archived,
 * at the documented maximum page size of 200.
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {import('../../lib/types.d.ts').SessionData} session
 * @param {ImportKind} kind
 * @returns {Promise<{ keys: Set<string>, requests: number }>}
 */
async function loadExistingKeys(env, session, kind) {
  const keys = new Set();
  let requests = 0;
  for (const archived of ['false', 'true']) {
    for (let page = 1; ; page++) {
      if (requests >= SUBREQUEST_BUDGET - 2) {
        throw new HttpError(400, `This company has too many ${kind} in ReAI to check for duplicates in one click. Import with the ReAI app instead.`);
      }
      const result = /** @type {{ items: Array<Record<string, unknown>>, hasNext: boolean }} */ (
        await reaiRequest(env, `/api/${kind}`, {
          token: session.accessToken,
          tenantId: session.tenantId,
          query: { archived, page: String(page), pageSize: '200' },
        })
      );
      requests += 1;
      for (const item of result.items) {
        if (kind === 'products') {
          const variants = Array.isArray(item.variants) ? item.variants : [];
          for (const v of variants) {
            if (typeof v?.sku === 'string' && v.sku.trim()) {
              keys.add(`sku:${v.sku.trim().toLowerCase()}`);
            }
          }
        } else {
          for (const f of ['number', 'name', 'email']) {
            const value = item[f];
            if (typeof value === 'string' && value.trim()) {
              keys.add(`${f}:${value.trim().toLowerCase()}`);
            }
          }
        }
      }
      if (!result.hasNext) break;
    }
  }
  return { keys, requests };
}

/**
 * Loads the VAT codes ReAI accepts on product and invoice lines, only when a row sets one.
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {import('../../lib/types.d.ts').SessionData} session
 * @param {ImportKind} kind
 * @param {import('../../lib/csv.js').CsvDocument} csv
 * @param {string[]} mapping
 * @returns {Promise<Set<string> | null>}
 */
async function loadProductVatCodes(env, session, kind, csv, mapping) {
  const col = mapping.indexOf('vatCode');
  if (kind !== 'products' || col < 0 || !csv.rows.some((r) => (r[col] ?? '').trim())) return null;
  const codes = /** @type {Array<{ code: string }>} */ (
    await reaiRequest(env, '/api/vat-codes', { token: session.accessToken, tenantId: session.tenantId, query: { usage: 'customer_invoice' } })
  );
  return new Set(codes.map((c) => c.code));
}

/**
 * @param {unknown} raw
 * @returns {ImportKind}
 */
function parseKind(raw) {
  return raw === 'customers' || raw === 'suppliers' ? raw : 'products';
}

/**
 * @param {{ kind: ImportKind, filename: string, csvText: string, csv: import('../../lib/csv.js').CsvDocument, mapping: string[], decimalComma: boolean, privatePeople: boolean, rows: PreparedRow[], checkedReai: boolean, isSample?: boolean }} state
 */
function renderImportWorkspace(state) {
  const { kind, filename, csvText, csv, mapping, decimalComma, privatePeople, rows, checkedReai, isSample } = state;
  const defs = FIELDS[kind];
  const readyCount = rows.filter((r) => r.state === 'ready').length;
  const skippedCount = rows.filter((r) => r.state === 'skipped').length;
  const invalidCount = rows.filter((r) => r.state === 'invalid').length;

  return html`
    ${reaiCard({
      eyebrow: 'STEP 2 · COLUMN MAPPING',
      title: `${filename} (${kind})`,
      badge: isSample
        ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' })
        : reaiBadge({ text: checkedReai ? 'Checked against ReAI' : 'Offline preview', tone: checkedReai ? 'success' : 'neutral' }),
      body: html`
        <form class="stack" hx-post="/app/import/preview" hx-target="#import-workspace" hx-swap="innerHTML">
          <input type="hidden" name="kind" value="${kind}">
          <input type="hidden" name="filename" value="${filename}">
          <input type="hidden" name="csvText" value="${csvText}">
          ${isSample ? html`<input type="hidden" name="isSample" value="1">` : ''}
          <div class="mapping-grid">
            ${csv.headers.map(
              (h, idx) => html`<div class="field">
                <label for="imp-col-${idx}">${h || `Column ${idx + 1}`}</label>
                <select id="imp-col-${idx}" name="map_${idx}">
                  <option value="">— Do not import —</option>
                  ${defs.map(
                    (d) => html`<option value="${d.id}"${mapping[idx] === d.id ? html` selected` : ''}>${d.title}${d.required ? ' *' : ''}</option>`,
                  )}
                </select>
              </div>`,
            )}
          </div>
          <div class="inline-row">
            ${kind === 'products'
              ? html`<label class="check-row"><input type="checkbox" name="decimalComma"${decimalComma ? html` checked` : ''}> Use comma as decimal separator (e.g. 1490,00)</label>`
              : html`<label class="check-row"><input type="checkbox" name="privatePeople"${privatePeople ? html` checked` : ''}> Default contacts to private people</label>`}
            <button type="submit" class="button secondary">Refresh preview</button>
          </div>
        </form>
      `,
    })}

    ${reaiCard({
      eyebrow: 'STEP 3 · PREVIEW & IMPORT',
      title: `${readyCount} ready · ${skippedCount} skipped · ${invalidCount} invalid`,
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Ready to create', value: String(readyCount) })}
          ${reaiMetric({ label: 'Duplicates skipped', value: String(skippedCount) })}
          ${reaiMetric({ label: 'Invalid rows', value: String(invalidCount) })}
        </div>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Row</th>
                <th>Name</th>
                <th>Status</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              ${rows.slice(0, 150).map(
                (r) => html`<tr>
                  <td class="mono">${r.line}</td>
                  <td>${r.name || '—'}</td>
                  <td>${reaiBadge({ text: r.state, tone: r.state === 'ready' ? 'success' : r.state === 'skipped' ? 'neutral' : 'danger' })}</td>
                  <td>${r.detail}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>

        ${readyCount > 0
          ? html`
            <form class="stack-sm" hx-post="/app/import/run" hx-target="#import-result" hx-swap="innerHTML">
              <input type="hidden" name="kind" value="${kind}">
              <input type="hidden" name="csvText" value="${csvText}">
              ${decimalComma ? html`<input type="hidden" name="decimalComma" value="on">` : ''}
              ${privatePeople ? html`<input type="hidden" name="privatePeople" value="on">` : ''}
              ${mapping.map((m, idx) => html`<input type="hidden" name="map_${idx}" value="${m}">`)}
              <div>
                <button type="submit" class="button primary">Import ${readyCount} ${kind} into ReAI</button>
              </div>
            </form>
            <div id="import-result" class="stack-sm"></div>
          `
          : ''}
      `,
    })}
  `;
}

/**
 * Handles /app/import/* SSR & HTMX routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handleImport(request, env) {
  const { pathname, searchParams } = new URL(request.url);
  if (pathname === '/app/import' && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL('/app/import/', request.url), 301);
  }

  if (pathname === '/app/import/template' && request.method === 'GET') {
    const kind = parseKind(searchParams.get('kind'));
    return csvAttachment(`reai-${kind}-template.csv`, [FIELDS[kind].map((f) => f.id)]);
  }

  if (pathname === '/app/import/' && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro">
        <p class="eyebrow">DATA IMPORT</p>
        <h1>Spreadsheet Import</h1>
        <p class="lead">Import products, customers or suppliers from CSV or TSV into ReAI with English and Norwegian header matching, duplicate checks and a downloadable result report.</p>
      </section>

      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-import-web', clientName: 'ReAI Import (Web)' })}

        ${reaiCard({
          eyebrow: 'STEP 1 · CHOOSE RECORD TYPE & FILE',
          title: 'Upload CSV or load a sample',
          body: html`
            <form class="stack" hx-post="/app/import/preview" hx-encoding="multipart/form-data" hx-target="#import-workspace" hx-swap="innerHTML">
              <div class="inline-row">
                <div class="field">
                  <label for="imp-kind">Record type</label>
                  <select id="imp-kind" name="kind">
                    <option value="products">Products</option>
                    <option value="customers">Customers</option>
                    <option value="suppliers">Suppliers</option>
                  </select>
                </div>
                <label class="check-row"><input type="checkbox" name="decimalComma" checked> Comma decimals (1490,00)</label>
              </div>
              ${reaiDropzone({
                inputId: 'import-csv-file',
                name: 'file',
                accept: '.csv,.tsv,text/csv,text/tab-separated-values,text/plain',
                label: 'Choose CSV or TSV file',
                hint: 'UTF-8 or Windows-1252, semicolon or comma separated (up to 10 MB / 5,000 rows).',
              })}
              <div class="inline-row">
                <button type="submit" class="button primary">Preview uploaded file</button>
                <button type="button" class="button secondary" hx-post="/app/import/sample" hx-include="#imp-kind" hx-target="#import-workspace" hx-swap="innerHTML">Load synthetic sample</button>
                <a class="button secondary" href="/app/import/template?kind=products">Products template ↓</a>
                <a class="button secondary" href="/app/import/template?kind=customers">Customers template ↓</a>
              </div>
            </form>
          `,
        })}

        <div id="import-workspace" class="stack"></div>
      </div>
    `;
    return htmlResponse(
      appShell({
        title: 'Spreadsheet Import',
        description: 'Import products, customers and suppliers from CSV into ReAI.',
        activePath: '/app/import/',
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

  if (pathname === '/app/import/export') {
    const form = await request.formData();
    const rows = /** @type {string[][]} */ (JSON.parse(String(form.get('rowsJson') ?? '[]')));
    return csvAttachment('reai-import-report.csv', rows);
  }

  if (pathname === '/app/import/sample') {
    const form = await request.formData();
    const kind = parseKind(form.get('kind'));
    const csvText = SAMPLES[kind];
    const csv = parseCsv(csvText);
    const mapping = autoMatchHeaders(csv.headers, kind);
    const session = await readSession(env, request);
    let existing = new Set();
    let checkedReai = false;
    if (session && session.tenantId > 0) {
      try {
        existing = (await loadExistingKeys(env, session, kind)).keys;
        checkedReai = true;
      } catch {
        // Stay in offline preview if token lacks read permission.
      }
    }
    const rows = prepareRows(csv, mapping, kind, true, false, existing);
    return htmlResponse(
      renderImportWorkspace({
        kind,
        filename: `sample-${kind}.csv`,
        csvText,
        csv,
        mapping,
        decimalComma: true,
        privatePeople: false,
        rows,
        checkedReai,
        isSample: true,
      }),
    );
  }

  if (pathname === '/app/import/preview' || pathname === '/app/import/run') {
    try {
      const form = await request.formData();
      const kind = parseKind(form.get('kind'));
      const decimalComma = form.get('decimalComma') === 'on';
      const privatePeople = form.get('privatePeople') === 'on';
      const isSample = form.get('isSample') === '1';
      let csvText = '';
      let filename = String(form.get('filename') ?? `${kind}.csv`);
      const file = form.get('file');
      if (file && typeof file === 'object' && 'arrayBuffer' in file && file.size > 0) {
        filename = file.name || filename;
        csvText = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
      } else {
        csvText = String(form.get('csvText') ?? '');
      }
      if (!csvText.trim()) {
        throw new HttpError(400, 'Upload a CSV file or load the synthetic sample first.');
      }
      const csv = parseCsv(csvText);
      const hasExplicitMap = form.has('map_0');
      const mapping = hasExplicitMap
        ? csv.headers.map((_, idx) => String(form.get(`map_${idx}`) ?? ''))
        : autoMatchHeaders(csv.headers, kind);

      const session = await readSession(env, request);
      if (pathname === '/app/import/preview') {
        let existing = new Set();
        let vatCodes = null;
        let checkedReai = false;
        if (session && session.tenantId > 0) {
          existing = (await loadExistingKeys(env, session, kind)).keys;
          vatCodes = await loadProductVatCodes(env, session, kind, csv, mapping);
          checkedReai = true;
        }
        const rows = prepareRows(csv, mapping, kind, decimalComma, privatePeople, existing, vatCodes);
        return htmlResponse(
          renderImportWorkspace({ kind, filename, csvText, csv, mapping, decimalComma, privatePeople, rows, checkedReai, isSample }),
        );
      }

      if (!session || session.tenantId <= 0) {
        throw new HttpError(401, 'Connect to ReAI and choose a company above before importing.');
      }
      const { keys: existing, requests } = await loadExistingKeys(env, session, kind);
      const vatCodes = await loadProductVatCodes(env, session, kind, csv, mapping);
      const rows = prepareRows(csv, mapping, kind, decimalComma, privatePeople, existing, vatCodes);
      const ready = rows.filter((r) => r.state === 'ready' && r.payload);
      const maxCreates = Math.max(0, Math.min(MAX_CREATES, SUBREQUEST_BUDGET - requests - (vatCodes ? 1 : 0)));
      if (ready.length > maxCreates) {
        throw new HttpError(400, `One click can create at most ${maxCreates} ${kind}. Split the file into smaller parts; rows already in ReAI are skipped on the next run.`);
      }

      /** @type {Array<{ line: number, name: string, status: string, id: string, detail: string }>} */
      const report = [];
      let created = 0;
      for (const row of rows) {
        if (row.state !== 'ready' || !row.payload) {
          report.push({ line: row.line, name: row.name, status: row.state, id: '', detail: row.detail });
          continue;
        }
        try {
          const res = /** @type {{ id: number }} */ (
            await reaiRequest(env, `/api/${kind}`, {
              token: session.accessToken,
              tenantId: session.tenantId,
              method: 'POST',
              body: row.payload,
            })
          );
          created += 1;
          report.push({ line: row.line, name: row.name, status: 'created', id: String(res.id), detail: `Created in ReAI (#${res.id})` });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Creation failed.';
          report.push({ line: row.line, name: row.name, status: 'rejected', id: '', detail: msg });
        }
      }

      const csvReport = [
        ['Source row', 'Name', 'Status', 'ReAI ID', 'Details'],
        ...report.map((r) => [String(r.line), r.name, r.status, r.id, r.detail]),
      ];

      return htmlResponse(html`
        ${reaiCallout({
          tone: 'success',
          title: `Import finished (${created} created)`,
          body: `Processed ${report.length} rows. Download the result CSV to inspect IDs or any rejected rows.`,
        })}
        <form method="post" action="/app/import/export">
          <input type="hidden" name="rowsJson" value="${JSON.stringify(csvReport)}">
          <button type="submit" class="button secondary">Download result report CSV ↓</button>
        </form>
      `);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Import failed.';
      return htmlResponse(reaiCallout({ tone: 'danger', title: 'Import error', body: msg }));
    }
  }

  return errorResponse('Unknown import route.', 404);
}
