// @ts-check
import { num } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import {
  csvAttachment,
  currentMonthIso,
  formatMinor,
  loadActiveBanks,
  loadPendingBankTransactions,
  matchPayouts,
  monthBounds,
} from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../../lib/ui.js';
import { decodeCsvBytes, parseCsv } from '../../lib/csv.js';

/**
 * @typedef {import('../../lib/reconcile.js').PayoutItem & { grossMinor: number, provider: string }} SpensePayout
 */

const BRAND = 'Spense';
const BASE = '/app/spense';
const TITLE = 'Spense Settlement Reconcile';
const LEAD = 'Import a Spense settlement report, match each payout against pending ReAI bank transactions and create one balanced review voucher for customer payments, withheld fees and payouts.';
const DEFAULT_CLEARING = '1580';
const DEFAULT_FEE = '7770';

/*
 * Spense documents the settlement report formats at https://developer.spensepay.com/guides/settlements and
 * https://developer.spensepay.com/apis/partner/settlements (GET https://api.spensepay.com/partner/settlements/generate_csv).
 * That endpoint takes a JSON body on a GET request, which Worker fetch cannot send, so this app imports the CSV file instead.
 *   payouts:      Date of payout,Payment provider,Reference,Currency,Gross Amount,Fees,Net Amount
 *   transactions: Date of transaction,Payment provider,Settlement reference,Settlement paid at,Reference,Currency,Gross amount,Fees,Net amount,Payment type,Payment method
 */
const SAMPLE_CSV = 'Date of payout,Payment provider,Reference,Currency,Gross Amount,Fees,Net Amount\n'
  + '2026-10-06 00:00:00+00:00,Worldline Bambora,12345678-20261006,NOK,18450.00,184.50,18265.50\n'
  + '2026-10-13 00:00:00+00:00,Worldline Bambora,12345678-20261013,NOK,9200.00,92.00,9108.00\n'
  + '2026-10-20 00:00:00+00:00,Neonomics,NEO-20261020,NOK,32900.00,0.00,32900.00';

