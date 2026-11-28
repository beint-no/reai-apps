// @ts-check
import { fetchJson } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { extractNorwegianOrg } from '../../lib/norway.js';
import { reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/**
 * @typedef {{ id: number, project: string, customer: string, isInvoice: boolean, invoiceNumber: string, issued: string, netMinor: number, vatMinor: number, currency: string, typeText: string, problem: string }} InvoiceSummary
 * @typedef {{ itemName: string, quantity: number, unitPrice: number, vatPercent: number, netMinor: number, vatMinor: number }} InvoiceLine
 * @typedef {{ name: string, orgnr: string, email: string, address: string, address2: string, zip: string, city: string, countryCode: string }} InvoiceCustomer
 * @typedef {InvoiceSummary & { officeId: string, invoiceDate: string, dueDate: string, ourReference: string, invoiceReference: string, customerData: InvoiceCustomer, lines: InvoiceLine[] }} InvoiceDetail
 * @typedef {{ code: string, rate: number, vatType: string, reverseCharge: boolean }} VatCode
 */

const SLUG = 'qondor';
const BRAND = 'Qondor';
const BASE_PATH = `/app/${SLUG}`;
const TITLE = 'Qondor Invoices to ReAI';
const LEAD = 'Fetch unprocessed Qondor invoice specifications and invoices, stage each one in ReAI with the items, prices and VAT from Qondor, and mark it as processed in Qondor.';
const API = 'https://qondor.azure-api.net/Prod/Invoicing/v1';
const COUNTRIES = /** @type {Record<string, string>} */ ({ norway: 'NO', norge: 'NO', noreg: 'NO', sweden: 'SE', sverige: 'SE', denmark: 'DK', danmark: 'DK', finland: 'FI', suomi: 'FI', iceland: 'IS', island: 'IS', germany: 'DE', tyskland: 'DE', 'united kingdom': 'GB', storbritannia: 'GB' });

/** @type {InvoiceSummary[]} */
const SAMPLE = [
  { id: 100, project: 'NO1034/Kickoff Lofoten', customer: 'Fjord Energi AS', isInvoice: false, invoiceNumber: '', issued: '2026-10-12', netMinor: 3672100, vatMinor: 306943, currency: 'NOK', typeText: 'Customer offer invoice', problem: '' },
  { id: 101, project: 'NO1040/Fagdag Bergen', customer: 'Kari Nordmann', isInvoice: true, invoiceNumber: '1000', issued: '2026-10-14', netMinor: 364105, vatMinor: 2651, currency: 'NOK', typeText: 'Booker credit card payment', problem: 'Card payment' },
];

/** @param {unknown} v */
const minor = (v) => Math.round(Number(v ?? 0) * 100);
/** @param {unknown} v */
const day = (v) => (typeof v === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(v) && !v.startsWith('0001') ? v.slice(0, 10) : '');

/** @param {string} key */
function headers(key) {
  return { 'ocp-apim-subscription-key': key, accept: 'application/json' };
}

/**
 * Explains why an invoice is left in Qondor, or returns ''.
 * Types: 1 invoice, 2 cancellation. invoiceType 1–3 are invoices, 4–6 credit card payments.
 * @param {any} inv
 */
function summaryProblem(inv) {
  if (inv?.externallyProcessed) return 'Already processed';
  if (Number(inv?.type) === 2) return 'Credit note';
  if ([4, 5, 6].includes(Number(inv?.invoiceType))) return 'Card payment';
  if (![1, 2, 3].includes(Number(inv?.invoiceType))) return 'Unknown invoice type';
  return '';
}

/** @param {any} inv @returns {InvoiceSummary} */
function mapSummary(inv) {
  return {
    id: Number(inv?.id ?? 0),
    project: String(inv?.event ?? inv?.projectNumber ?? inv?.projectNo ?? '').trim(),
    customer: String(inv?.customerName ?? inv?.name ?? '').trim(),
    isInvoice: Boolean(inv?.isInvoice),
    invoiceNumber: inv?.invoiceNumber ? String(inv.invoiceNumber) : '',
    issued: day(inv?.invoiceDate) || day(inv?.dateOfIssueUtc),
    netMinor: minor(inv?.amountExclVat ?? inv?.totalAmountExclVat),
    vatMinor: minor(inv?.vatAmount ?? inv?.totalVatAmount),
    currency: String(inv?.currency ?? '').toUpperCase(),
    typeText: String(inv?.invoiceTypeText ?? inv?.typeText ?? '').replace(/([a-z])([A-Z])/g, '$1 $2'),
    problem: summaryProblem(inv),
  };
}

/**
 * Lists invoices and invoice specifications that are not processed yet.
 * Docs: https://qondor.developer.azure-api.net/ (Invoicing v1 (Prod), server https://qondor.azure-api.net/Prod/Invoicing/v1,
 * header Ocp-Apim-Subscription-Key; GET /Invoice/GetAllUnprocessedInvoices) and
 * https://help.qondor.com/en/articles/1227269-api-portal-introduction (keys on the API portal profile after Qondor support grants access).
 * @param {Record<string, string>} creds `apiKey`
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<InvoiceSummary[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const key = (creds.apiKey ?? '').trim();
  if (!key) throw new HttpError(400, 'Enter your Qondor subscription key.');
  const res = await fetchJson(`${API}/Invoice/GetAllUnprocessedInvoices`, { headers: headers(key) }, BRAND, fetchImpl);
  /** @type {any[]} */ const list = Array.isArray(res) ? res : [];
  return list.map(mapSummary).filter((i) => i.id > 0).sort((a, b) => a.issued.localeCompare(b.issued) || a.id - b.id);
}

