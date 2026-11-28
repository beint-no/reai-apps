// @ts-check
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiRequest } from '../../lib/reai.js';
import { currentMonthIso, monthBounds, safeCsvCell } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/**
 * @typedef {'postings' | 'invoices' | 'supplier-invoices' | 'customers' | 'products'} DatasetKind
 * @typedef {Record<string, any>} Item
 * @typedef {{ items: Item[], page: number, totalItems: number, totalPages: number, hasNext: boolean }} ReaiPage
 * @typedef {{ used: number }} Budget
 */

const PAGE_SIZE = 200;
const PREVIEW_SIZE = 100;
/** Subrequests one export may make; Workers cap subrequests per invocation. */
const MAX_SUBREQUESTS = 45;
const CONCURRENCY = 4;
/** Largest dataset one download can read, leaving room for supplier name lookups. */
const MAX_ROWS = (MAX_SUBREQUESTS - 5) * PAGE_SIZE;

/** @type {Record<DatasetKind, { label: string, description: string, needsMonth: boolean }>} */
const DATASETS = {
  postings: { label: 'General ledger postings', description: 'Every posting line with date, voucher, account, VAT code and amounts.', needsMonth: true },
  invoices: { label: 'Customer invoices', description: 'Invoices and credit notes issued in the month, with totals, paid and outstanding amounts.', needsMonth: true },
  'supplier-invoices': { label: 'Supplier invoices', description: 'Registered supplier invoices and credit notes dated in the month.', needsMonth: true },
  customers: { label: 'Customers', description: 'Active and archived customers with numbers, organization numbers and contact details.', needsMonth: false },
  products: { label: 'Products', description: 'Active products, one row per variant, with SKU, prices and VAT code.', needsMonth: false },
};

/**
 * @param {unknown} raw
 * @returns {DatasetKind}
 */
function parseDataset(raw) {
  if (raw === 'invoices' || raw === 'supplier-invoices' || raw === 'customers' || raw === 'products') return raw;
  return 'postings';
}

/** @param {unknown} v */
const s = (v) => (v === null || v === undefined ? '' : String(v));

/**
 * Normalizes ReAI API records into flat headers and rows. Field names follow the ReAI OpenAPI schemas
 * PostingRes, InvoiceOverviewRes, SupplierInvoiceListItemRes, CustomerOverviewRes and ProductRes.
 * @param {DatasetKind} dataset
 * @param {Item[]} items
 * @param {Map<number, string>} [supplierNames]
 * @returns {{ headers: string[], rows: string[][] }}
 */
