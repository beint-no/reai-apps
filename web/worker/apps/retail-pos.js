// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/**
 * @typedef {'pckasse' | 'extendago' | 'susoft'} RetailSlug
 * @typedef {{ date: string, account: string, description: string, signedMinor: number }} JournalLine
 */

/** @type {Record<RetailSlug, { brand: string, title: string, lead: string, sampleCsv: string }>} */
const RETAIL = {
  pckasse: {
    brand: 'PCKasse (Confirma PCK)',
    title: 'PCKasse Daily Accounting Import',
    lead: 'Import PCKasse (Confirma PCK) daily Z-report and accounting export CSVs directly into balanced ReAI review vouchers with zero monthly connector fee.',
    sampleCsv: 'Dato;Konto;Beskrivelse;Belop\n2026-10-24;1900;PCKasse Z-418 Kontant;3450,00\n2026-10-24;1580;PCKasse Z-418 Bankterminal;28900,00\n2026-10-24;1580;PCKasse Z-418 Vipps;5150,00\n2026-10-24;3000;Varesalg 25% MVA (netto);-30000,00\n2026-10-24;2700;Utgående MVA 25%;-7500,00',
  },
  extendago: {
    brand: 'ExtendaGO',
    title: 'ExtendaGO Cloud POS Accounting',
    lead: 'Import daily ExtendaGO cloud POS accounting summaries into balanced ReAI review vouchers for retail chains and pop-up stores.',
    sampleCsv: 'Dato;Konto;Beskrivelse;Belop\n2026-10-24;1900;ExtendaGO Kontant;1800,00\n2026-10-24;1580;ExtendaGO Kortterminal;21950,00\n2026-10-24;3000;Butikksalg 25% (netto);-19000,00\n2026-10-24;2700;Utgående MVA 25%;-4750,00',
  },
  susoft: {
    brand: 'Susoft',
    title: 'Susoft Retail & Omnichannel POS Sync',
    lead: 'Import Susoft POS daily Z-report and omnichannel accounting exports directly into balanced ReAI review vouchers.',
    sampleCsv: 'Dato;Konto;Beskrivelse;Belop\n2026-10-24;1900;Susoft Kasse 1 Kontant;2250,00\n2026-10-24;1580;Susoft Bankaxept / Kort;33750,00\n2026-10-24;3000;Varesalg 25% (netto);-28000,00\n2026-10-24;2700;Utgående MVA 25%;-7000,00\n2026-10-24;2900;Solgte gavekort;-1000,00',
  },
};

/**
 * @param {string} csvText
 * @returns {JournalLine[]}
 */
function parseJournalCsv(csvText) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const dateIdx = norm.findIndex((h) => h.includes('dato') || h.includes('date'));
  const acctIdx = norm.findIndex((h) => h.includes('konto') || h.includes('account'));
  const descIdx = norm.findIndex((h) => h.includes('beskrivelse') || h.includes('desc') || h.includes('tekst'));
  const amtIdx = norm.findIndex((h) => h.includes('belop') || h.includes('beløp') || h.includes('amount'));
  if (dateIdx < 0 || acctIdx < 0 || amtIdx < 0) {
    throw new HttpError(400, 'CSV must include Dato/Date, Konto/Account and Beløp/Amount columns.');
  }
  /** @type {JournalLine[]} */
  const lines = [];
  for (const r of doc.rows) {
    const date = (r[dateIdx] ?? '').trim().slice(0, 10);
    const account = (r[acctIdx] ?? '').trim();
    const cleaned = (r[amtIdx] ?? '').replace(/[\s\u00A0]/g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
    const num = Number(cleaned);
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !/^[0-9]{4}$/.test(account) || !Number.isFinite(num) || num === 0) {
      continue;
    }
    lines.push({
      date,
      account,
      description: descIdx >= 0 ? (r[descIdx] ?? '').trim() || 'POS posting' : 'POS posting',
      signedMinor: Math.round(num * 100),
    });
  }
  if (lines.length === 0) throw new HttpError(400, 'No valid 4-digit account postings found in this CSV.');
  return lines;
}

/**
 * @param {RetailSlug} slug
 * @param {JournalLine[]} lines
 * @param {boolean} isSample
 */