/**
 * Reads one invoice with its items. Docs: Invoicing v1, GET /Invoice/GetInvoice/{id}
 * (items[].prices[] with quantity, outPriceExVat, totalOutPriceExclVat, totalOutVatAmount, totalVatBaseAmount, vatPercentage;
 * referral items are excluded unless includeReferralProducts=true).
 * @param {string} key
 * @param {number} id
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<InvoiceDetail>}
 */
export async function fetchInvoice(key, id, fetchImpl = fetch) {
  const inv = await fetchJson(`${API}/Invoice/GetInvoice/${id}`, { headers: headers(key) }, BRAND, fetchImpl);
  const summary = mapSummary(inv);
  /** @type {InvoiceLine[]} */ const lines = [];
  let problem = summary.problem;
  for (const item of /** @type {any[]} */ (Array.isArray(inv?.items) ? inv.items : [])) {
    if (item?.referral || Number(item?.billingModel) === 1) continue;
    for (const p of /** @type {any[]} */ (Array.isArray(item?.prices) ? item.prices : [])) {
      const net = minor(p?.totalOutPriceExclVat);
      const vat = minor(p?.totalOutVatAmount);
      if (net === 0 && vat === 0) continue;
      if (minor(p?.totalVatBaseAmount) !== net && vat !== 0) problem ||= `VAT on "${String(p?.description ?? item?.nameOnInvoice)}" is calculated on a different base than the price`;
      const qty = Number(p?.quantity ?? 1);
      const unit = Math.round(Number(p?.outPriceExVat ?? 0) * 100) / 100;
      const exact = Number.isInteger(qty * 100) && Math.round(unit * qty * 100) === net;
      const name = String(p?.description || item?.nameOnInvoice || item?.type || 'Item').trim();
      lines.push({
        itemName: (exact ? name : `${name} (${qty})`).slice(0, 200),
        quantity: exact ? qty : 1,
        unitPrice: exact ? unit : net / 100,
        vatPercent: Number(p?.vatPercentage ?? 0),
        netMinor: net,
        vatMinor: vat,
      });
    }
  }
  const lineNet = lines.reduce((s, l) => s + l.netMinor, 0);
  const lineVat = lines.reduce((s, l) => s + l.vatMinor, 0);
  if (!problem && lines.length === 0) problem = 'No items to invoice';
  if (!problem && (Math.abs(lineNet - summary.netMinor) > 1 || Math.abs(lineVat - summary.vatMinor) > lines.length)) problem = 'Items do not add up to the invoice total';
  if (!problem && !/^[A-Z]{3}$/.test(summary.currency)) problem = 'Invoice has no currency';
  const country = String(inv?.country ?? '').trim().toLowerCase();
  const countryCode = country ? COUNTRIES[country] ?? '' : String(inv?.officeCountryCode ?? 'NO').toUpperCase();
  if (!problem && !/^[A-Z]{2}$/.test(countryCode)) problem = `Create the customer (country ${String(inv?.country)}) in ReAI first`;
  return {
    ...summary,
    problem,
    officeId: String(inv?.officeId ?? ''),
    invoiceDate: day(inv?.invoiceDate),
    dueDate: day(inv?.dueDate),
    ourReference: String(inv?.ourReference ?? '').trim(),
    invoiceReference: String(inv?.invoiceReference ?? '').trim(),
    customerData: {
      name: String(inv?.name ?? summary.customer).trim(),
      orgnr: extractNorwegianOrg(String(inv?.organisationNumber ?? '')),
      email: String(inv?.emailAddress ?? '').trim(),
      address: String(inv?.address ?? '').trim(),
      address2: String(inv?.address2 ?? '').trim(),
      zip: String(inv?.zipCode ?? '').trim(),
      city: String(inv?.city ?? '').trim(),
      countryCode,
    },
    lines,
  };
}

