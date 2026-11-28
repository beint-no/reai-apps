// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/**
 * @typedef {'smartdok' | 'svenn' | 'cordel' | 'holte' | 'handyman' | 'minuba'} TradeSlug
 * @typedef {{ ref: string, date: string, customerName: string, description: string, hours: number, amountExVat: number, project: string }} TradeOrderRow
 * @typedef {{ id: number, name: string }} SimpleRef
 */

/** @type {Record<TradeSlug, { brand: string, title: string, lead: string, hint: string, sampleCsv: string }>} */
const TRADES = {
  smartdok: {
    brand: 'SmartDok',
    title: 'SmartDok Construction & Hours Sync',
    lead: 'Import approved construction project hours, machine time and billable work orders from SmartDok into ReAI Timesheets and draft customer orders.',
    hint: 'Export approved project hours or billing basis as CSV from SmartDok (Dato, Prosjekt, Kunde, Timer, Beløp, Beskrivelse).',
    sampleCsv: 'Dato;Prosjekt;Kunde;Timer;Belop;Beskrivelse\n2026-10-14;Bane Nord Drift;Nordic Entreprenør AS;16,50;14850,00;Grunnarbeid og gravemaskin etappe 2\n2026-10-15;Boligfelt Vest;Fjord Bygg AS;12,00;10200,00;Rørlegging og inspeksjon',
  },
  svenn: {
    brand: 'Svenn',
    title: 'Svenn Trades & Project Sync',
    lead: 'Sync approved Svenn hours and completed carpentry/craft work orders directly into ReAI Timesheets and draft orders ready for EHF invoicing.',
    hint: 'Export project hours or order lines as CSV from Svenn (Dato, Prosjekt, Kunde, Timer, Beløp, Beskrivelse).',
    sampleCsv: 'Dato;Prosjekt;Kunde;Timer;Belop;Beskrivelse\n2026-10-12;Rehab Storgata 8;Bygård Drift AS;22,50;19125,00;Tømrerarbeid og listverk\n2026-10-16;Terrasse Solbakken;Viken Eiendom AS;14,00;11900,00;Montering av bjelkelag og dekke',
  },
  cordel: {
    brand: 'Cordel',
    title: 'Cordel Contractor & Order Sync',
    lead: 'Bridge Cordel electrician, plumbing and HVAC work orders and logged hours straight into ReAI draft customer orders and timesheets.',
    hint: 'Export completed work order lines or project billing CSV from Cordel (OrdreNr, Dato, Prosjekt, Kunde, Timer, Beløp, Beskrivelse).',
    sampleCsv: 'OrdreNr;Dato;Prosjekt;Kunde;Timer;Belop;Beskrivelse\nCRD-4021;2026-10-11;El-anlegg Lager 4;Oslo Logistikk AS;18,00;24600,00;Sikringsskap, kabling og sluttkontroll\nCRD-4022;2026-10-18;VVS Service;Nordic Eiendom AS;6,50;8950,00;Utskifting varmtvannsbereder inkl. materiell',
  },
  holte: {
    brand: 'Holte (EG Holte)',
    title: 'Holte / HoltePortalen Sync',
    lead: 'Import HoltePortalen construction project hours and NS 3420 progress billing rows directly into ReAI Timesheets and draft orders.',
    hint: 'Export project hours or A-konto billing basis CSV from HoltePortalen.',
    sampleCsv: 'OrdreNr;Dato;Prosjekt;Kunde;Timer;Belop;Beskrivelse\nHLT-901;2026-10-10;Nybygg Skolefløy;Kommune Drift AS;37,50;41250,00;A-konto fremdrift uke 41 (NS 3420)\nHLT-902;2026-10-17;Tilbygg Kontor;Fjord Invest AS;15,00;16500,00;HMS-befaring og prosjektering',
  },
  handyman: {
    brand: 'GSGroup Handyman',
    title: 'Handyman Field Service Sync',
    lead: 'Import completed GSGroup Handyman service orders, technician hours and materials into ReAI draft customer orders and timesheets.',
    hint: 'Export finished Handyman mobile service orders as CSV (OrdreNr, Dato, Kunde, Timer, Beløp, Beskrivelse).',
    sampleCsv: 'OrdreNr;Dato;Prosjekt;Kunde;Timer;Belop;Beskrivelse\nHM-7712;2026-10-13;Ventilasjon Service;Senter Drift AS;5,50;7850,00;Filterbytte og balansering aggregat 2\nHM-7719;2026-10-19;Akutt Rørservice;Bergen Hotelldrift AS;4,00;6400,00;Utbedring lekkasje teknisk rom',
  },
  minuba: {
    brand: 'Minuba',
    title: 'Minuba Work Order Sync',
    lead: 'Import Minuba field work orders, materials and billable craftsman hours directly into ReAI draft customer orders and timesheets.',
    hint: 'Export approved Minuba work orders or time sheets as CSV.',
    sampleCsv: 'OrdreNr;Dato;Prosjekt;Kunde;Timer;Belop;Beskrivelse\nMNB-310;2026-10-14;Ladeboks Garasje;Borettslag Nord;8,00;18400,00;Montering 2x elbillader inkl. vern\nMNB-314;2026-10-20;Serviceavtale Q4;Kyst Fiskeri AS;10,00;11500,00;Årskontroll elektrisk anlegg',
  },
};

