// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll } from '../lib/reai.js';
import { currentMonthIso, monthBounds, safeCsvCell } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * @typedef {'postings' | 'invoices' | 'supplier-invoices' | 'customers' | 'products'} DatasetKind
 */

/** @type {Record<DatasetKind, { label: string, description: string, needsMonth: boolean }>} */
const DATASETS = {
  postings: {
    label: 'General ledger postings',
    description: 'Every posting line with date, account, voucher number, VAT code, amount and description.',
    needsMonth: true,
  },
  invoices: {
    label: 'Customer invoices',
    description: 'Issued invoices and credit notes with invoice number, customer, dates, currency and totals.',
    needsMonth: true,
  },
  'supplier-invoices': {
    label: 'Supplier invoices',
    description: 'Registered supplier invoices and credit notes for spend and AP reporting.',
    needsMonth: true,
  },
  customers: {
    label: 'Customers register',
    description: 'Full customer directory with numbers, organization numbers, emails and addresses.',
    needsMonth: false,
  },
  products: {
    label: 'Product catalog',
    description: 'Products and variants with SKU, selling price, cost price, VAT code and stock status.',
    needsMonth: false,
  },
};

/**
 * @param {unknown} raw
 * @returns {DatasetKind}
 */
function parseDataset(raw) {
  if (raw === 'invoices' || raw === 'supplier-invoices' || raw === 'customers' || raw === 'products') {
    return raw;
  }
  return 'postings';
}

/**
 * Normalizes ReAI API records into clean flat headers + rows for Excel / Power BI.
 * @param {DatasetKind} dataset
 * @param {Array<Record<string, unknown>>} items
 * @returns {{ headers: string[], rows: string[][] }}
 */
function flattenDataset(dataset, items) {
  /** @param {unknown} v */
  const s = (v) => (v === null || v === undefined ? '' : String(v));

  if (dataset === 'postings') {
    return {
      headers: ['posting_date', 'voucher_number', 'account_number', 'vat_code', 'amount', 'currency', 'description'],
      rows: items.map((r) => [
        s(r.postingDate ?? r.date),
        s(r.voucherNumber ?? r.voucherId),
        s(r.accountNumber),
        s(r.vatCode),
        s(r.amount),
        s(r.currencyCode ?? 'NOK'),
        s(r.description),
      ]),
    };
  }
  if (dataset === 'invoices') {
    return {
      headers: ['id', 'number', 'issue_date', 'due_date', 'customer_name', 'currency', 'total_amount', 'status'],
      rows: items.map((r) => {
        const cust = /** @type {Record<string, unknown> | undefined} */ (r.customer);
        return [
          s(r.id),
          s(r.number ?? r.invoiceNumber),
          s(r.issueDate ?? r.invoiceDate),
          s(r.dueDate),
          s(r.customerName ?? cust?.name),
          s(r.currencyCode ?? 'NOK'),
          s(r.totalAmount ?? r.grossAmount ?? r.amount),
          s(r.status),
        ];
      }),
    };
  }
  if (dataset === 'supplier-invoices') {
    return {
      headers: ['id', 'invoice_number', 'invoice_date', 'due_date', 'supplier_name', 'currency', 'total_amount', 'document_type'],
      rows: items.map((r) => [
        s(r.id),
        s(r.invoiceNumber ?? r.number),
        s(r.invoiceDate),
        s(r.dueDate),
        s(r.supplierName),
        s(r.currencyCode ?? 'NOK'),
        s(r.totalAmount ?? r.amount),
        s(r.documentType),
      ]),
    };
  }
  if (dataset === 'customers') {
    return {
      headers: ['id', 'number', 'name', 'organization_number', 'email', 'phone', 'country_code', 'city'],
      rows: items.map((r) => [
        s(r.id),
        s(r.number),
        s(r.name),
        s(r.organizationNumber),
        s(r.email),
        s(r.phone),
        s(r.countryCode),
        s(r.city),
      ]),
    };
  }
  /** @type {string[][]} */
  const productRows = [];
  for (const p of items) {
    const variants = Array.isArray(p.variants) && p.variants.length > 0 ? p.variants : [{}];
    for (const v of variants) {
      productRows.push([
        s(p.id),
        s(p.title),
        s(v.sku),
        s(v.sellingPrice),
        s(v.costPrice),
        s(p.vatCode),
        s(p.stockItem),
      ]);
    }
  }
  return {
    headers: ['id', 'title', 'sku', 'selling_price', 'cost_price', 'vat_code', 'stock_item'],
    rows: productRows,
  };
}

/**
 * @param {DatasetKind} dataset
 * @returns {{ headers: string[], rows: string[][] }}
 */
function sampleExport(dataset) {
  if (dataset === 'postings') {
    return {
      headers: ['posting_date', 'voucher_number', 'account_number', 'vat_code', 'amount', 'currency', 'description'],
      rows: [
        ['2026-10-01', '2026-0142', '1500', '0', '25000.00', 'NOK', 'Faktura 1042 Nordic Timber AS'],
        ['2026-10-01', '2026-0142', '3000', '3', '-20000.00', 'NOK', 'Konsulenttjenester oktober'],
        ['2026-10-01', '2026-0142', '2700', '3', '-5000.00', 'NOK', 'Utgående MVA 25%'],
      ],
    };
  }
  if (dataset === 'invoices') {
    return {
      headers: ['id', 'number', 'issue_date', 'due_date', 'customer_name', 'currency', 'total_amount', 'status'],
      rows: [
        ['1042', '2026-1042', '2026-10-01', '2026-10-15', 'Nordic Timber AS', 'NOK', '25000.00', 'PAID'],
        ['1043', '2026-1043', '2026-10-12', '2026-10-26', 'Fjord Arkitektur AS', 'NOK', '18750.00', 'SENT'],
      ],
    };
  }
  return {
    headers: ['id', 'number', 'name', 'organization_number', 'email', 'phone', 'country_code', 'city'],
    rows: [
      ['1', '10001', 'Nordic Timber AS', '935606403', 'faktura@nordictimber.no', '+4791234567', 'NO', 'Oslo'],
      ['2', '10002', 'Fjord Arkitektur AS', '923609016', 'post@fjordark.no', '+4798765432', 'NO', 'Bergen'],
    ],
  };
}