/**
 * Marks an invoice as processed. Docs: Invoicing v1, PUT /Invoice/SetAsProcessed ({ invoiceId, externalReference }).
 * @param {string} key
 * @param {number} id
 * @param {string} externalReference
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 */
async function setProcessed(key, id, externalReference, fetchImpl = fetch) {
  const res = await fetchImpl(`${API}/Invoice/SetAsProcessed`, {
    method: 'PUT',
    headers: { ...headers(key), 'content-type': 'application/json' },
    body: JSON.stringify({ invoiceId: id, externalReference }),
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  return res.ok;
}

/** @param {VatCode[]} codes @param {number} ratePct */
function lineVatCode(codes, ratePct) {
  const usable = codes.filter((c) => !c.reverseCharge && Math.abs(c.rate - ratePct) < 0.001);
  const match = ratePct > 0 ? usable.find((c) => c.vatType === 'output_vat') : usable.find((c) => c.vatType === 'exempt') ?? usable.find((c) => c.vatType === 'outside_scope') ?? usable.find((c) => c.vatType === 'output_vat');
  if (!match) throw new HttpError(400, `ReAI has no invoice VAT code for ${ratePct}% in this company.`);
  return match.code;
}

/**
 * Finds the ReAI customer by organization number, then email, then exact name, or creates it.
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {{ token: string, tenantId: number }} auth
 * @param {InvoiceCustomer} c
 */
async function ensureCustomer(env, auth, c) {
  /** @param {Record<string, string>} query */
  const find = async (query) => /** @type {{ items: Array<{ id: number | null, name?: string | null }> }} */ (await reaiRequest(env, '/api/customers', { ...auth, query: { ...query, pageSize: '20' } })).items;
  const byOrg = c.orgnr ? (await find({ organizationNumber: c.orgnr }))[0] : undefined;
  if (byOrg?.id) return { id: byOrg.id, created: false };
  const byEmail = c.email ? (await find({ email: c.email }))[0] : undefined;
  if (byEmail?.id) return { id: byEmail.id, created: false };
  if (!c.orgnr && !c.email) {
    const byName = (await find({ name: c.name })).find((x) => String(x.name ?? '').trim().toLowerCase() === c.name.toLowerCase());
    if (byName?.id) return { id: byName.id, created: false };
  }
  const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/customers', {
    ...auth,
    method: 'POST',
    body: {
      name: c.name.slice(0, 200),
      privateContact: !c.orgnr,
      ...(c.orgnr ? { organizationNumber: c.orgnr } : {}),
      ...(c.email ? { email: c.email } : {}),
      ...(c.address ? { addressPart1: c.address } : {}),
      ...(c.address2 ? { addressPart2: c.address2 } : {}),
      ...(c.zip ? { postalCode: c.zip } : {}),
      ...(c.city ? { city: c.city } : {}),
      countryCode: c.countryCode,
    },
  }));
  return { id: created.id, created: true };
}