/** @param {string} raw */
function numVal(raw) {
  const n = Number(raw.replace(/[\s\u00A0]/g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * @param {string} csvText
 * @param {TradeSlug} slug
 * @returns {TradeOrderRow[]}
 */
function parseTradeCsv(csvText, slug) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const refIdx = norm.findIndex((h) => h.includes('ordre') || h.includes('order') || h.includes('ref') || h.includes('id'));
  const dateIdx = norm.findIndex((h) => h.includes('dato') || h.includes('date'));
  const projIdx = norm.findIndex((h) => h.includes('prosjekt') || h.includes('project'));
  const custIdx = norm.findIndex((h) => h.includes('kunde') || h.includes('customer'));
  const hrsIdx = norm.findIndex((h) => h.includes('timer') || h.includes('hour'));
  const amtIdx = norm.findIndex((h) => h.includes('belop') || h.includes('beløp') || h.includes('amount') || h.includes('sum') || h.includes('pris'));
  const descIdx = norm.findIndex((h) => h.includes('beskrivelse') || h.includes('desc') || h.includes('tekst') || h.includes('kommentar'));
  if (dateIdx < 0 || (hrsIdx < 0 && amtIdx < 0)) {
    throw new HttpError(400, 'CSV must include Dato/Date and at least Timer/Hours or Beløp/Amount columns.');
  }
  return doc.rows
    .map((r, i) => ({
      ref: refIdx >= 0 && (r[refIdx] ?? '').trim() ? (r[refIdx] ?? '').trim() : `${slug.toUpperCase()}-${i + 1}`,
      date: (r[dateIdx] ?? '').trim().slice(0, 10),
      project: projIdx >= 0 ? (r[projIdx] ?? '').trim() || '—' : '—',
      customerName: custIdx >= 0 ? (r[custIdx] ?? '').trim() || '—' : '—',
      hours: hrsIdx >= 0 ? Number(numVal(r[hrsIdx] ?? '0').toFixed(2)) : 0,
      amountExVat: amtIdx >= 0 ? Number(numVal(r[amtIdx] ?? '0').toFixed(2)) : 0,
      description: descIdx >= 0 ? (r[descIdx] ?? '').trim() || 'Work order' : 'Work order',
    }))
    .filter((x) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x.date) && (x.hours > 0 || x.amountExVat > 0));
}

/**
 * @param {TradeSlug} slug
 * @param {{ rows: Array<{ row: TradeOrderRow, customerId: number | null }>, defaultCustomerId: number, employeeId: number, projectId: number, isSample?: boolean }} state
 */
function renderTradePreview(slug, state) {
  const cfg = TRADES[slug];
  const totalHours = state.rows.reduce((s, r) => s + r.row.hours, 0);
  const totalAmt = state.rows.reduce((s, r) => s + r.row.amountExVat, 0);
  return html`
    ${reaiCard({
      eyebrow: `${cfg.brand.toUpperCase()} → REAI ORDERS & TIMESHEETS`,
      title: `${state.rows.length} work-order / hour rows parsed`,
      badge: state.isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Ready to sync', tone: 'success' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Rows', value: String(state.rows.length), detail: 'Idempotent externalReference per order' })}
          ${reaiMetric({ label: 'Total hours', value: `${totalHours.toFixed(2)} h`, detail: 'Postable to /api/timesheets' })}
          ${reaiMetric({ label: 'Billable ex. VAT', value: `${formatMinor(Math.round(totalAmt * 100))} NOK`, detail: 'Stageable as ReAI draft orders (25% VAT)' })}
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Ref</th>
                <th>Date</th>
                <th>Customer / Project</th>
                <th>Description</th>
                <th class="num">Hours</th>
                <th class="num">Ex. VAT (NOK)</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${state.rows.map(({ row, customerId }, idx) => {
                const targetCust = customerId ?? state.defaultCustomerId;
                return html`<tr id="tr-row-${idx}">
                  <td class="mono">${row.ref}</td>
                  <td class="mono">${row.date}</td>
                  <td><strong>${row.customerName}</strong><div class="muted-note">${row.project}</div></td>
                  <td>${row.description}</td>
                  <td class="num">${row.hours.toFixed(2)}</td>
                  <td class="num">${formatMinor(Math.round(row.amountExVat * 100))}</td>
                  <td>
                    ${state.isSample
                      ? html`<span class="muted-note">Demo only</span>`
                      : html`<div class="inline-row">
                          ${row.amountExVat > 0 && targetCust > 0
                            ? html`<form hx-post="/app/${slug}/create-order" hx-target="#tr-row-${idx}" hx-swap="outerHTML">
                                <input type="hidden" name="ref" value="${row.ref}">
                                <input type="hidden" name="date" value="${row.date}">
                                <input type="hidden" name="description" value="${row.description}">
                                <input type="hidden" name="amount" value="${row.amountExVat.toFixed(2)}">
                                <input type="hidden" name="customerId" value="${targetCust}">
                                <input type="hidden" name="projectId" value="${state.projectId}">
                                <button type="submit" class="button primary">Stage order</button>
                              </form>`
                            : ''}
                          ${row.hours >= 0.01 && row.hours <= 24 && state.employeeId > 0
                            ? html`<form hx-post="/app/${slug}/log-hours" hx-target="#tr-row-${idx}" hx-swap="outerHTML">
                                <input type="hidden" name="date" value="${row.date}">
                                <input type="hidden" name="hours" value="${row.hours.toFixed(2)}">
                                <input type="hidden" name="comment" value="[${cfg.brand} ${row.ref}] ${row.description}">
                                <input type="hidden" name="employeeId" value="${state.employeeId}">
                                <input type="hidden" name="projectId" value="${state.projectId}">
                                <button type="submit" class="button secondary">Log hours</button>
                              </form>`
                            : ''}
                        </div>`}
                  </td>
                </tr>`;
              })}
            </tbody>
          </table>
        </div>
      `,
    })}
  `;
}

/**
 * Handles /app/{smartdok,svenn,cordel,holte,handyman,minuba}/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @param {TradeSlug} slug
 * @returns {Promise<Response>}
 */
export async function handleTrades(request, env, slug) {
  const cfg = TRADES[slug];
  const { pathname } = new URL(request.url);
  const basePath = `/app/${slug}`;

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  }

  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    /** @type {SimpleRef[]} */
    let customers = [];
    /** @type {SimpleRef[]} */
    let employees = [];
    /** @type {SimpleRef[]} */
    let projects = [];
    if (session && session.tenantId > 0) {
      try {
        const [c, e, p] = await Promise.all([
          reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId, query: { archived: 'false' } }),
          reaiRequest(env, '/api/employees', { token: session.accessToken, tenantId: session.tenantId }).catch(() => []),
          reaiAll(env, '/api/projects', { token: session.accessToken, tenantId: session.tenantId }).catch(() => []),
        ]);
        customers = /** @type {SimpleRef[]} */ (c);
        employees = Array.isArray(e) ? /** @type {SimpleRef[]} */ (e) : [];
        projects = /** @type {Array<SimpleRef & { archived?: boolean }>} */ (p).filter((x) => !x.archived);
      } catch {
        // leave empty until connected
      }
    }

    const body = html`
      <section class="app-intro">
        <p class="eyebrow">CONSTRUCTION, CRAFTS & FIELD SERVICE</p>
        <h1>${cfg.title}</h1>
        <p class="lead">${cfg.lead}</p>
      </section>

      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${slug}-web`, clientName: `ReAI ${cfg.brand} Sync (Web)` })}

        ${reaiCard({
          eyebrow: `IMPORT FROM ${cfg.brand.toUpperCase()}`,
          title: `Upload ${cfg.brand} work-order or hours CSV`,
          body: html`
            <p class="muted-note">${cfg.hint}</p>
            <form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#tr-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field">
                  <label for="tr-cust">Fallback ReAI customer (for orders)</label>
                  <select id="tr-cust" name="defaultCustomerId">
                    <option value="0">${customers.length > 0 ? 'Match by name or choose…' : 'Connect to ReAI first'}</option>
                    ${customers.slice(0, 200).map((c) => html`<option value="${c.id}">${c.name}</option>`)}
                  </select>
                </div>
                <div class="field">
                  <label for="tr-emp">ReAI employee (for timesheets)</label>
                  <select id="tr-emp" name="employeeId">
                    <option value="0">${employees.length > 0 ? 'Select employee…' : 'Connect to ReAI first'}</option>
                    ${employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}
                  </select>
                </div>
                <div class="field">
                  <label for="tr-proj">ReAI project (optional)</label>
                  <select id="tr-proj" name="projectId">
                    <option value="0">No project</option>
                    ${projects.map((p) => html`<option value="${p.id}">${p.name}</option>`)}
                  </select>
                </div>
              </div>
              ${reaiDropzone({
                inputId: 'tr-csv',
                name: 'file',
                accept: '.csv,text/csv,text/plain',
                label: `Choose ${cfg.brand} CSV`,
                hint: 'Semicolon or comma separated UTF-8 / Windows-1252 CSV.',
              })}
              <div class="inline-row">
                <button type="submit" class="button primary">Preview ${cfg.brand} rows</button>
                <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#tr-output" hx-swap="innerHTML">Load sample export</button>
              </div>
            </form>
          `,
        })}

        <div id="tr-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: cfg.title, description: cfg.lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') {
    return errorResponse('Method not allowed.', 405);
  }
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  if (pathname === `${basePath}/sample`) {
    const parsed = parseTradeCsv(cfg.sampleCsv, slug);
    return htmlResponse(
      renderTradePreview(slug, {
        rows: parsed.map((row) => ({ row, customerId: 1 })),
        defaultCustomerId: 1,
        employeeId: 1,
        projectId: 0,
        isSample: true,
      }),
    );
  }

  try {
    const form = await request.formData();

    if (pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) {
        throw new HttpError(400, 'Choose a CSV file or click Load sample export.');
      }
      const csvText = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
      const parsed = parseTradeCsv(csvText, slug);
      const defaultCustomerId = Number(form.get('defaultCustomerId') ?? '0');
      const employeeId = Number(form.get('employeeId') ?? '0');
      const projectId = Number(form.get('projectId') ?? '0');
      const session = await readSession(env, request);
      /** @type {SimpleRef[]} */
      let customers = [];
      if (session && session.tenantId > 0) {
        customers = /** @type {SimpleRef[]} */ (await reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId, query: { archived: 'false' } }));
      }
      return htmlResponse(
        renderTradePreview(slug, {
          rows: parsed.map((row) => ({
            row,
            customerId: customers.find((c) => c.name.trim().toLowerCase() === row.customerName.toLowerCase())?.id ?? null,
          })),
          defaultCustomerId,
          employeeId,
          projectId,
        }),
      );
    }

    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) {
      throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    }

    if (pathname === `${basePath}/create-order`) {
      const ref = String(form.get('ref') ?? '').trim();
      const date = String(form.get('date') ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
      const description = String(form.get('description') ?? 'Work order').trim().slice(0, 255);
      const amount = Number(form.get('amount') ?? '0');
      const customerId = Number(form.get('customerId') ?? '0');
      const projectId = Number(form.get('projectId') ?? '0');
      if (!ref || amount <= 0 || customerId <= 0) {
        throw new HttpError(400, 'Reference, positive amount and customer are required.');
      }
      const created = /** @type {{ id: number }} */ (
        await reaiRequest(env, '/api/orders', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: {
            customerId,
            currencyCode: 'NOK',
            daysUntilDue: 14,
            issueDate: date,
            orderDate: date,
            externalReference: `${slug}-${ref}`.slice(0, 100),
            ...(projectId > 0 ? { projectId } : {}),
            comment: `Imported from ${cfg.brand} (${ref})`,
            orderLines: [{ itemName: description, quantity: 1, unitPrice: Number(amount.toFixed(2)) }],
          },
        })
      );
      const url = `${reaiOrigin(env)}/order/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(html`<tr>
        <td class="mono">${ref}</td>
        <td class="mono">${date}</td>
        <td>Customer #${customerId}</td>
        <td>${description}</td>
        <td class="num">—</td>
        <td class="num">${formatMinor(Math.round(amount * 100))}</td>
        <td><a href="${url}" target="_blank" rel="noopener">Order #${created.id} ↗</a></td>
      </tr>`);
    }

    if (pathname === `${basePath}/log-hours`) {
      const date = String(form.get('date') ?? '').trim();
      const hours = Number(form.get('hours') ?? '0');
      const comment = String(form.get('comment') ?? '').trim().slice(0, 1000);
      const employeeId = Number(form.get('employeeId') ?? '0');
      const projectId = Number(form.get('projectId') ?? '0');
      if (employeeId <= 0 || hours < 0.01 || hours > 24 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
        throw new HttpError(400, 'Valid employee, date and hours (0.01–24) required.');
      }
      const created = /** @type {{ id: number }} */ (
        await reaiRequest(env, '/api/timesheets', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: { employeeId, date, hours: Number(hours.toFixed(2)), ...(projectId > 0 ? { projectId } : {}), comment },
        })
      );
      return htmlResponse(html`<tr>
        <td class="mono">—</td>
        <td class="mono">${date}</td>
        <td>Employee #${employeeId}</td>
        <td>${comment}</td>
        <td class="num">${hours.toFixed(2)}</td>
        <td class="num">—</td>
        <td>${reaiBadge({ text: `Timesheet #${created.id}`, tone: 'success' })}</td>
      </tr>`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : `${cfg.brand} sync failed.`;
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${cfg.brand} error`, body: msg }));
  }

  return errorResponse('Unknown trades route.', 404);
}
