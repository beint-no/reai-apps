// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/**
 * @typedef {'airbnb' | 'husleie' | 'fenistra'} PropSlug
 * @typedef {{ date: string, ref: string, stay12Minor: number, exemptLongMinor: number, hostFeeMinor: number }} AirbnbSummary
 * @typedef {{ leaseId: string, tenantName: string, unit: string, startDate: string, monthlyRent: number }} LeaseRow
 */

const SAMPLE_HUSLEIE = 'Kontrakt;Leietaker;Bolig;Startdato;Husleie\nHUS-201;Kari Nordmann;Markveien 14, H0201;2026-11-01;16500,00\nHUS-202;Ola Hansen;Markveien 14, H0302;2026-11-01;18200,00';
const SAMPLE_FENISTRA = 'Kontrakt;Leietaker;Objekt;Startdato;Leie\nFEN-901;Nordic Konsult AS;Aker Brygge Kontor 4.etg (inkl. felleskost);2026-11-01;48500,00\nFEN-902;Fjord Tech AS;Aker Brygge Kontor 5.etg;2026-11-01;62000,00';

/** @param {string} raw */
function num(raw) {
  const n = Number(raw.replace(/[\s\u00A0]/g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** @param {string} csvText @returns {LeaseRow[]} */
function parseLeaseCsv(csvText) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const idIdx = norm.findIndex((h) => h.includes('kontrakt') || h.includes('lease') || h.includes('id'));
  const tIdx = norm.findIndex((h) => h.includes('leietaker') || h.includes('tenant') || h.includes('kunde'));
  const uIdx = norm.findIndex((h) => h.includes('bolig') || h.includes('objekt') || h.includes('unit'));
  const sIdx = norm.findIndex((h) => h.includes('start') || h.includes('dato'));
  const rIdx = norm.findIndex((h) => h.includes('leie') || h.includes('rent') || h.includes('belop'));
  if (tIdx < 0 || rIdx < 0) throw new HttpError(400, 'CSV must include Leietaker/Tenant and Husleie/Leie columns.');
  return doc.rows
    .map((r, i) => ({
      leaseId: idIdx >= 0 ? (r[idIdx] ?? `L-${i + 1}`).trim() : `L-${i + 1}`,
      tenantName: (r[tIdx] ?? '').trim(),
      unit: uIdx >= 0 ? (r[uIdx] ?? 'Lease').trim() : 'Lease',
      startDate: sIdx >= 0 && /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test((r[sIdx] ?? '').trim()) ? (r[sIdx] ?? '').trim().slice(0, 10) : new Date().toISOString().slice(0, 10),
      monthlyRent: num(r[rIdx] ?? '0'),
    }))
    .filter((x) => x.tenantName && x.monthlyRent > 0);
}

/**
 * Handles /app/{airbnb,husleie,fenistra}/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @param {PropSlug} slug
 * @returns {Promise<Response>}
 */
export async function handleProperty(request, env, slug) {
  const { pathname } = new URL(request.url);
  const basePath = `/app/${slug}`;
  const isAirbnb = slug === 'airbnb';
  const brand = isAirbnb ? 'Airbnb & Booking.com' : slug === 'husleie' ? 'Husleie.no' : 'Fenistra & Propely';
  const title = isAirbnb
    ? 'Airbnb & Booking.com Host Accounting'
    : slug === 'husleie'
      ? 'Husleie.no Residential Lease Billing'
      : 'Fenistra / Propely Commercial Property Billing';
  const lead = isAirbnb
    ? 'Book Airbnb and Booking.com payout statements into ReAI separating 12% short-term accommodation VAT (3020), VAT-exempt long-term stays (3100), host service fees (7770) and net payout (1580).'
    : `Stage ${brand} rental & common-cost (felleskostnader) schedules as recurring ReAI subscriptions with automatic billing kept off until reviewed.`;

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  }
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro"><p class="eyebrow">REAL ESTATE & SHORT-TERM RENTALS</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${slug}-web`, clientName: `ReAI ${brand} (Web)` })}
        ${isAirbnb
          ? reaiCard({
              eyebrow: 'AIRBNB / BOOKING.COM PAYOUT',
              title: 'Enter payout statement totals (NOK)',
              body: html`<form class="stack" hx-post="/app/airbnb/preview" hx-target="#pr-output" hx-swap="innerHTML">
                <div class="mapping-grid">
                  <div class="field"><label for="ab-d">Payout date</label><input id="ab-d" name="date" type="date" value="${today}" required></div>
                  <div class="field"><label for="ab-r">Payout code</label><input id="ab-r" name="ref" type="text" placeholder="AIR-2026-10" required></div>
                  <div class="field"><label for="ab-12">Gross 12% short-term stay (3020)</label><input id="ab-12" name="stay12" type="number" step="0.01" min="0" value="0"></div>
                  <div class="field"><label for="ab-0">VAT-exempt rental 0% (3100)</label><input id="ab-0" name="exempt" type="number" step="0.01" min="0" value="0"></div>
                  <div class="field"><label for="ab-f">Host / OTA commission fee (7770)</label><input id="ab-f" name="fee" type="number" step="0.01" min="0" value="0"></div>
                </div>
                <div class="inline-row">
                  <button type="submit" class="button primary">Preview balanced voucher</button>
                  <button type="button" class="button secondary" hx-post="/app/airbnb/sample" hx-target="#pr-output" hx-swap="innerHTML">Load sample payout</button>
                </div>
              </form>`,
            })
          : reaiCard({
              eyebrow: `${brand.toUpperCase()} LEASE SCHEDULE`,
              title: `Upload ${brand} lease CSV`,
              body: html`<form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#pr-output" hx-swap="innerHTML">
                <div class="inline-row"><div class="field"><label for="pr-vat">VAT code</label><select id="pr-vat" name="vatCode"><option value="6">6 — Residential / exempt rent (0%)</option><option value="3">3 — Voluntary VAT commercial lease (25%)</option></select></div></div>
                ${reaiDropzone({ inputId: 'pr-csv', name: 'file', accept: '.csv,text/csv,text/plain', label: `Choose ${brand} CSV`, hint: 'CSV with Kontrakt, Leietaker, Bolig/Objekt, Startdato, Husleie/Leie.' })}
                <div class="inline-row">
                  <button type="submit" class="button primary">Preview leases</button>
                  <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#pr-output" hx-swap="innerHTML">Load sample leases</button>
                </div>
              </form>`,
            })}
        <div id="pr-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  /** @param {AirbnbSummary} s @param {boolean} isSample */
  const renderAirbnb = (s, isSample) => {
    const stayNet = Math.round((s.stay12Minor * 100) / 112);
    const stayVat = s.stay12Minor - stayNet;
    const netPayout = s.stay12Minor + s.exemptLongMinor - s.hostFeeMinor;
    return reaiCard({
      eyebrow: 'AIRBNB / BOOKING.COM VOUCHER',
      title: `${s.ref} · ${s.date}`,
      badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Net payout (1580)', value: `${formatMinor(netPayout)} NOK`, detail: 'After OTA host commission' })}
          ${reaiMetric({ label: '12% short-term stay (3020)', value: `${formatMinor(s.stay12Minor)} NOK`, detail: `Net ${formatMinor(stayNet)} + VAT ${formatMinor(stayVat)}` })}
          ${reaiMetric({ label: 'OTA host fee (7770)', value: `${formatMinor(s.hostFeeMinor)} NOK`, detail: 'Check reverse-charge VAT if foreign OTA' })}
        </div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Account</th><th>Posting</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
          <tbody>
            <tr><td class="mono">1580</td><td>Airbnb / Booking.com net payout clearing</td><td class="num">${formatMinor(netPayout)}</td><td class="num"></td></tr>
            ${s.hostFeeMinor > 0 ? html`<tr><td class="mono">7770</td><td>Host service & OTA commission</td><td class="num">${formatMinor(s.hostFeeMinor)}</td><td class="num"></td></tr>` : ''}
            ${stayNet > 0 ? html`<tr><td class="mono">3020</td><td>Short-term accommodation 12% (net)</td><td class="num"></td><td class="num">${formatMinor(stayNet)}</td></tr>` : ''}
            ${stayVat > 0 ? html`<tr><td class="mono">2700</td><td>Output VAT 12% payable</td><td class="num"></td><td class="num">${formatMinor(stayVat)}</td></tr>` : ''}
            ${s.exemptLongMinor > 0 ? html`<tr><td class="mono">3100</td><td>VAT-exempt residential rental (0%)</td><td class="num"></td><td class="num">${formatMinor(s.exemptLongMinor)}</td></tr>` : ''}
          </tbody>
        </table></div>
        ${!isSample && netPayout > 0
          ? html`<form class="stack-sm confirm-box" hx-post="/app/airbnb/book" hx-target="#ab-booking" hx-swap="innerHTML">
              <input type="hidden" name="abJson" value="${JSON.stringify(s)}">
              <label class="check-row"><input type="checkbox" name="c_ab" required> I verified this payout statement and will attach the Airbnb / Booking.com PDF in ReAI.</label>
              <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
            </form><div id="ab-booking" class="stack-sm"></div>`
          : isSample
            ? reaiCallout({ tone: 'info', body: 'Synthetic payout loaded. Enter your real Airbnb / Booking.com totals above and connect to ReAI to book.' })
            : ''}
      `,
    });
  };

  /** @param {Array<{ l: LeaseRow, customerId: number | null }>} leases @param {string} vatCode @param {boolean} isSample */
  const renderLeases = (leases, vatCode, isSample) =>
    reaiCard({
      eyebrow: `${brand.toUpperCase()} → REAI SUBSCRIPTIONS`,
      title: `${leases.length} lease schedules parsed`,
      badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `VAT code ${vatCode}`, tone: 'success' }),
      body: html`<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Contract</th><th>Tenant</th><th>Property / Unit</th><th>Start</th><th class="num">Monthly rent</th><th>Action</th></tr></thead>
        <tbody>${leases.map(
          ({ l, customerId }, idx) => html`<tr id="pr-l-${idx}">
            <td class="mono">${l.leaseId}</td>
            <td><strong>${l.tenantName}</strong></td>
            <td>${l.unit}</td>
            <td class="mono">${l.startDate}</td>
            <td class="num">${formatMinor(Math.round(l.monthlyRent * 100))} NOK</td>
            <td>${isSample || !customerId
              ? html`<span class="muted-note">${isSample ? 'Demo only' : 'No matching ReAI customer'}</span>`
              : html`<form hx-post="${basePath}/stage" hx-target="#pr-l-${idx}" hx-swap="outerHTML">
                  <input type="hidden" name="leaseId" value="${l.leaseId}">
                  <input type="hidden" name="unit" value="${l.unit}">
                  <input type="hidden" name="startDate" value="${l.startDate}">
                  <input type="hidden" name="monthlyRent" value="${l.monthlyRent.toFixed(2)}">
                  <input type="hidden" name="customerId" value="${customerId}">
                  <input type="hidden" name="vatCode" value="${vatCode}">
                  <button type="submit" class="button primary">Stage subscription</button>
                </form>`}</td>
          </tr>`,
        )}</tbody>
      </table></div>`,
    });

  if (pathname === `${basePath}/sample`) {
    if (isAirbnb) return htmlResponse(renderAirbnb({ date: '2026-10-28', ref: 'AIR-2026-10', stay12Minor: 3360000, exemptLongMinor: 0, hostFeeMinor: 504000 }, true));
    const parsed = parseLeaseCsv(slug === 'husleie' ? SAMPLE_HUSLEIE : SAMPLE_FENISTRA);
    return htmlResponse(renderLeases(parsed.map((l, i) => ({ l, customerId: i === 0 ? 11 : null })), slug === 'husleie' ? '6' : '3', true));
  }

  try {
    const form = await request.formData();
    if (isAirbnb && pathname === '/app/airbnb/preview') {
      /** @param {string} k */
      const m = (k) => Math.round(Math.max(0, Number(form.get(k) ?? '0') || 0) * 100);
      const date = String(form.get('date') ?? '').trim();
      const ref = String(form.get('ref') ?? '').trim().slice(0, 60);
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !ref) throw new HttpError(400, 'Enter valid date and payout ref.');
      return htmlResponse(renderAirbnb({ date, ref, stay12Minor: m('stay12'), exemptLongMinor: m('exempt'), hostFeeMinor: m('fee') }, false));
    }
    if (!isAirbnb && pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a CSV file or load sample.');
      const parsed = parseLeaseCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer())));
      const vatCode = String(form.get('vatCode') ?? '6').trim();
      const session = await readSession(env, request);
      /** @type {Array<{ id: number, name?: string | null }>} */
      let custs = [];
      if (session && session.tenantId > 0) {
        custs = /** @type {Array<{ id: number, name?: string | null }>} */ (await reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId }));
      }
      return htmlResponse(
        renderLeases(
          parsed.map((l) => ({ l, customerId: custs.find((c) => (c.name ?? '').trim().toLowerCase() === l.tenantName.toLowerCase())?.id ?? null })),
          vatCode,
          false,
        ),
      );
    }

    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');

    if (isAirbnb && pathname === '/app/airbnb/book') {
      if (form.get('c_ab') !== 'on') throw new HttpError(400, 'Confirm verification checkbox first.');
      const s = /** @type {AirbnbSummary} */ (JSON.parse(String(form.get('abJson') ?? '{}')));
      const stayNet = Math.round((s.stay12Minor * 100) / 112);
      const stayVat = s.stay12Minor - stayNet;
      const netPayout = s.stay12Minor + s.exemptLongMinor - s.hostFeeMinor;
      /** @type {Array<Record<string, unknown>>} */
      const postings = [];
      let idx = 0;
      const push = (/** @type {string} */ acct, /** @type {number} */ minor, /** @type {string} */ desc) => {
        if (minor === 0) return;
        postings.push({ accountNumber: acct, postingDate: s.date, currencyCode: 'NOK', amount: Number((minor / 100).toFixed(2)), vatCode: '0', rowNumber: idx++, description: desc });
      };
      push('1580', netPayout, 'Airbnb / Booking.com net payout');
      push('7770', s.hostFeeMinor, 'Airbnb / Booking.com host commission');
      push('3020', -stayNet, 'Short-term accommodation 12% net');
      push('2700', -stayVat, 'Output VAT 12%');
      push('3100', -s.exemptLongMinor, 'VAT-exempt rental 0%');

      const created = /** @type {{ id: number, number: string }} */ (
        await reaiRequest(env, '/api/manual-vouchers', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: { date: s.date, description: `Airbnb/Booking ${s.ref} ${s.date}`, reviewReason: 'Imported via apps.reai.no. Attach OTA statement PDF and verify reverse-charge VAT on foreign host fees.', postings },
        })
      );
      const url = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${url}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }

    if (!isAirbnb && pathname === `${basePath}/stage`) {
      const leaseId = String(form.get('leaseId') ?? '').trim();
      const unit = String(form.get('unit') ?? '').trim();
      const startDate = String(form.get('startDate') ?? '').trim();
      const monthlyRent = Number(form.get('monthlyRent') ?? '0');
      const customerId = Number(form.get('customerId') ?? '0');
      const vatCode = String(form.get('vatCode') ?? '6').trim();
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
            internalComment: `${brand} lease ${leaseId} (${unit}). Staged with auto-billing off.`,
            subscriptionLines: [{ rowNumber: 1, itemName: `Rent ${unit} (${leaseId})`, quantity: 1, unitPrice: Number(monthlyRent.toFixed(2)), vatCode }],
          },
        })
      );
      return htmlResponse(html`<tr><td class="mono">${leaseId}</td><td>Customer #${customerId}</td><td>${unit}</td><td class="mono">${startDate}</td><td class="num">${formatMinor(Math.round(monthlyRent * 100))} NOK</td><td>${reaiBadge({ text: `Staged #${created.id ?? 'ok'}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${brand} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }

  return errorResponse('Unknown property route.', 404);
}