/** @param {{ invoices: InvoiceSummary[], apiKey: string, isSample: boolean }} state */
function renderPreview(state) {
  const ready = state.invoices.filter((i) => !i.problem);
  return reaiCard({
    eyebrow: 'QONDOR INVOICING → REAI',
    title: `${state.invoices.length} unprocessed in Qondor`,
    badge: state.isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${ready.length} ready`, tone: ready.length ? 'success' : 'warn' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Invoice specifications', value: String(ready.filter((i) => !i.isInvoice).length), detail: 'Become ReAI orders to invoice' })}
        ${reaiMetric({ label: 'Qondor invoices', value: String(ready.filter((i) => i.isInvoice).length), detail: 'Imported with the Qondor number' })}
        ${reaiMetric({ label: 'Left in Qondor', value: String(state.invoices.length - ready.length), detail: 'Credit notes and card payments' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Project</th><th>Customer</th><th>Type</th><th class="num">Excl. VAT</th><th class="num">VAT</th><th>Action</th></tr></thead>
        <tbody>${state.invoices.map((i) => html`<tr id="${SLUG}-row-${i.id}">
          <td class="mono">${i.issued}</td><td>${i.project}</td><td>${i.customer}</td>
          <td>${i.isInvoice ? `Invoice ${i.invoiceNumber}` : 'Specification'}<div class="muted-note">${i.typeText}</div></td>
          <td class="num">${formatMinor(i.netMinor)} ${i.currency}</td><td class="num">${formatMinor(i.vatMinor)}</td>
          <td>${i.problem
            ? reaiBadge({ text: i.problem, tone: 'warn' })
            : state.isSample
              ? html`<span class="muted-note">Demo only</span>`
              : html`<form hx-post="${BASE_PATH}/import" hx-target="#${SLUG}-row-${i.id}" hx-swap="outerHTML">
                  <input type="hidden" name="invoiceId" value="${i.id}"><input type="hidden" name="apiKey" value="${state.apiKey}">
                  <button type="submit" class="button primary">${i.isInvoice ? 'Import invoice' : 'Stage order'}</button>
                </form>`}</td>
        </tr>`)}</tbody>
      </table></div>
      <p class="muted-note">An invoice specification becomes a ReAI order with one line per Qondor price, ready to invoice from ReAI. An invoice Qondor has already numbered is imported into ReAI with its Qondor number and booked. Either way it is then marked as processed in Qondor with the ReAI number. Referral items are left out, as in Qondor.</p>
      ${state.isSample ? reaiCallout({ tone: 'info', body: 'Sample Qondor invoices loaded. Connect to ReAI and fetch with your subscription key above.' }) : ''}
    `,
  });
}