export function flattenDataset(dataset, items, supplierNames = new Map()) {
  if (dataset === 'postings') {
    return {
      headers: ['posting_date', 'voucher_number', 'voucher_id', 'posting_id', 'account_number', 'vat_code', 'amount', 'currency_amount', 'currency', 'description', 'project_id', 'department_id', 'customer_id', 'supplier_id', 'employee_id'],
      rows: items.map((r) => [s(r.postingDate), s(r.voucherNumber), s(r.voucherId), s(r.id), s(r.accountNumber), s(r.vatCode), s(r.amount), s(r.currencyAmount), s(r.currencyCode), s(r.description), s(r.projectId), s(r.departmentId), s(r.customerId), s(r.supplierId), s(r.employeeId)]),
    };
  }
  if (dataset === 'invoices') {
    return {
      headers: ['id', 'number', 'issue_date', 'due_date', 'customer_id', 'customer_name', 'currency', 'total_excl_vat', 'total_vat', 'total_amount', 'paid_amount', 'outstanding', 'company_currency_amount', 'credited_invoice_id'],
      rows: items.map((r) => [s(r.id), s(r.number), s(r.issueDate), s(r.dueDate), s(r.customerId), s(r.customerName), s(r.currencyCode), s(r.totalExclVatAmount), s(r.totalVatAmount), s(r.totalAmount), s(r.paidAmount), s(r.outstanding), s(r.invoiceCompanyCurrencyAmount), s(r.creditedInvoiceId)]),
    };
  }
  if (dataset === 'supplier-invoices') {
    return {
      headers: ['id', 'number', 'document_type', 'date', 'due_date', 'supplier_id', 'supplier_name', 'currency', 'total_amount', 'paid_amount', 'remaining_amount', 'voucher_id'],
      rows: items.map((r) => [s(r.id), s(r.number), s(r.documentType), s(r.date), s(r.dueDate), s(r.supplierId), s(supplierNames.get(Number(r.supplierId))), s(r.currencyCode), s(r.totalAmount), s(r.paymentState?.paidAmount), s(r.paymentState?.remainingAmount), s(r.voucherId)]),
    };
  }
  if (dataset === 'customers') {
    return {
      headers: ['id', 'number', 'name', 'type', 'organization_number', 'email', 'invoice_email', 'phone', 'address', 'postal_code', 'city', 'country_code', 'archived'],
      rows: items.map((r) => [s(r.id), s(r.number), s(r.name), s(r.type), s(r.organizationNumber), s(r.email), s(r.invoiceEmail), s(r.phone), [r.address?.addressPart1, r.address?.addressPart2].filter(Boolean).join(', '), s(r.address?.postalCode), s(r.address?.city), s(r.address?.countryCode), s(r.archived)]),
    };
  }
  /** @type {string[][]} */
  const productRows = [];
  for (const p of items) {
    const variants = Array.isArray(p.variants) && p.variants.length > 0 ? p.variants : [{}];
    for (const v of variants) {
      productRows.push([s(p.id), s(v.variantId), s(p.title), s(p.productCode), s(v.sku), s(v.barcode), s(v.sellingPrice), s(v.costPrice), s(p.vatCode), s(p.stockItem)]);
    }
  }
  return { headers: ['product_id', 'variant_id', 'title', 'product_code', 'sku', 'barcode', 'selling_price', 'cost_price', 'vat_code', 'stock_item'], rows: productRows };
}

/** API-shaped synthetic records, run through the same mapping as live data. @type {Record<DatasetKind, Item[]>} */
const SAMPLE_ITEMS = {
  postings: [
    { id: 90001, postingDate: '2026-10-01', voucherNumber: '2026-0142', voucherId: 142, accountNumber: '1500', vatCode: '0', amount: 25000, currencyAmount: 25000, currencyCode: 'NOK', description: 'Faktura 1042 Nordic Timber AS', customerId: 1 },
    { id: 90002, postingDate: '2026-10-01', voucherNumber: '2026-0142', voucherId: 142, accountNumber: '3000', vatCode: '3', amount: -25000, currencyAmount: -25000, currencyCode: 'NOK', description: 'Konsulenttjenester oktober' },
  ],
  invoices: [
    { id: 1042, number: '1042', issueDate: '2026-10-01', dueDate: '2026-10-15', customerId: 1, customerName: 'Nordic Timber AS', currencyCode: 'NOK', totalExclVatAmount: 20000, totalVatAmount: 5000, totalAmount: 25000, paidAmount: 25000, outstanding: 0, invoiceCompanyCurrencyAmount: 25000 },
    { id: 1043, number: '1043', issueDate: '2026-10-12', dueDate: '2026-10-26', customerId: 2, customerName: 'Fjord Arkitektur AS', currencyCode: 'NOK', totalExclVatAmount: 15000, totalVatAmount: 3750, totalAmount: 18750, paidAmount: 0, outstanding: 18750, invoiceCompanyCurrencyAmount: 18750 },
  ],
  'supplier-invoices': [
    { id: 501, number: 'F-88120', documentType: 'invoice', date: '2026-10-03', dueDate: '2026-10-17', supplierId: 7, currencyCode: 'NOK', totalAmount: 12500, paymentState: { paidAmount: 12500, remainingAmount: 0 }, voucherId: 150 },
  ],
  customers: [
    { id: 1, number: '10001', name: 'Nordic Timber AS', type: 'company', organizationNumber: '935606403', email: 'post+nordic@aiak.no', phone: '+4791234567', address: { addressPart1: 'Storgata 1', postalCode: '0155', city: 'Oslo', countryCode: 'NO' }, archived: false },
  ],
  products: [
    { id: 11, title: 'Ullgenser', productCode: 'UG', vatCode: '3', stockItem: true, variants: [{ variantId: 21, sku: 'UG-M', barcode: '7090000000011', sellingPrice: 899, costPrice: 350 }, { variantId: 22, sku: 'UG-L', sellingPrice: 899, costPrice: 350 }] },
  ],
};

