// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { CARD_API_UI, fetchCardsApi, renderApiFetchCard } from '../lib/provider-api.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/**
 * @typedef {'pleo' | 'revolut'} CardSlug
 * @typedef {{ date: string, merchant: string, account: string, amountMinor: number, vatCode: string }} ExpenseLine
 */

const SAMPLE_PLEO_CSV = [
  'Date;Merchant;Account;Amount;VAT',
  '2026-10-04;Cloudflare Inc;6900;420,00;0',
  '2026-10-09;Vy Togbillett Oslo–Bergen;7140;899,00;0',
  '2026-10-16;Clas Ohlson Kontorrekvisita;6800;649,00;0',
].join('\n');

const SAMPLE_REVOLUT_CSV = [
  'Date;Description;Amount;Fee;Account',
  '2026-10-05;GitHub Enterprise Seat;-2150,00;0,00;6900',
  '2026-10-12;AWS EMEA Cloud Hosting;-3840,00;19,20;6900',
  '2026-10-19;Figma Team Subscription;-540,00;2,70;6900',
].join('\n');

/**
 * @param {string} raw
 */
function parseAmountMinor(raw) {
  const cleaned = raw.replace(/[\s\u00A0]/g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  const val = Number(cleaned);
  return Number.isFinite(val) ? Math.round(Math.abs(val) * 100) : 0;
}

/**
 * @param {CardSlug} slug
 * @param {string} csvText
 * @returns {ExpenseLine[]}
 */
function parseCardCsv(slug, csvText) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const dateIdx = norm.findIndex((h) => h.includes('date') || h.includes('dato'));
  const merchIdx = norm.findIndex((h) => h.includes('merchant') || h.includes('desc') || h.includes('beskrivelse') || h.includes('counterparty'));
  const amtIdx = norm.findIndex((h) => h.includes('amount') || h.includes('belop') || h.includes('beløp') || h.includes('total'));
  const acctIdx = norm.findIndex((h) => h.includes('account') || h.includes('konto'));
  const feeIdx = norm.findIndex((h) => h.includes('fee') || h.includes('gebyr'));

  if (dateIdx < 0 || amtIdx < 0) {
    throw new HttpError(400, 'CSV must include Date/Dato and Amount/Beløp columns.');
  }

  /** @type {ExpenseLine[]} */
  const out = [];
  for (const row of doc.rows) {
    const date = (row[dateIdx] ?? '').trim().slice(0, 10);
    const amountMinor = parseAmountMinor(row[amtIdx] ?? '');
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || amountMinor <= 0) {
      continue;
    }
    const rawAcct = acctIdx >= 0 ? (row[acctIdx] ?? '').trim() : '';
    const account = /^[0-9]{4}$/.test(rawAcct) ? rawAcct : '6800';
    const merchant = merchIdx >= 0 ? (row[merchIdx] ?? '').trim() || 'Card expense' : 'Card expense';
    out.push({ date, merchant, account, amountMinor, vatCode: '0' });
    if (slug === 'revolut' && feeIdx >= 0) {
      const feeMinor = parseAmountMinor(row[feeIdx] ?? '');
      if (feeMinor > 0) {
        out.push({ date, merchant: `${merchant} · FX/card fee`, account: '7770', amountMinor: feeMinor, vatCode: '0' });
      }
    }
  }
  if (out.length === 0) {
    throw new HttpError(400, 'No valid expense rows found in this CSV.');
  }
  return out;
}

/**
 * @param {CardSlug} slug
 * @param {{ lines: ExpenseLine[], clearingAccount: string, isSample?: boolean }} state
 */
