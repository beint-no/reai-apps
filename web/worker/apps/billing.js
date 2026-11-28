// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/**
 * @typedef {'fazile' | 'timma'} BillingSlug
 * @typedef {{ leaseId: string, tenantName: string, email: string, startDate: string, monthlyRent: number, unit: string }} FazileLease
 * @typedef {{ date: string, description: string, exemptMinor: number, vat25Minor: number, feeMinor: number }} BookingRow
 * @typedef {{ id: number, name: string, email?: string | null, invoiceEmail?: string | null, archived?: boolean }} ReAICustomer
 * @typedef {{ id: number, title: string, vatCode?: string | null, archived?: boolean }} ReAIProduct
 */

const SAMPLE_FAZILE_CSV = [
  'LeaseID;Tenant;Email;Unit;StartDate;MonthlyRent',
  'FAZ-101;Nordic Studio AS;faktura@nordicstudio.no;Storgata 12, 3. etg;2026-11-01;24500,00',
  'FAZ-102;Fjord Konsult AS;post@fjordkonsult.no;Storgata 12, 4. etg;2026-11-01;18900,00',
].join('\n');

const SAMPLE_TIMMA_CSV = [
  'Date;Description;ExemptSales;TaxableSales25;PaymentFee',
  '2026-10-31;Timma / Klinikksalg oktober (helsetjenester + produkter);42500,00;18750,00;915,00',
].join('\n');