/**
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {import('../../lib/types.d.ts').SessionData} session
 * @param {string} path
 * @param {Record<string, string>} query
 * @param {number} page
 * @param {number} pageSize
 * @param {Budget} budget
 * @returns {Promise<ReaiPage>}
 */
async function fetchPage(env, session, path, query, page, pageSize, budget) {
  if (budget.used >= MAX_SUBREQUESTS) throw new HttpError(400, `This export reads at most ${MAX_ROWS} records per download.`);
  budget.used += 1;
  return /** @type {ReaiPage} */ (await reaiRequest(env, path, { token: session.accessToken, tenantId: session.tenantId, query: { ...query, page: String(page), pageSize: String(pageSize) } }));
}

/**
 * Reads every page of a ReAI list: page 1 first, then the remaining pages with bounded concurrency.
 * Fails before fetching when totalPages would exceed the subrequest budget.
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {import('../../lib/types.d.ts').SessionData} session
 * @param {string} path
 * @param {Record<string, string>} query
 * @param {Budget} budget
 * @returns {Promise<Item[]>}
 */
async function fetchAll(env, session, path, query, budget) {
  const first = await fetchPage(env, session, path, query, 1, PAGE_SIZE, budget);
  const totalPages = Math.max(1, Number(first.totalPages) || 1);
  if (budget.used + totalPages - 1 > MAX_SUBREQUESTS) {
    throw new HttpError(400, `${first.totalItems} records is more than this export reads per download (${MAX_ROWS}).`);
  }
  /** @type {Item[][]} */
  const pages = [first.items];
  for (let start = 2; start <= totalPages; start += CONCURRENCY) {
    const batch = [];
    for (let p = start; p < start + CONCURRENCY && p <= totalPages; p++) batch.push(fetchPage(env, session, path, query, p, PAGE_SIZE, budget));
    for (const res of await Promise.all(batch)) pages.push(res.items);
  }
  return pages.flat();
}

/**
 * Supplier id to name for supplier invoices (active and archived suppliers).
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {import('../../lib/types.d.ts').SessionData} session
 * @param {Item[]} items
 * @param {Budget} budget
 * @returns {Promise<Map<number, string>>}
 */
async function supplierNames(env, session, items, budget) {
  /** @type {Map<number, string>} */
  const names = new Map();
  if (items.length === 0) return names;
  const lists = await Promise.all([
    fetchAll(env, session, '/api/suppliers', { archived: 'false' }, budget),
    fetchAll(env, session, '/api/suppliers', { archived: 'true' }, budget),
  ]);
  for (const sup of lists.flat()) names.set(Number(sup.id), s(sup.name));
  return names;
}

/**
 * @param {DatasetKind} dataset
 * @param {string} month
 * @returns {Record<string, string>}
 */
function datasetQuery(dataset, month) {
  if (!DATASETS[dataset].needsMonth) return {};
  const b = monthBounds(month);
  return { startDate: b.start, endDate: b.lastDay };
}