/** @param {string} h */
function key(h) {
  return h.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** @param {string} v */
function day(v) {
  const s = v.trim();
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(s) ? s.slice(0, 10) : '';
}

/** @param {string} v */
function minor(v) {
  return Math.round(num(v) * 100);
}

/**
 * Parses a Spense settlement CSV in the documented payouts or transactions format into payouts.
 * @param {string} text
 * @returns {SpensePayout[]}
 */
export function parseSpenseCsv(text) {
  const doc = parseCsv(text);
  const cols = doc.headers.map(key);
  const has = (/** @type {string} */ name) => cols.includes(name);
  const get = (/** @type {string[]} */ row, /** @type {string} */ name) => {
    const i = cols.indexOf(name);
    return i >= 0 ? (row[i] ?? '').trim() : '';
  };
  /** @type {SpensePayout[]} */
  const out = [];
  if (has('date of payout')) {
    if (!has('reference') || !has('currency') || !has('gross amount')) throw new HttpError(400, 'Spense payouts CSV must include Reference, Currency and Gross Amount.');
    for (const row of doc.rows) {
      const date = day(get(row, 'date of payout'));
      const grossMinor = minor(get(row, 'gross amount'));
      const feeMinor = Math.abs(minor(get(row, 'fees')));
      const netRaw = get(row, 'net amount');
      const amountMinor = netRaw ? minor(netRaw) : grossMinor - feeMinor;
      const reference = get(row, 'reference');
      if (!date || !reference || (grossMinor === 0 && amountMinor === 0)) continue;
      const provider = get(row, 'payment provider');
      out.push({ id: `${reference}-${date}`, date, reference, currency: get(row, 'currency').toUpperCase() || 'NOK', grossMinor, amountMinor, feeMinor, provider, detail: `${provider || 'Spense'} · gross ${formatMinor(grossMinor)}, fees ${formatMinor(feeMinor)}` });
    }
  } else if (has('settlement reference')) {
    if (!has('currency') || !has('gross amount')) throw new HttpError(400, 'Spense transactions CSV must include Currency and Gross amount.');
    /** @type {Map<string, SpensePayout>} */
    const groups = new Map();
    for (const row of doc.rows) {
      const reference = get(row, 'settlement reference');
      const date = day(get(row, 'settlement paid at')) || day(get(row, 'date of transaction'));
      if (!reference || !date) continue;
      const grossMinor = minor(get(row, 'gross amount'));
      const feeMinor = Math.abs(minor(get(row, 'fees')));
      const netRaw = get(row, 'net amount');
      const netMinor = netRaw ? minor(netRaw) : grossMinor - feeMinor;
      const currency = get(row, 'currency').toUpperCase() || 'NOK';
      const id = `${reference}-${currency}`;
      const provider = get(row, 'payment provider');
      const prev = groups.get(id) ?? { id, date, reference, currency, grossMinor: 0, amountMinor: 0, feeMinor: 0, provider, detail: '' };
      prev.grossMinor += grossMinor;
      prev.amountMinor += netMinor;
      prev.feeMinor = (prev.feeMinor ?? 0) + feeMinor;
      if (date > prev.date) prev.date = date;
      groups.set(id, prev);
    }
    for (const g of groups.values()) {
      g.detail = `${g.provider || 'Spense'} · gross ${formatMinor(g.grossMinor)}, fees ${formatMinor(g.feeMinor ?? 0)}`;
      out.push(g);
    }
  } else {
    throw new HttpError(400, 'Upload a Spense settlement CSV in the payouts format (Date of payout, Reference, Gross Amount, Fees, Net Amount) or transactions format (Settlement reference, Gross amount).');
  }
  if (out.length === 0) throw new HttpError(400, 'No Spense payouts found in the CSV.');
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Builds balanced manual voucher postings for Spense payouts. Each payout gives one row
 * (bank debit, clearing credit, net) plus one row for fees withheld from the payout.
 * @param {SpensePayout[]} payouts
 * @param {{ bankAccount: string, companyBankId: number, clearingAccount: string, feeAccount: string, currency: string }} accounts
 */
export function buildPostings(payouts, accounts) {
  /** @type {Array<Record<string, unknown>>} */
  const postings = [];
  let rowNumber = 0;
  for (const p of payouts) {
    const withheldMinor = p.grossMinor - p.amountMinor;
    if (p.amountMinor !== 0) {
      const amount = Number((p.amountMinor / 100).toFixed(2));
      const description = `Spense payout ${p.reference}`;
      postings.push({ accountNumber: accounts.bankAccount, companyBankId: accounts.companyBankId, postingDate: p.date, currencyCode: accounts.currency, amount, vatCode: '0', rowNumber, description });
      postings.push({ accountNumber: accounts.clearingAccount, postingDate: p.date, currencyCode: accounts.currency, amount: -amount, vatCode: '0', rowNumber, description });
      rowNumber += 1;
    }
    if (withheldMinor > 0) {
      const fee = Number((withheldMinor / 100).toFixed(2));
      const description = `Spense fees withheld ${p.reference}`;
      postings.push({ accountNumber: accounts.feeAccount, postingDate: p.date, currencyCode: accounts.currency, amount: fee, vatCode: '0', rowNumber, description });
      postings.push({ accountNumber: accounts.clearingAccount, postingDate: p.date, currencyCode: accounts.currency, amount: -fee, vatCode: '0', rowNumber, description });
      rowNumber += 1;
    }
  }
  return postings;
}

/**
 * @param {{ rows: import('../../lib/reconcile.js').ReconcileRow[], payouts: SpensePayout[], month: string, currency: string, excluded: number, bankCount: number, bankId: number, isSample?: boolean }} state
 */
function renderResults(state) {
  const { rows, payouts, month, currency, excluded, bankCount, bankId, isSample } = state;
  const matched = rows.filter((r) => r.match !== null).length;
  const grossMinor = payouts.reduce((s, p) => s + p.grossMinor, 0);
  const netMinor = payouts.reduce((s, p) => s + p.amountMinor, 0);
  const withheldMinor = grossMinor - netMinor;
  const csvRows = [
    ['provider', 'payment_provider', 'reference', 'payout_date', 'gross', 'withheld_fees', 'net_payout', 'currency', 'match_status', 'reai_bank_transaction_id'],
    ...rows.map((r) => {
      const p = payouts.find((x) => x.id === r.payout.id);
      return [BRAND, p?.provider ?? '', r.payout.reference, r.payout.date, ((p?.grossMinor ?? 0) / 100).toFixed(2), (((p?.grossMinor ?? 0) - r.payout.amountMinor) / 100).toFixed(2), (r.payout.amountMinor / 100).toFixed(2), r.payout.currency, r.status, r.match ? String(r.match.id) : ''];
    }),
  ];
  return html`
    ${reaiCard({
      eyebrow: 'SPENSE SETTLEMENT REVIEW',
      title: `${BRAND} · ${month}`,
      badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${matched}/${rows.length} matched`, tone: matched === rows.length && rows.length > 0 ? 'success' : 'warn' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Payouts', value: String(rows.length), detail: `${excluded} outside ${month} or other currency` })}
          ${reaiMetric({ label: 'Customer payments', value: `${formatMinor(grossMinor)} ${currency}`, detail: 'Gross settled amount' })}
          ${reaiMetric({ label: 'Fees withheld', value: `${formatMinor(withheldMinor)} ${currency}`, detail: 'Gross minus net payout' })}
          ${reaiMetric({ label: 'Net payouts', value: `${formatMinor(netMinor)} ${currency}`, detail: `${bankCount} pending ReAI bank rows` })}
        </div>
        ${rows.length === 0
          ? reaiCallout({ tone: 'info', body: `No ${currency} Spense payouts in ${month}.` })
          : html`
            <div class="table-wrap"><table class="data-table">
              <thead><tr><th>Date</th><th>Reference</th><th class="num">Net payout</th><th>Bank match</th><th>ReAI bank tx</th><th>Details</th></tr></thead>
              <tbody>${rows.map((r) => html`<tr>
                <td class="mono">${r.payout.date}</td><td class="mono">${r.payout.reference}</td>
                <td class="num">${formatMinor(r.payout.amountMinor)} ${r.payout.currency}</td>
                <td>${reaiBadge({ text: r.status, tone: r.match ? 'success' : 'warn' })}</td>
                <td class="mono">${r.match ? `#${r.match.id} (${r.match.transactionDate})` : '—'}</td>
                <td>${r.payout.detail}</td>
              </tr>`)}</tbody>
            </table></div>
            <form class="stack-sm" method="post" action="${BASE}/export">
              <input type="hidden" name="filename" value="spense-reconciliation-${month}.csv">
              <input type="hidden" name="rowsJson" value="${JSON.stringify(csvRows)}">
              <div><button type="submit" class="button secondary">Download reconciliation CSV ↓</button></div>
            </form>
          `}
      `,
    })}
    ${!isSample && rows.length > 0 && bankId > 0
      ? reaiCard({
          eyebrow: 'OPTIONAL · REVIEW VOUCHER',
          title: 'Book Spense settlements for review',
          body: html`
            <p class="muted-note">Debits the selected bank account with each net payout and the fee account with fees withheld, against the clearing account where the paid customer invoices from your workshop system sit. Skip this if your accountant already books Spense settlements another way.</p>
            <form class="stack" hx-post="${BASE}/voucher" hx-target="#spense-booking" hx-swap="innerHTML">
              <input type="hidden" name="month" value="${month}"><input type="hidden" name="bankId" value="${bankId}">
              <input type="hidden" name="payoutsJson" value="${JSON.stringify(payouts)}">
              <div class="inline-row">
                <div class="field"><label for="sp-clearing">Spense clearing account</label><input id="sp-clearing" name="clearingAccount" type="text" pattern="[0-9]{4}" value="${DEFAULT_CLEARING}" required></div>
                <div class="field"><label for="sp-fee">Fee expense account</label><input id="sp-fee" name="feeAccount" type="text" pattern="[0-9]{4}" value="${DEFAULT_FEE}" required></div>
              </div>
              <label class="check-row"><input type="checkbox" name="c_report" required> I checked these totals against the Spense settlement report for ${month}.</label>
              <label class="check-row"><input type="checkbox" name="c_fees" required> Fees shown as withheld were deducted from the payouts and not invoiced separately by Spense.</label>
              <div><button type="submit" class="button primary">Create review voucher (${formatMinor(grossMinor)} ${currency})</button></div>
            </form>
            <div id="spense-booking" class="stack-sm"></div>
          `,
        })
      : ''}
  `;
}

/**
 * Handles /app/spense/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE}/`, request.url), 301);
  if (pathname === `${BASE}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    /** @type {Array<{ id: number, displayName: string, currencyCode: string, ledgerAccountNumber: string }>} */
    let banks = [];
    if (session && session.tenantId > 0) {
      try { banks = await loadActiveBanks(env, session); } catch { banks = []; }
    }
    const body = html`
      <section class="app-intro"><p class="eyebrow">PAYMENTS & PAYOUTS</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-spense-web', clientName: `ReAI ${BRAND} Reconcile (Web)` })}
        ${reaiCard({
          eyebrow: 'SPENSE SETTLEMENT CSV',
          title: 'Upload the Spense settlement report',
          body: html`<form class="stack" hx-post="${BASE}/review" hx-encoding="multipart/form-data" hx-target="#spense-output" hx-swap="innerHTML">
            <p class="muted-note">The file stays in this request and is never stored.</p>
            <div class="mapping-grid">
              <div class="field"><label for="sp-month">Payout month</label><input id="sp-month" name="month" type="text" pattern="[0-9]{4}-[0-9]{2}" value="${currentMonthIso()}" required placeholder="YYYY-MM"></div>
              <div class="field"><label for="sp-bank">ReAI bank account</label><select id="sp-bank" name="bankId"><option value="0">${banks.length > 0 ? 'Select bank account…' : 'Connect to ReAI to load banks'}</option>${banks.map((b) => html`<option value="${b.id}">${b.displayName} (${b.ledgerAccountNumber} · ${b.currencyCode})</option>`)}</select></div>
            </div>
            ${reaiDropzone({ inputId: 'sp-csv', name: 'file', accept: '.csv,text/csv,text/plain', label: 'Choose Spense CSV', hint: 'Payouts format (Date of payout, Reference, Gross Amount, Fees, Net Amount) or transactions format.' })}
            <div class="inline-row">
              <button type="submit" class="button primary">Review Spense payouts</button>
              <button type="button" class="button secondary" hx-post="${BASE}/sample" hx-target="#spense-output" hx-swap="innerHTML">Load sample review</button>
            </div>
          </form>`,
        })}
        <div id="spense-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${BASE}/sample`) {
    const payouts = parseSpenseCsv(SAMPLE_CSV);
    /** @type {import('../../lib/reconcile.js').BankTx[]} */
    const bankTx = [
      { id: 9101, amount: 18265.5, currencyCode: 'NOK', transactionDate: '2026-10-07', description: 'SPENSE 12345678-20261006', paymentReference: '12345678-20261006' },
      { id: 9102, amount: 9108.0, currencyCode: 'NOK', transactionDate: '2026-10-14', description: 'Spense oppgjør', paymentReference: null },
    ];
    return htmlResponse(renderResults({ rows: matchPayouts(payouts, bankTx), payouts, month: '2026-10', currency: 'NOK', excluded: 0, bankCount: bankTx.length, bankId: 0, isSample: true }));
  }

  try {
    const form = await request.formData();
    if (pathname === `${BASE}/export`) {
      const rows = /** @type {string[][]} */ (JSON.parse(String(form.get('rowsJson') ?? '[]')));
      return csvAttachment(String(form.get('filename') ?? 'spense-reconciliation.csv'), rows);
    }
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    const company = session.tenants.find((t) => t.id === session.tenantId);
    if (!company) throw new HttpError(400, 'Select a valid ReAI company.');
    const bounds = monthBounds(String(form.get('month') ?? '').trim());
    const bankId = Number(form.get('bankId') ?? '0');

    if (pathname === `${BASE}/review`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a Spense CSV file first.');
      const all = parseSpenseCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer())));
      const payouts = all.filter((p) => p.currency === company.currencyCode && p.date.startsWith(bounds.month));
      const bankTx = bankId > 0 ? await loadPendingBankTransactions(env, session, bankId, bounds.month) : [];
      return htmlResponse(renderResults({ rows: matchPayouts(payouts, bankTx), payouts, month: bounds.month, currency: company.currencyCode, excluded: all.length - payouts.length, bankCount: bankTx.length, bankId }));
    }

    if (pathname === `${BASE}/voucher`) {
      if (form.get('c_report') !== 'on' || form.get('c_fees') !== 'on') throw new HttpError(400, 'Confirm both checkboxes first.');
      const clearingAccount = String(form.get('clearingAccount') ?? '').trim();
      const feeAccount = String(form.get('feeAccount') ?? '').trim();
      if (!/^[0-9]{4}$/.test(clearingAccount) || !/^[0-9]{4}$/.test(feeAccount)) throw new HttpError(400, 'Accounts must be 4 digits.');
      const banks = await loadActiveBanks(env, session);
      const bank = banks.find((b) => b.id === bankId);
      if (!bank) throw new HttpError(400, 'Select an active ReAI bank account in the company currency.');
      const payouts = /** @type {SpensePayout[]} */ (JSON.parse(String(form.get('payoutsJson') ?? '[]')))
        .filter((p) => p && typeof p.date === 'string' && p.date.startsWith(bounds.month) && p.currency === company.currencyCode && Number.isInteger(p.grossMinor) && Number.isInteger(p.amountMinor));
      if (payouts.length === 0) throw new HttpError(400, 'No payouts to book.');
      const postings = buildPostings(payouts, { bankAccount: bank.ledgerAccountNumber, companyBankId: bank.id, clearingAccount, feeAccount, currency: company.currencyCode });
      const grossMinor = payouts.reduce((s, p) => s + p.grossMinor, 0);
      const lastDate = payouts.map((p) => p.date).sort().at(-1) ?? bounds.lastDay;
      const marker = `${BRAND} settlements ${bounds.month} (${payouts.length} payouts, ${grossMinor})`;
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (await reaiAll(env, '/api/vouchers', { token: session.accessToken, tenantId: session.tenantId, query: { startDate: bounds.start, endDate: bounds.lastDay, includeReversed: 'true' } }));
      const dup = existing.find((v) => typeof v.description === 'string' && v.description.startsWith(marker));
      if (dup) return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { date: lastDate, description: marker, reviewReason: `${BRAND} settlement report imported via apps.reai.no.`, postings } }));
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`<a href="${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>. Match the bank postings to the bank feed in ReAI bank reconciliation.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse(`Unknown ${BRAND} route.`, 404);
}