function renderCardPreview(slug, state) {
  const totalMinor = state.lines.reduce((s, l) => s + l.amountMinor, 0);
  const lastDate = state.lines.map((l) => l.date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
  const brand = slug === 'pleo' ? 'Pleo' : 'Revolut / Wise';
  return html`
    ${reaiCard({
      eyebrow: `${brand.toUpperCase()} BATCH VOUCHER PREVIEW`,
      title: `${state.lines.length} expense lines · ${lastDate.slice(0, 7)}`,
      badge: state.isSample
        ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' })
        : reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Expense lines', value: String(state.lines.length), detail: 'Mapped to NS 4102 accounts' })}
          ${reaiMetric({ label: 'Total debit (expenses)', value: `${formatMinor(totalMinor)} NOK`, detail: 'Includes FX fees on 7770' })}
          ${reaiMetric({ label: 'Credit clearing account', value: state.clearingAccount, detail: 'Corporate card / wallet ledger' })}
        </div>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Merchant / Description</th>
                <th>Debit account</th>
                <th class="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              ${state.lines.map(
                (l) => html`<tr>
                  <td class="mono">${l.date}</td>
                  <td>${l.merchant}</td>
                  <td class="mono">${l.account}</td>
                  <td class="num">${formatMinor(l.amountMinor)} NOK</td>
                </tr>`,
              )}
              <tr>
                <td class="mono">${lastDate}</td>
                <td><strong>${brand} settlement clearing (credit)</strong></td>
                <td class="mono">${state.clearingAccount}</td>
                <td class="num"><strong>-${formatMinor(totalMinor)} NOK</strong></td>
              </tr>
            </tbody>
          </table>
        </div>

        ${!state.isSample
          ? html`<form class="stack-sm confirm-box" hx-post="/app/${slug}/book" hx-target="#card-booking" hx-swap="innerHTML">
              <input type="hidden" name="linesJson" value="${JSON.stringify(state.lines)}">
              <input type="hidden" name="clearingAccount" value="${state.clearingAccount}">
              <label class="check-row"><input type="checkbox" name="c_receipts" required> I verified these card expenses and will attach receipts / statement PDF to the ReAI review voucher.</label>
              <div>
                <button type="submit" class="button primary">Create review voucher in ReAI</button>
              </div>
            </form>
            <div id="card-booking" class="stack-sm"></div>`
          : reaiCallout({ tone: 'info', body: `Upload your real ${brand} CSV export above and connect to ReAI to post the review voucher.` })}
      `,
    })}
  `;
}

/**
 * Handles /app/pleo/* and /app/revolut/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @param {CardSlug} slug
 * @returns {Promise<Response>}
 */
export async function handleCards(request, env, slug) {
  const { pathname } = new URL(request.url);
  const basePath = `/app/${slug}`;
  const isPleo = slug === 'pleo';
  const title = isPleo ? 'Pleo Expenses Import' : 'Revolut & Wise Business Import';
  const lead = isPleo
    ? 'Import Pleo corporate card expense CSV exports into balanced ReAI review vouchers mapped to your Norwegian chart of accounts.'
    : 'Import Revolut Business and Wise multi-currency card & statement CSVs into balanced ReAI review vouchers with automatic fee separation on 7770.';
  const defaultClearing = isPleo ? '2380' : '1925';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  }

  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro">
        <p class="eyebrow">CORPORATE CARDS & EXPENSES</p>
        <h1>${title}</h1>
        <p class="lead">${lead}</p>
      </section>

      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${slug}-web`, clientName: `ReAI ${title} (Web)` })}
        ${renderApiFetchCard({
          basePath,
          targetId: 'card-output',
          brand: CARD_API_UI[slug].brand,
          hint: CARD_API_UI[slug].hint,
          fields: CARD_API_UI[slug].fields,
          sampleAction: true,
        })}

        ${reaiCard({
          eyebrow: 'UPLOAD STATEMENT CSV',
          title: isPleo ? 'Upload Pleo accounting export CSV' : 'Upload Revolut or Wise CSV statement',
          body: html`
            <form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#card-output" hx-swap="innerHTML">
              <div class="inline-row">
                <div class="field">
                  <label for="card-clearing">Clearing / card account (4 digits)</label>
                  <input id="card-clearing" name="clearingAccount" type="text" pattern="[0-9]{4}" value="${defaultClearing}" required>
                </div>
              </div>
              ${reaiDropzone({
                inputId: 'card-csv',
                name: 'file',
                accept: '.csv,text/csv,text/plain',
                label: isPleo ? 'Choose Pleo CSV' : 'Choose Revolut / Wise CSV',
                hint: 'UTF-8 or Windows-1252 CSV with Date, Description/Merchant, Amount and optional Account/Fee columns.',
              })}
              <div class="inline-row">
                <button type="submit" class="button primary">Preview balanced voucher</button>
                <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#card-output" hx-swap="innerHTML">Load sample export</button>
              </div>
            </form>
          `,
        })}

        <div id="card-output" class="stack"></div>
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
    const lines = parseCardCsv(slug, isPleo ? SAMPLE_PLEO_CSV : SAMPLE_REVOLUT_CSV);
    return htmlResponse(renderCardPreview(slug, { lines, clearingAccount: defaultClearing, isSample: true }));
  }

  try {
    const form = await request.formData();

    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */
      const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      const clearingAccount = (creds.clearingAccount || defaultClearing).trim();
      const lines = await fetchCardsApi(slug, creds);
      return htmlResponse(renderCardPreview(slug, { lines, clearingAccount }));
    }

    if (pathname === `${basePath}/preview`) {
      const clearingAccount = String(form.get('clearingAccount') ?? defaultClearing).trim();
      if (!/^[0-9]{4}$/.test(clearingAccount)) {
        throw new HttpError(400, 'Enter a 4-digit clearing account.');
      }
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) {
        throw new HttpError(400, 'Choose a CSV file or load the synthetic sample.');
      }
      const csvText = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
      const lines = parseCardCsv(slug, csvText);
      return htmlResponse(renderCardPreview(slug, { lines, clearingAccount }));
    }

    if (pathname === `${basePath}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) {
        throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      }
      if (form.get('c_receipts') !== 'on') {
        throw new HttpError(400, 'Confirm the verification checkbox first.');
      }
      const lines = /** @type {ExpenseLine[]} */ (JSON.parse(String(form.get('linesJson') ?? '[]')));
      const clearingAccount = String(form.get('clearingAccount') ?? defaultClearing).trim();
      if (!lines.length || !/^[0-9]{4}$/.test(clearingAccount)) {
        throw new HttpError(400, 'Invalid expense batch.');
      }
      const lastDate = lines.map((l) => l.date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
      const totalMinor = lines.reduce((s, l) => s + l.amountMinor, 0);
      const label = isPleo ? 'Pleo' : 'Revolut/Wise';
      const marker = `${label} expenses ${lastDate.slice(0, 7)} (${lines.length} lines, ${totalMinor})`;
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (
        await reaiAll(env, '/api/vouchers', {
          token: session.accessToken,
          tenantId: session.tenantId,
          query: { startDate: `${lastDate.slice(0, 7)}-01`, endDate: lastDate, includeReversed: 'true' },
        })
      );
      const dup = existing.find((v) => typeof v.description === 'string' && v.description.startsWith(marker));
      if (dup) {
        const url = `${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}`;
        return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${url}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      }
      const postings = [
        ...lines.map((l, idx) => ({
          accountNumber: l.account,
          postingDate: l.date,
          currencyCode: 'NOK',
          amount: Number((l.amountMinor / 100).toFixed(2)),
          vatCode: l.vatCode,
          rowNumber: idx,
          description: `${label}: ${l.merchant}`,
        })),
        {
          accountNumber: clearingAccount,
          postingDate: lastDate,
          currencyCode: 'NOK',
          amount: Number((-totalMinor / 100).toFixed(2)),
          vatCode: '0',
          rowNumber: lines.length,
          description: `${label} card/account clearing`,
        },
      ];
      const created = /** @type {{ id: number, number: string }} */ (
        await reaiRequest(env, '/api/manual-vouchers', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: {
            date: lastDate,
            description: marker,
            reviewReason: `Imported ${label} card expense batch. Attach receipt bundle and verify VAT deductions before clearing review.`,
            postings,
          },
        })
      );
      const url = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI to attach receipts and approve: <a href="${url}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Expense import failed.';
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Import error', body: msg }));
  }

  return errorResponse('Unknown card route.', 404);
}