/**
 * Loads a dataset from ReAI. Preview reads only the first page; download reads every page.
 * Customers combine the active and archived lists, which ReAI serves separately.
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {import('../../lib/types.d.ts').SessionData} session
 * @param {DatasetKind} dataset
 * @param {string} month
 * @param {'preview' | 'all'} mode
 * @returns {Promise<{ headers: string[], rows: string[][], totalItems: number, subrequests: number }>}
 */
export async function loadDataset(env, session, dataset, month, mode) {
  const budget = { used: 0 };
  const path = `/api/${dataset}`;
  const query = datasetQuery(dataset, month);
  const queries = dataset === 'customers' ? [{ archived: 'false' }, { archived: 'true' }] : [query];
  /** @type {Item[]} */
  let items = [];
  let totalItems = 0;
  if (mode === 'preview') {
    const pages = await Promise.all(queries.map((q) => fetchPage(env, session, path, q, 1, PREVIEW_SIZE, budget)));
    items = pages.flatMap((p) => p.items).slice(0, PREVIEW_SIZE);
    totalItems = pages.reduce((sum, p) => sum + Number(p.totalItems ?? p.items.length), 0);
  } else {
    items = (await Promise.all(queries.map((q) => fetchAll(env, session, path, q, budget)))).flat();
    totalItems = items.length;
  }
  const names = dataset === 'supplier-invoices' ? await supplierNames(env, session, items, budget) : undefined;
  return { ...flattenDataset(dataset, items, names), totalItems, subrequests: budget.used };
}

/**
 * @param {{ dataset: DatasetKind, month: string, headers: string[], rows: string[][], totalItems: number, isSample?: boolean }} state
 */
function renderExportPreview(state) {
  const { dataset, month, headers, rows, isSample, totalItems } = state;
  const meta = DATASETS[dataset];
  /** @param {'csv' | 'json'} format @param {string} label @param {string} cls */
  const downloadForm = (format, label, cls) => html`<form method="post" action="/app/export/download">
      <input type="hidden" name="format" value="${format}"><input type="hidden" name="dataset" value="${dataset}"><input type="hidden" name="month" value="${month}">
      ${isSample ? html`<input type="hidden" name="sample" value="1">` : ''}
      <button type="submit" class="button ${cls}">${label}</button>
    </form>`;
  return reaiCard({
    eyebrow: 'EXPORT READY',
    title: meta.label,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${totalItems} records`, tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Records', value: String(totalItems), detail: `${headers.length} columns` })}
        ${reaiMetric({ label: 'Period', value: meta.needsMonth ? month : 'Full register', detail: meta.description })}
      </div>
      <div class="inline-row" style="margin-bottom:16px">
        ${downloadForm('csv', 'Download Excel CSV ↓', 'primary')}
        ${downloadForm('json', 'Download JSON ↓', 'secondary')}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr>${headers.map((h) => html`<th>${h}</th>`)}</tr></thead>
        <tbody>${rows.map((r) => html`<tr>${r.map((cell) => html`<td>${cell}</td>`)}</tr>`)}</tbody>
      </table></div>
      ${totalItems > MAX_ROWS ? reaiCallout({ tone: 'warn', body: `This dataset has more than ${MAX_ROWS} records, which is more than one download reads.` }) : ''}
      ${totalItems > rows.length && !isSample ? html`<p class="muted-note">The preview shows the first ${rows.length} records. The download reads all of them from ReAI.</p>` : ''}
    `,
  });
}

/**
 * @param {string} filename
 * @param {'csv' | 'json'} format
 * @param {{ headers: string[], rows: string[][] }} data
 * @returns {Response}
 */
function downloadResponse(filename, format, data) {
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-disposition': `attachment; filename="${filename}"` };
  if (format === 'json') {
    const objects = data.rows.map((r) => Object.fromEntries(data.headers.map((h, i) => [h, r[i] ?? ''])));
    return new Response(JSON.stringify(objects, null, 2) + '\n', { status: 200, headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } });
  }
  const csv = '﻿' + [data.headers, ...data.rows].map((r) => r.map(safeCsvCell).join(';')).join('\r\n') + '\r\n';
  return new Response(csv, { status: 200, headers: { ...headers, 'content-type': 'text/csv; charset=utf-8' } });
}