/**
 * Handles /app/qondor/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE_PATH && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE_PATH}/`, request.url), 301);
  if (pathname === `${BASE_PATH}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">EVENTS & MEETINGS</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${SLUG}-web`, clientName: `ReAI ${BRAND} (Web)` })}
        ${reaiCard({
          eyebrow: 'LIVE QONDOR INVOICING API',
          title: 'Fetch unprocessed invoices',
          body: html`<p class="muted-note">Qondor support grants API access for the Production environment. Sign in to the Qondor API portal and copy the primary key from your profile. The key is used only for these requests and is never stored.</p>
            <form class="stack" hx-post="${BASE_PATH}/fetch-api" hx-target="#${SLUG}-output" hx-swap="innerHTML">
              <div class="mapping-grid"><div class="field"><label for="qd-key">Qondor subscription key</label><input id="qd-key" name="apiKey" type="password" autocomplete="off" required></div></div>
              <div class="inline-row">
                <button type="submit" class="button primary">Fetch from Qondor</button>
                <button type="button" class="button secondary" hx-post="${BASE_PATH}/sample" hx-target="#${SLUG}-output" hx-swap="innerHTML">Load sample preview</button>
              </div>
            </form>`,
        })}
        <div id="${SLUG}-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderPreview({ invoices: SAMPLE, apiKey: '', isSample: true }));
  try {
    const form = await request.formData();
    const apiKey = String(form.get('apiKey') ?? '').trim();
    if (pathname === `${BASE_PATH}/fetch-api`) {
      const invoices = await fetchApi({ apiKey });
      if (invoices.length === 0) throw new HttpError(400, 'Qondor has no unprocessed invoices.');
      return htmlResponse(renderPreview({ invoices, apiKey, isSample: false }));
    }
    if (pathname === `${BASE_PATH}/import`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const id = Number(form.get('invoiceId') ?? '0');
      if (!Number.isInteger(id) || id <= 0 || !apiKey) throw new HttpError(400, 'Fetch the invoices from Qondor again.');
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const externalReference = `qondor-invoice-${id}`;
      const inv = await fetchInvoice(apiKey, id);
      const existing = /** @type {{ items: Array<{ id: number | null, number: string, invoiceId?: number | null, invoiceNumber?: string | null }> }} */ (await reaiRequest(env, '/api/orders', { ...auth, query: { externalReference, status: 'all', pageSize: '1' } }));
      const dup = existing.items[0];
      if (dup?.id && (!inv.isInvoice || dup.invoiceId)) {
        const marked = await setProcessed(apiKey, id, String(dup.invoiceNumber ?? dup.number));
        return htmlResponse(html`<tr><td colspan="7">${reaiBadge({ text: `Already in ReAI as ${dup.invoiceNumber ? `invoice ${dup.invoiceNumber}` : `order ${dup.number}`}`, tone: 'warn' })}${marked ? ' · marked as processed in Qondor' : ''}</td></tr>`);
      }
      if (inv.problem) throw new HttpError(400, `Qondor ${inv.id}: ${inv.problem}.`);
      const [codes, settings] = await Promise.all([
        /** @type {Promise<VatCode[]>} */ (reaiRequest(env, '/api/vat-codes', { ...auth, query: { usage: 'customer_invoice' } })),
        /** @type {Promise<{ daysUntilDue: number }>} */ (reaiRequest(env, '/api/invoice-settings', auth)),
      ]);
      const issueDate = inv.invoiceDate || inv.issued || new Date().toISOString().slice(0, 10);
      const dueDays = inv.dueDate && issueDate ? Math.max(0, Math.round((Date.parse(inv.dueDate) - Date.parse(issueDate)) / 86_400_000)) : Number(settings?.daysUntilDue ?? 14) || 14;
      /** @type {{ id: number, number: string }} */
      let order;
      let createdCustomer = false;
      if (dup?.id) {
        order = { id: dup.id, number: dup.number };
      } else {
        const orderLines = inv.lines.map((l) => ({ itemName: l.itemName, quantity: l.quantity, unitPrice: l.unitPrice, vatCode: lineVatCode(codes, l.vatPercent) }));
        const customer = await ensureCustomer(env, auth, inv.customerData);
        createdCustomer = customer.created;
        order = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/orders', {
          ...auth,
          method: 'POST',
          body: {
            customerId: customer.id,
            currencyCode: inv.currency,
            daysUntilDue: dueDays,
            issueDate,
            externalReference,
            ...(inv.invoiceReference ? { buyerReference: inv.invoiceReference.slice(0, 200) } : {}),
            comment: `${inv.project}${inv.ourReference ? ` · ${inv.ourReference}` : ''}`.slice(0, 500),
            orderLines,
          },
        }));
      }
      let reaiNumber = order.number;
      /** @type {import('../../lib/html.js').SafeHtml} */
      let link = html`<a href="${reaiOrigin(env)}/order/${order.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Order ${order.number} ↗</a>`;
      if (inv.isInvoice) {
        const invoice = /** @type {{ id: number, number: string, webUrl?: string }} */ (await reaiRequest(env, '/api/invoices/import', {
          ...auth,
          method: 'POST',
          body: {
            source: 'qondor',
            sourceInstance: inv.officeId || 'qondor',
            externalId: String(inv.id),
            number: inv.invoiceNumber,
            issueDate,
            dueDate: new Date(Date.parse(issueDate) + dueDays * 86_400_000).toISOString().slice(0, 10),
            accounting: 'book',
            orderId: order.id,
          },
        }));
        reaiNumber = invoice.number;
        link = html`<a href="${invoice.webUrl ?? `${reaiOrigin(env)}/invoice/${invoice.id}?tenantId=${session.tenantId}`}" target="_blank" rel="noopener">Invoice ${invoice.number} ↗</a>`;
      }
      const marked = await setProcessed(apiKey, id, reaiNumber);
      return htmlResponse(html`<tr><td colspan="7">${reaiBadge({ text: inv.isInvoice ? `Imported ${inv.invoiceNumber}` : `Staged ${inv.id}`, tone: 'success' })} ${link}${createdCustomer ? ' · new customer' : ''}${marked ? ' · marked as processed in Qondor' : html` ${reaiBadge({ text: 'Set it as processed in Qondor yourself', tone: 'warn' })}`}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