/** @param {string} raw */
function parseMoney(raw) {
  const n = Number(raw.replace(/[\s\u00A0]/g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * @param {string} csvText
 * @returns {FazileLease[]}
 */
function parseFazileCsv(csvText) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const idIdx = norm.findIndex((h) => h.includes('lease') || h.includes('kontrakt') || h.includes('id'));
  const nameIdx = norm.findIndex((h) => h.includes('tenant') || h.includes('leietaker') || h.includes('kunde') || h.includes('name'));
  const emailIdx = norm.findIndex((h) => h.includes('email') || h.includes('epost'));
  const unitIdx = norm.findIndex((h) => h.includes('unit') || h.includes('objekt') || h.includes('lokale'));
  const startIdx = norm.findIndex((h) => h.includes('start') || h.includes('dato') || h.includes('date'));
  const rentIdx = norm.findIndex((h) => h.includes('rent') || h.includes('leie') || h.includes('belop') || h.includes('amount'));
  if (nameIdx < 0 || rentIdx < 0) {
    throw new HttpError(400, 'CSV must include Tenant/Leietaker and MonthlyRent/Leie columns.');
  }
  return doc.rows
    .map((r, i) => ({
      leaseId: idIdx >= 0 ? (r[idIdx] ?? `LEASE-${i + 1}`).trim() : `LEASE-${i + 1}`,
      tenantName: (r[nameIdx] ?? '').trim(),
      email: emailIdx >= 0 ? (r[emailIdx] ?? '').trim() : '',
      unit: unitIdx >= 0 ? (r[unitIdx] ?? 'Commercial lease').trim() : 'Commercial lease',
      startDate: startIdx >= 0 && /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test((r[startIdx] ?? '').trim()) ? (r[startIdx] ?? '').trim().slice(0, 10) : new Date().toISOString().slice(0, 10),
      monthlyRent: parseMoney(r[rentIdx] ?? '0'),
    }))
    .filter((l) => l.tenantName && l.monthlyRent > 0);
}

/**
 * @param {string} csvText
 * @returns {BookingRow[]}
 */
function parseBookingCsv(csvText) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const dateIdx = norm.findIndex((h) => h.includes('date') || h.includes('dato'));
  const descIdx = norm.findIndex((h) => h.includes('desc') || h.includes('beskrivelse') || h.includes('periode'));
  const exIdx = norm.findIndex((h) => h.includes('exempt') || h.includes('fritatt') || h.includes('helse'));
  const vatIdx = norm.findIndex((h) => h.includes('taxable') || h.includes('mva') || h.includes('25'));
  const feeIdx = norm.findIndex((h) => h.includes('fee') || h.includes('gebyr'));
  if (dateIdx < 0 || (exIdx < 0 && vatIdx < 0)) {
    throw new HttpError(400, 'CSV must contain Date/Dato and at least one sales column (ExemptSales / TaxableSales25).');
  }
  return doc.rows
    .map((r) => ({
      date: (r[dateIdx] ?? '').trim().slice(0, 10),
      description: descIdx >= 0 ? (r[descIdx] ?? 'Booking settlement').trim() : 'Booking settlement',
      exemptMinor: exIdx >= 0 ? Math.round(parseMoney(r[exIdx] ?? '0') * 100) : 0,
      vat25Minor: vatIdx >= 0 ? Math.round(parseMoney(r[vatIdx] ?? '0') * 100) : 0,
      feeMinor: feeIdx >= 0 ? Math.round(parseMoney(r[feeIdx] ?? '0') * 100) : 0,
    }))
    .filter((b) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(b.date) && (b.exemptMinor > 0 || b.vat25Minor > 0));
}

/**
 * @param {{ leases: Array<{ lease: FazileLease, customerId: number | null }>, vatCode: string, isSample?: boolean }} state
 */
function renderFazilePreview(state) {
  const matched = state.leases.filter((l) => l.customerId !== null).length;
  return html`
    ${reaiCard({
      eyebrow: 'FAZILE → REAI SUBSCRIPTIONS',
      title: `${state.leases.length} commercial leases scanned`,
      badge: state.isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${matched} matched`, tone: matched > 0 ? 'success' : 'warn' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Leases', value: String(state.leases.length), detail: 'Staged with auto-billing off' })}
          ${reaiMetric({ label: 'Matched tenants', value: `${matched} / ${state.leases.length}`, detail: 'By email or exact name' })}
          ${reaiMetric({ label: 'VAT code', value: state.vatCode, detail: 'Applied to staged lease lines' })}
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Lease</th>
                <th>Tenant</th>
                <th>Unit</th>
                <th>Start</th>
                <th class="num">Monthly rent</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${state.leases.map(
                ({ lease, customerId }, idx) => html`<tr id="fz-row-${idx}">
                  <td class="mono">${lease.leaseId}</td>
                  <td><strong>${lease.tenantName}</strong></td>
                  <td>${lease.unit}</td>
                  <td class="mono">${lease.startDate}</td>
                  <td class="num">${formatMinor(Math.round(lease.monthlyRent * 100))} NOK</td>
                  <td>
                    ${state.isSample || !customerId
                      ? html`<span class="muted-note">${state.isSample ? 'Demo only' : 'No matching ReAI customer'}</span>`
                      : html`<form hx-post="/app/fazile/stage" hx-target="#fz-row-${idx}" hx-swap="outerHTML">
                          <input type="hidden" name="leaseId" value="${lease.leaseId}">
                          <input type="hidden" name="unit" value="${lease.unit}">
                          <input type="hidden" name="startDate" value="${lease.startDate}">
                          <input type="hidden" name="monthlyRent" value="${lease.monthlyRent.toFixed(2)}">
                          <input type="hidden" name="customerId" value="${customerId}">
                          <input type="hidden" name="vatCode" value="${state.vatCode}">
                          <button type="submit" class="button primary">Stage subscription</button>
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
 * @param {{ rows: BookingRow[], isSample?: boolean }} state
 */
function renderTimmaPreview(state) {
  const exemptTotal = state.rows.reduce((s, r) => s + r.exemptMinor, 0);
  const vat25Gross = state.rows.reduce((s, r) => s + r.vat25Minor, 0);
  const vat25Net = Math.round((vat25Gross * 100) / 125);
  const vatMinor = vat25Gross - vat25Net;
  const feeTotal = state.rows.reduce((s, r) => s + r.feeMinor, 0);
  const grossTotal = exemptTotal + vat25Gross;
  const netPayout = grossTotal - feeTotal;
  const lastDate = state.rows.map((r) => r.date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);

  return html`
    ${reaiCard({
      eyebrow: 'BOOKING & CLINIC SETTLEMENT VOUCHER',
      title: `Period ending ${lastDate}`,
      badge: state.isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Net bank / clearing (1580)', value: `${formatMinor(netPayout)} NOK`, detail: 'After payment fees' })}
          ${reaiMetric({ label: 'Exempt services (3100)', value: `${formatMinor(exemptTotal)} NOK`, detail: 'Healthcare / VAT-exempt' })}
          ${reaiMetric({ label: '25% sales + VAT', value: `${formatMinor(vat25Gross)} NOK`, detail: `Net ${formatMinor(vat25Net)} + VAT ${formatMinor(vatMinor)}` })}
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr><th>Account</th><th>Posting</th><th class="num">Debit</th><th class="num">Credit</th></tr>
            </thead>
            <tbody>
              <tr><td class="mono">1580</td><td>Booking / payment terminal clearing (net)</td><td class="num">${formatMinor(netPayout)}</td><td class="num"></td></tr>
              ${feeTotal > 0 ? html`<tr><td class="mono">7770</td><td>Booking & card processing fees</td><td class="num">${formatMinor(feeTotal)}</td><td class="num"></td></tr>` : ''}
              ${exemptTotal > 0 ? html`<tr><td class="mono">3100</td><td>VAT-exempt healthcare / clinic revenue</td><td class="num"></td><td class="num">${formatMinor(exemptTotal)}</td></tr>` : ''}
              ${vat25Net > 0 ? html`<tr><td class="mono">3000</td><td>Taxable salon / product sales (25% net)</td><td class="num"></td><td class="num">${formatMinor(vat25Net)}</td></tr>` : ''}
              ${vatMinor > 0 ? html`<tr><td class="mono">2700</td><td>Output VAT 25% payable</td><td class="num"></td><td class="num">${formatMinor(vatMinor)}</td></tr>` : ''}
            </tbody>
          </table>
        </div>
        ${!state.isSample
          ? html`<form class="stack-sm confirm-box" hx-post="/app/timma/book" hx-target="#tm-booking" hx-swap="innerHTML">
              <input type="hidden" name="rowsJson" value="${JSON.stringify(state.rows)}">
              <label class="check-row"><input type="checkbox" name="c_booking" required> I verified these figures against my Timma / Fresha / clinic settlement report.</label>
              <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
            </form>
            <div id="tm-booking" class="stack-sm"></div>`
          : reaiCallout({ tone: 'info', body: 'Upload your real Timma, Fresha, Fixit or clinic CSV report above and connect to ReAI to post the review voucher.' })}
      `,
    })}
  `;
}

/**
 * Handles /app/fazile/* and /app/timma/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @param {BillingSlug} slug
 * @returns {Promise<Response>}
 */
export async function handleBilling(request, env, slug) {
  const { pathname } = new URL(request.url);
  const basePath = `/app/${slug}`;
  const isFazile = slug === 'fazile';
  const title = isFazile ? 'Fazile Property Billing' : 'Booking & Clinic Settlement (Timma / Fresha / Aspit)';
  const lead = isFazile
    ? 'Stage commercial property leases exported from Fazile as recurring ReAI billing subscriptions with automatic billing kept safely off until reviewed.'
    : 'Book salon, wellness and healthcare clinic settlements (Timma, Fresha, Fixit, Physica, Aspit) with clean separation of VAT-exempt healthcare (3100), 25% retail sales (3000) and fees (7770).';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  }

  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro">
        <p class="eyebrow">${isFazile ? 'REAL ESTATE & LEASES' : 'BOOKING, SALON & CLINIC'}</p>
        <h1>${title}</h1>
        <p class="lead">${lead}</p>
      </section>

      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${slug}-web`, clientName: `ReAI ${title} (Web)` })}

        ${reaiCard({
          eyebrow: 'UPLOAD SETTLEMENT OR LEASE CSV',
          title: isFazile ? 'Upload Fazile lease schedule CSV' : 'Upload booking / clinic settlement CSV',
          body: html`
            <form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#bill-output" hx-swap="innerHTML">
              ${isFazile
                ? html`<div class="inline-row"><div class="field"><label for="fz-vat">ReAI VAT code for leases</label><select id="fz-vat" name="vatCode"><option value="6">6 — VAT-exempt property rent (0%)</option><option value="3">3 — Voluntary VAT-registered lease (25%)</option></select></div></div>`
                : ''}
              ${reaiDropzone({
                inputId: 'bill-csv',
                name: 'file',
                accept: '.csv,text/csv,text/plain',
                label: isFazile ? 'Choose Fazile CSV' : 'Choose Booking / Clinic CSV',
                hint: isFazile
                  ? 'CSV with LeaseID, Tenant, Email, Unit, StartDate, MonthlyRent columns.'
                  : 'CSV with Date, Description, ExemptSales, TaxableSales25, PaymentFee columns.',
              })}
              <div class="inline-row">
                <button type="submit" class="button primary">Preview</button>
                <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#bill-output" hx-swap="innerHTML">Load sample CSV</button>
              </div>
            </form>
          `,
        })}

        <div id="bill-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') {
    return errorResponse('Method not allowed.', 405);
  }
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  if (pathname === `${basePath}/sample`) {
    if (isFazile) {
      const leases = parseFazileCsv(SAMPLE_FAZILE_CSV);
      return htmlResponse(renderFazilePreview({ leases: leases.map((lease, i) => ({ lease, customerId: i === 0 ? 12 : null })), vatCode: '6', isSample: true }));
    }
    return htmlResponse(renderTimmaPreview({ rows: parseBookingCsv(SAMPLE_TIMMA_CSV), isSample: true }));
  }

  try {
    const form = await request.formData();

    if (pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) {
        throw new HttpError(400, 'Choose a CSV file or load the sample.');
      }
      const csvText = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
      if (isFazile) {
        const session = await readSession(env, request);
        /** @type {ReAICustomer[]} */
        let customers = [];
        if (session && session.tenantId > 0) {
          customers = /** @type {ReAICustomer[]} */ (await reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId }));
        }
        const leases = parseFazileCsv(csvText);
        const vatCode = String(form.get('vatCode') ?? '6').trim();
        return htmlResponse(
          renderFazilePreview({
            vatCode,
            leases: leases.map((lease) => {
              const email = lease.email.toLowerCase();
              const match = customers.find(
                (c) =>
                  (email && ((c.email ?? '').toLowerCase() === email || (c.invoiceEmail ?? '').toLowerCase() === email)) ||
                  c.name.trim().toLowerCase() === lease.tenantName.trim().toLowerCase(),
              );
              return { lease, customerId: match?.id ?? null };
            }),
          }),
        );
      }
      return htmlResponse(renderTimmaPreview({ rows: parseBookingCsv(csvText) }));
    }

    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) {
      throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    }

    if (isFazile && pathname === '/app/fazile/stage') {
      const leaseId = String(form.get('leaseId') ?? '').trim();
      const unit = String(form.get('unit') ?? 'Property lease').trim();
      const startDate = String(form.get('startDate') ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
      const monthlyRent = Number(form.get('monthlyRent') ?? '0');
      const customerId = Number(form.get('customerId') ?? '0');
      const vatCode = String(form.get('vatCode') ?? '6').trim();
      if (!leaseId || monthlyRent <= 0 || customerId <= 0) {
        throw new HttpError(400, 'Lease ID, rent and customer are required.');
      }
      const created = /** @type {{ id?: number }} */ (
        await reaiRequest(env, '/api/subscriptions', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: {
            customerId,
            startDate,
            intervalMonths: 1,
            billingTiming: 'in_advance',
            periodAlignment: 'start_date',
            outputMode: 'create_order',
            automaticBillingGeneration: false,
            currencyCode: 'NOK',
            billingLeadDays: 0,
            daysUntilDue: 14,
            sendEhf: false,
            internalComment: `Fazile lease ${leaseId} (${unit}). Staged from apps.reai.no with auto-billing off.`,
            subscriptionLines: [{ rowNumber: 1, itemName: `Rent ${unit} (${leaseId})`, quantity: 1, unitPrice: Number(monthlyRent.toFixed(2)), vatCode }],
          },
        })
      );
      return htmlResponse(html`<tr>
        <td class="mono">${leaseId}</td>
        <td>Customer #${customerId}</td>
        <td>${unit}</td>
        <td class="mono">${startDate}</td>
        <td class="num">${formatMinor(Math.round(monthlyRent * 100))} NOK</td>
        <td>${reaiBadge({ text: `Staged #${created.id ?? 'ok'}`, tone: 'success' })}</td>
      </tr>`);
    }

    if (!isFazile && pathname === '/app/timma/book') {
      if (form.get('c_booking') !== 'on') {
        throw new HttpError(400, 'Confirm the verification checkbox first.');
      }
      const rows = /** @type {BookingRow[]} */ (JSON.parse(String(form.get('rowsJson') ?? '[]')));
      if (!rows.length) {
        throw new HttpError(400, 'No booking rows to post.');
      }
      const exemptTotal = rows.reduce((s, r) => s + r.exemptMinor, 0);
      const vat25Gross = rows.reduce((s, r) => s + r.vat25Minor, 0);
      const vat25Net = Math.round((vat25Gross * 100) / 125);
      const vatMinor = vat25Gross - vat25Net;
      const feeTotal = rows.reduce((s, r) => s + r.feeMinor, 0);
      const netPayout = exemptTotal + vat25Gross - feeTotal;
      const lastDate = rows.map((r) => r.date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);

      /** @type {Array<Record<string, unknown>>} */
      const postings = [];
      let idx = 0;
      const push = (/** @type {string} */ acct, /** @type {number} */ minor, /** @type {string} */ desc) => {
        if (minor === 0) {
          return;
        }
        postings.push({
          accountNumber: acct,
          postingDate: lastDate,
          currencyCode: 'NOK',
          amount: Number((minor / 100).toFixed(2)),
          vatCode: '0',
          rowNumber: idx++,
          description: desc,
        });
      };
      push('1580', netPayout, 'Booking / clinic settlement clearing');
      push('7770', feeTotal, 'Booking & payment processing fees');
      push('3100', -exemptTotal, 'VAT-exempt healthcare / clinic revenue');
      push('3000', -vat25Net, 'Taxable salon / product sales (25% net)');
      push('2700', -vatMinor, 'Output VAT 25%');

      const created = /** @type {{ id: number, number: string }} */ (
        await reaiRequest(env, '/api/manual-vouchers', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: {
            date: lastDate,
            description: `Booking & clinic settlement ${lastDate}`,
            reviewReason: 'Imported from Timma/Fresha/clinic settlement report via apps.reai.no. Attach source report before clearing review.',
            postings,
          },
        })
      );
      const url = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI to attach your settlement PDF: <a href="${url}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Operation failed.';
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Sync error', body: msg }));
  }

  return errorResponse('Unknown billing route.', 404);
}