/**
 * Handles /app/export/*: exports ReAI data to Excel CSV or JSON.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handleExport(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === '/app/export' && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL('/app/export/', request.url), 301);
  }

  if (pathname === '/app/export/' && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const defaultMonth = currentMonthIso();
    const body = html`
      <section class="app-intro">
        <p class="eyebrow">BI, EXCEL & REPORTING</p>
        <h1>Accounting Data Export</h1>
        <p class="lead">Export postings, invoices, supplier invoices, customers or products from ReAI as Excel CSV or JSON for Power BI, Google Sheets and your own analysis.</p>
      </section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-export-web', clientName: 'ReAI BI Export (Web)' })}
        ${reaiCard({
          eyebrow: 'CHOOSE DATASET',
          title: 'Preview and download ReAI data',
          body: html`
            <form class="stack" hx-post="/app/export/preview" hx-target="#export-output" hx-swap="innerHTML">
              <div class="inline-row">
                <div class="field">
                  <label for="exp-dataset">Dataset</label>
                  <select id="exp-dataset" name="dataset">
                    ${Object.entries(DATASETS).map(([k, v]) => html`<option value="${k}">${v.label}</option>`)}
                  </select>
                </div>
                <div class="field">
                  <label for="exp-month">Month (postings and invoices)</label>
                  <input id="exp-month" name="month" type="text" pattern="[0-9]{4}-[0-9]{2}" value="${defaultMonth}" required>
                </div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Load from ReAI</button>
                <button type="button" class="button secondary" hx-post="/app/export/sample" hx-include="#exp-dataset,#exp-month" hx-target="#export-output" hx-swap="innerHTML">Load sample dataset</button>
              </div>
            </form>
          `,
        })}
        <div id="export-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: 'Accounting Data Export', description: 'Export ReAI postings, invoices, customers and products to Excel CSV or JSON.', activePath: '/app/export/', body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const form = await request.formData();
  const dataset = parseDataset(form.get('dataset'));
  const month = String(form.get('month') ?? currentMonthIso()).trim();
  const isSample = form.get('sample') === '1';

  if (pathname === '/app/export/sample') {
    const flat = flattenDataset(dataset, SAMPLE_ITEMS[dataset], new Map([[7, 'Kontorrekvisita AS']]));
    return htmlResponse(renderExportPreview({ dataset, month, ...flat, totalItems: SAMPLE_ITEMS[dataset].length, isSample: true }));
  }

  if (pathname === '/app/export/download') {
    const format = form.get('format') === 'json' ? 'json' : 'csv';
    const fileBase = DATASETS[dataset].needsMonth ? `reai-${dataset}-${monthBounds(month).month}` : `reai-${dataset}`;
    if (isSample) return downloadResponse(`${fileBase}-sample.${format}`, format, flattenDataset(dataset, SAMPLE_ITEMS[dataset], new Map([[7, 'Kontorrekvisita AS']])));
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company first.');
    return downloadResponse(`${fileBase}.${format}`, format, await loadDataset(env, session, dataset, month, 'all'));
  }

  if (pathname === '/app/export/preview') {
    try {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const data = await loadDataset(env, session, dataset, month, 'preview');
      return htmlResponse(renderExportPreview({ dataset, month: DATASETS[dataset].needsMonth ? monthBounds(month).month : month, ...data }));
    } catch (err) {
      return htmlResponse(reaiCallout({ tone: 'danger', title: 'Could not load ReAI data', body: err instanceof Error ? err.message : 'Export failed.' }));
    }
  }

  return errorResponse('Unknown export route.', 404);
}