/**
 * @param {{ dataset: DatasetKind, month: string, headers: string[], rows: string[][], isSample?: boolean }} state
 */
function renderExportPreview(state) {
  const { dataset, month, headers, rows, isSample } = state;
  const meta = DATASETS[dataset];
  const fileBase = meta.needsMonth ? `reai-${dataset}-${month}` : `reai-${dataset}`;
  const payload = JSON.stringify({ headers, rows });

  return reaiCard({
    eyebrow: 'EXPORT READY',
    title: meta.label,
    badge: isSample
      ? reaiBadge({ text: 'Sample dataset', tone: 'accent' })
      : reaiBadge({ text: `${rows.length} rows`, tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Rows', value: String(rows.length), detail: `${headers.length} columns` })}
        ${reaiMetric({ label: 'Period', value: meta.needsMonth ? month : 'Full register', detail: 'UTF-8 BOM Excel-safe CSV or JSON' })}
      </div>

      <div class="inline-row" style="margin-bottom:16px">
        <form method="post" action="/app/export/download">
          <input type="hidden" name="format" value="csv">
          <input type="hidden" name="filename" value="${fileBase}.csv">
          <input type="hidden" name="payload" value="${payload}">
          <button type="submit" class="button primary">Download Excel CSV (UTF-8 BOM) ↓</button>
        </form>
        <form method="post" action="/app/export/download">
          <input type="hidden" name="format" value="json">
          <input type="hidden" name="filename" value="${fileBase}.json">
          <input type="hidden" name="payload" value="${payload}">
          <button type="submit" class="button secondary">Download BI JSON ↓</button>
        </form>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>${headers.map((h) => html`<th>${h}</th>`)}</tr>
          </thead>
          <tbody>
            ${rows.slice(0, 100).map((r) => html`<tr>${r.map((cell) => html`<td>${cell}</td>`)}</tr>`)}
          </tbody>
        </table>
      </div>
      ${rows.length > 100 ? html`<p class="muted-note">Showing first 100 of ${rows.length} rows. Downloads contain the full dataset.</p>` : ''}
    `,
  });
}

/**
 * Handles /app/export/* — BI & Excel accounting data exporter.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
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
        <h1>BI &amp; Accounting Data Export</h1>
        <p class="lead">Extract clean general-ledger postings, invoices, customers or products from ReAI as Excel-ready UTF-8 CSV or structured JSON for Power BI, Google Sheets and Python workflows.</p>
      </section>

      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-export-web', clientName: 'ReAI BI Export (Web)' })}

        ${reaiCard({
          eyebrow: 'CHOOSE DATASET',
          title: 'Preview & download live ReAI data',
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
                  <label for="exp-month">Month (for postings &amp; invoices)</label>
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
    return htmlResponse(
      appShell({
        title: 'BI & Accounting Data Export',
        description: 'Export ReAI postings, invoices, customers and products to Excel CSV or BI JSON.',
        activePath: '/app/export/',
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

  if (pathname === '/app/export/download') {
    const form = await request.formData();
    const format = String(form.get('format') ?? 'csv');
    const filename = String(form.get('filename') ?? 'reai-export.csv').replace(/[^a-zA-Z0-9._-]/g, '_');
    const parsed = /** @type {{ headers: string[], rows: string[][] }} */ (JSON.parse(String(form.get('payload') ?? '{}')));
    const headers = Array.isArray(parsed.headers) ? parsed.headers : [];
    const rows = Array.isArray(parsed.rows) ? parsed.rows : [];

    if (format === 'json') {
      const objects = rows.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ''])));
      return new Response(JSON.stringify(objects, null, 2) + '\n', {
        status: 200,
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="${filename}"`,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    }
    const csv = '\uFEFF' + [headers, ...rows].map((r) => r.map(safeCsvCell).join(';')).join('\r\n') + '\r\n';
    return new Response(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  const form = await request.formData();
  const dataset = parseDataset(form.get('dataset'));
  const month = String(form.get('month') ?? currentMonthIso()).trim();

  if (pathname === '/app/export/sample') {
    const s = sampleExport(dataset);
    return htmlResponse(renderExportPreview({ dataset, month, headers: s.headers, rows: s.rows, isSample: true }));
  }

  if (pathname === '/app/export/preview') {
    try {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) {
        throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      }
      const bounds = monthBounds(month);
      /** @type {Record<string, string>} */
      const query = DATASETS[dataset].needsMonth ? { startDate: bounds.start, endDate: bounds.lastDay } : {};
      const items = /** @type {Array<Record<string, unknown>>} */ (
        await reaiAll(env, `/api/${dataset}`, {
          token: session.accessToken,
          tenantId: session.tenantId,
          query,
        })
      );
      const flat = flattenDataset(dataset, items);
      return htmlResponse(renderExportPreview({ dataset, month: bounds.month, headers: flat.headers, rows: flat.rows }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed.';
      return htmlResponse(reaiCallout({ tone: 'danger', title: 'Could not load ReAI data', body: msg }));
    }
  }

  return errorResponse('Unknown export route.', 404);
}