function renderRetailPreview(slug, lines, isSample) {
  const cfg = RETAIL[slug];
  const debit = lines.filter((l) => l.signedMinor > 0).reduce((s, l) => s + l.signedMinor, 0);
  const credit = lines.filter((l) => l.signedMinor < 0).reduce((s, l) => s - l.signedMinor, 0);
  const diff = debit - credit;
  const balanced = diff === 0 && debit > 0;
  const lastDate = lines.map((l) => l.date).sort().at(-1) ?? '';

  return html`
    ${reaiCard({
      eyebrow: `${cfg.brand.toUpperCase()} → REAI VOUCHER`,
      title: `${lines.length} postings · ${lastDate}`,
      badge: balanced ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }) : reaiBadge({ text: `Out of balance by ${formatMinor(Math.abs(diff))} NOK`, tone: 'danger' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Total debit', value: `${formatMinor(debit)} NOK`, detail: 'Cash, terminal & clearing' })}
          ${reaiMetric({ label: 'Total credit', value: `${formatMinor(credit)} NOK`, detail: 'Sales, VAT & gift cards' })}
          ${reaiMetric({ label: 'Difference', value: `${formatMinor(diff)} NOK`, detail: balanced ? 'Ready to create review voucher' : 'Check export lines' })}
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Date</th><th>Account</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
            <tbody>
              ${lines.map(
                (l) => html`<tr>
                  <td class="mono">${l.date}</td>
                  <td class="mono">${l.account}</td>
                  <td>${l.description}</td>
                  <td class="num">${l.signedMinor > 0 ? formatMinor(l.signedMinor) : ''}</td>
                  <td class="num">${l.signedMinor < 0 ? formatMinor(-l.signedMinor) : ''}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>
        ${balanced && !isSample
          ? html`<form class="stack-sm confirm-box" hx-post="/app/${slug}/book" hx-target="#rt-booking" hx-swap="innerHTML">
              <input type="hidden" name="linesJson" value="${JSON.stringify(lines)}">
              <label class="check-row"><input type="checkbox" name="c_pos" required> I verified this ${cfg.brand} export against the official Z-report and will attach the PDF in ReAI.</label>
              <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
            </form>
            <div id="rt-booking" class="stack-sm"></div>`
          : isSample
            ? reaiCallout({ tone: 'info', body: `Synthetic ${cfg.brand} Z-report loaded. Upload your real export CSV above and connect to ReAI to book.` })
            : ''}
      `,
    })}
  `;
}

/**
 * Handles /app/{pckasse,extendago,susoft}/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @param {RetailSlug} slug
 * @returns {Promise<Response>}
 */
export async function handleRetailPos(request, env, slug) {
  const cfg = RETAIL[slug];
  const { pathname } = new URL(request.url);
  const basePath = `/app/${slug}`;

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  }
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro">
        <p class="eyebrow">RETAIL POS · NORWAY</p>
        <h1>${cfg.title}</h1>
        <p class="lead">${cfg.lead}</p>
      </section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${slug}-web`, clientName: `ReAI ${cfg.brand} (Web)` })}
        ${reaiCard({
          eyebrow: 'UPLOAD ACCOUNTING EXPORT CSV',
          title: `Import ${cfg.brand} Z-report journal`,
          body: html`
            <form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#rt-output" hx-swap="innerHTML">
              ${reaiDropzone({
                inputId: 'rt-csv',
                name: 'file',
                accept: '.csv,text/csv,text/plain',
                label: `Choose ${cfg.brand} CSV`,
                hint: 'CSV with Dato/Date, Konto/Account, Beskrivelse/Description and signed Beløp/Amount.',
              })}
              <div class="inline-row">
                <button type="submit" class="button primary">Preview balanced voucher</button>
                <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#rt-output" hx-swap="innerHTML">Load sample Z-report</button>
              </div>
            </form>
          `,
        })}
        <div id="rt-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: cfg.title, description: cfg.lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${basePath}/sample`) {
    return htmlResponse(renderRetailPreview(slug, parseJournalCsv(cfg.sampleCsv), true));
  }

  try {
    const form = await request.formData();
    if (pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) {
        throw new HttpError(400, 'Choose a CSV file or load the sample.');
      }
      const csvText = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
      return htmlResponse(renderRetailPreview(slug, parseJournalCsv(csvText), false));
    }
    if (pathname === `${basePath}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('c_pos') !== 'on') throw new HttpError(400, 'Confirm the verification checkbox first.');
      const lines = /** @type {JournalLine[]} */ (JSON.parse(String(form.get('linesJson') ?? '[]')));
      const sum = lines.reduce((s, l) => s + l.signedMinor, 0);
      if (!lines.length || sum !== 0) throw new HttpError(400, 'Journal must balance to 0.00.');
      const lastDate = lines.map((l) => l.date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
      const debit = lines.filter((l) => l.signedMinor > 0).reduce((s, l) => s + l.signedMinor, 0);
      const marker = `${cfg.brand} Z-report ${lastDate} (${lines.length} lines, ${debit})`;
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (
        await reaiAll(env, '/api/vouchers', { token: session.accessToken, tenantId: session.tenantId, query: { startDate: lastDate, endDate: lastDate, includeReversed: 'true' } })
      );
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) {
        const url = `${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}`;
        return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${url}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      }
      const created = /** @type {{ id: number, number: string }} */ (
        await reaiRequest(env, '/api/manual-vouchers', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: {
            date: lastDate,
            description: marker,
            reviewReason: `${cfg.brand} daily journal imported via apps.reai.no. Attach source Z-report PDF before clearing review.`,
            postings: lines.map((l, idx) => ({
              accountNumber: l.account,
              postingDate: l.date,
              currencyCode: 'NOK',
              amount: Number((l.signedMinor / 100).toFixed(2)),
              vatCode: '0',
              rowNumber: idx,
              description: l.description,
            })),
          },
        })
      );
      const url = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${url}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${cfg.brand} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }

  return errorResponse('Unknown retail POS route.', 404);
}
