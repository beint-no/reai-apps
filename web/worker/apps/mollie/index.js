// @ts-check
import { fetchJson, num } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import {
  csvAttachment,
  currentMonthIso,
  formatMinor,
  loadActiveBanks,
  loadPendingBankTransactions,
  matchPayouts,
  monthBounds,
} from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/** @typedef {import('../../lib/reconcile.js').PayoutItem} PayoutItem */
/** @typedef {import('../../lib/reconcile.js').BankTx} BankTx */
/** @typedef {import('../../lib/reconcile.js').ReconcileRow} ReconcileRow */

const SLUG = 'mollie';
const BRAND = 'Mollie';
const TITLE = 'Mollie Settlement Reconcile';
const LEAD = 'Compare Mollie settlements paid out in one month with pending ReAI bank transactions and export a reconciliation CSV with payment volume and Mollie costs.';
const BASE = `/app/${SLUG}`;

const MOLLIE_API = 'https://api.mollie.com/v2';
const PAGE_LIMIT = 250;
const MAX_PAGES = 4;
const OSLO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** @param {unknown} amount Mollie amount object { currency, value } */
function minorOf(amount) {
  const a = /** @type {{ value?: unknown } | null} */ (amount && typeof amount === 'object' ? amount : null);
  return Math.round(num(a?.value) * 100);
}

/**
 * Sums one list (revenue or costs) across all settlement periods.
 * @param {any} periods @param {'revenue' | 'costs'} key @param {'amountGross' | 'amountNet' | 'amountVat'} field
 */
function sumPeriods(periods, key, field) {
  let total = 0;
  for (const year of Object.values(periods && typeof periods === 'object' ? periods : {})) {
    for (const month of Object.values(year && typeof year === 'object' ? year : {})) {
      const rows = /** @type {any} */ (month)?.[key];
      for (const r of Array.isArray(rows) ? rows : []) total += minorOf(r?.[field]);
    }
  }
  return total;
}

/**
 * Fetches Mollie settlements for one month through the Settlements API.
 * Docs:
 * - https://docs.mollie.com/reference/list-settlements.md (GET /v2/settlements, year + month, currencies, from cursor, limit max 250)
 * - https://docs.mollie.com/reference/authentication.md (Bearer advanced access token with settlements.read)
 * - https://docs.mollie.com/reference/pagination.md (_links.next)
 * @param {Record<string, string>} creds `token`, `month` (YYYY-MM), `currency`
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<PayoutItem[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.token ?? '').trim();
  if (!/^access_/.test(token)) throw new HttpError(400, 'Enter a Mollie advanced access token (it starts with access_) with settlements.read.');
  const bounds = monthBounds((creds.month ?? '').trim());
  const currency = (creds.currency ?? 'NOK').trim().toUpperCase();
  // The docs do not say which date the year/month filter uses, so the previous month is read too and rows are kept by settledAt.
  const [y, m] = bounds.month.split('-').map(Number);
  const prev = /** @type {[number, number]} */ (m === 1 ? [Number(y) - 1, 12] : [Number(y), Number(m) - 1]);
  /** @type {PayoutItem[]} */
  const payouts = [];
  /** @type {Set<string>} */ const seen = new Set();
  for (const [year, month] of [prev, [Number(y), Number(m)]]) {
    let url = `${MOLLIE_API}/settlements?${new URLSearchParams({ year: String(year), month: String(month), currencies: currency, limit: String(PAGE_LIMIT) })}`;
    for (let page = 1; page <= MAX_PAGES; page++) {
      const data = await fetchJson(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/hal+json' } }, BRAND, fetchImpl);
      const rows = Array.isArray(data?._embedded?.settlements) ? data._embedded.settlements : [];
      for (const s of rows) {
        const id = String(s?.id ?? '');
        if (s?.status !== 'paidout' || seen.has(id)) continue;
        const paidOn = s.settledAt ? OSLO_DAY.format(Date.parse(String(s.settledAt)) || 0) : '';
        if (paidOn < bounds.start || paidOn > bounds.lastDay) continue;
        const amountMinor = minorOf(s.amount);
        if (amountMinor <= 0) continue;
        seen.add(id);
        const volume = sumPeriods(s.periods, 'revenue', 'amountGross');
        const costs = sumPeriods(s.periods, 'costs', 'amountGross');
        payouts.push({
          id: `mollie-${id}`,
          date: paidOn,
          amountMinor,
          currency: String(s.amount?.currency ?? '').toUpperCase(),
          feeMinor: Math.abs(costs),
          reference: String(s.reference ?? '').trim() || id,
          detail: `Settlement ${id} · payment volume ${(volume / 100).toFixed(2)}, costs ${(Math.abs(costs) / 100).toFixed(2)}${s.invoiceId ? ` · invoice ${String(s.invoiceId)}` : ''}`,
        });
      }
      const next = typeof data?._links?.next?.href === 'string' ? data._links.next.href : '';
      if (!next || rows.length === 0) break;
      if (!next.startsWith(`${MOLLIE_API}/settlements?`)) throw new HttpError(502, 'Mollie returned an unexpected pagination link.');
      url = next;
    }
  }
  return payouts;
}

/** @returns {{ payouts: PayoutItem[], bankTx: BankTx[], month: string, currency: string }} */
function sampleData() {
  return {
    month: '2026-10',
    currency: 'NOK',
    payouts: [
      { id: 'mollie-stl_jDk30akdN', date: '2026-10-06', amountMinor: 1842050, feeMinor: 31450, currency: 'NOK', reference: '1234567.2610.01', detail: 'Settlement stl_jDk30akdN · payment volume 18735.00, costs 314.50' },
      { id: 'mollie-stl_xRt82kQpa', date: '2026-10-20', amountMinor: 2210300, feeMinor: 38200, currency: 'NOK', reference: '1234567.2610.02', detail: 'Settlement stl_xRt82kQpa · payment volume 22485.00, costs 382.00' },
    ],
    bankTx: [
      { id: 9201, amount: 18420.5, currencyCode: 'NOK', transactionDate: '2026-10-07', description: 'MOLLIE B.V. 1234567.2610.01', paymentReference: '1234567.2610.01' },
    ],
  };
}

/**
 * @param {{ rows: ReconcileRow[], month: string, currency: string, bankCount: number, isSample?: boolean }} state
 */
function renderReview(state) {
  const { rows, month, currency, bankCount } = state;
  const matched = rows.filter((r) => r.match !== null).length;
  const totalNet = rows.reduce((s, r) => s + r.payout.amountMinor, 0);
  const totalFees = rows.reduce((s, r) => s + (r.payout.feeMinor ?? 0), 0);
  const csvRows = [
    ['provider', 'reference', 'payout_date', 'payout_amount', 'fees', 'currency', 'match_status', 'reai_bank_transaction_id', 'detail'],
    ...rows.map((r) => [BRAND, r.payout.reference, r.payout.date, (r.payout.amountMinor / 100).toFixed(2), ((r.payout.feeMinor ?? 0) / 100).toFixed(2), r.payout.currency, r.status, r.match ? String(r.match.id) : '', r.payout.detail]),
  ];
  return reaiCard({
    eyebrow: 'RECONCILIATION PREVIEW',
    title: `${BRAND} · ${month}`,
    badge: state.isSample
      ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' })
      : reaiBadge({ text: `${matched}/${rows.length} matched`, tone: matched === rows.length && rows.length > 0 ? 'success' : 'warn' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Payouts', value: String(rows.length), detail: `${currency} settlements only` })}
        ${reaiMetric({ label: 'Paid out', value: `${formatMinor(totalNet)} ${currency}`, detail: `${bankCount} pending ReAI bank rows` })}
        ${reaiMetric({ label: 'Mollie costs', value: `${formatMinor(totalFees)} ${currency}`, detail: 'Costs in the settlement periods' })}
      </div>
      ${rows.length === 0
        ? reaiCallout({ tone: 'info', body: `No ${currency} Mollie settlements paid out for ${month}.` })
        : html`
          <div class="table-wrap"><table class="data-table">
            <thead><tr><th>Paid out</th><th>Reference</th><th class="num">Amount</th><th class="num">Fees</th><th>Bank match</th><th>ReAI bank row</th><th>Details</th></tr></thead>
            <tbody>${rows.map((r) => html`<tr>
              <td class="mono">${r.payout.date}</td><td class="mono">${r.payout.reference}</td>
              <td class="num">${formatMinor(r.payout.amountMinor)} ${r.payout.currency}</td>
              <td class="num">${formatMinor(r.payout.feeMinor ?? 0)}</td>
              <td>${reaiBadge({ text: r.status, tone: r.match ? 'success' : 'warn' })}</td>
              <td class="mono">${r.match ? `#${r.match.id} (${r.match.transactionDate})` : 'None'}</td>
              <td>${r.payout.detail}</td>
            </tr>`)}</tbody>
          </table></div>
          <form class="stack-sm" method="post" action="${BASE}/export">
            <input type="hidden" name="filename" value="mollie-reconciliation-${month}.csv">
            <input type="hidden" name="rowsJson" value="${JSON.stringify(csvRows)}">
            <div><button type="submit" class="button secondary">Download reconciliation CSV</button></div>
          </form>
        `}
    `,
  });
}

/**
 * Handles /app/mollie/* routes.
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
        ${renderConnectPanel(session, { clientId: 'reai-mollie-web', clientName: 'ReAI Mollie Reconcile (Web)' })}
        ${reaiCard({
          eyebrow: 'MOLLIE SETTLEMENTS API',
          title: 'Fetch Mollie settlements',
          body: html`
            <p class="muted-note">An admin creates an advanced access token in the Mollie dashboard under Developers, API keys, with the settlements.read permission. The token is used only for this request and is never stored.</p>
            <form class="stack" hx-post="${BASE}/review" hx-target="#mollie-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="mollie-token">Advanced access token</label><input id="mollie-token" name="token" type="password" autocomplete="off" required placeholder="access_..."></div>
                <div class="field"><label for="mollie-month">Payout month</label><input id="mollie-month" name="month" type="text" pattern="[0-9]{4}-[0-9]{2}" value="${currentMonthIso()}" required placeholder="YYYY-MM"></div>
                <div class="field"><label for="mollie-bank">ReAI bank account</label><select id="mollie-bank" name="bankId"><option value="0">${banks.length > 0 ? 'Select bank account' : 'Connect to ReAI to load banks'}</option>${banks.map((b) => html`<option value="${b.id}">${b.displayName} (${b.ledgerAccountNumber} · ${b.currencyCode})</option>`)}</select></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Review Mollie settlements</button>
                <button type="button" class="button secondary" hx-post="${BASE}/sample" hx-target="#mollie-output" hx-swap="innerHTML">Load sample review</button>
              </div>
            </form>
          `,
        })}
        <div id="mollie-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${BASE}/sample`) {
    const s = sampleData();
    return htmlResponse(renderReview({ rows: matchPayouts(s.payouts, s.bankTx), month: s.month, currency: s.currency, bankCount: s.bankTx.length, isSample: true }));
  }

  if (pathname === `${BASE}/export`) {
    const form = await request.formData();
    const rows = /** @type {string[][]} */ (JSON.parse(String(form.get('rowsJson') ?? '[]')));
    return csvAttachment(String(form.get('filename') ?? 'mollie-reconciliation.csv'), rows);
  }

  if (pathname === `${BASE}/review`) {
    try {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const company = session.tenants.find((t) => t.id === session.tenantId);
      if (!company) throw new HttpError(400, 'Select a valid ReAI company.');
      const form = await request.formData();
      const month = String(form.get('month') ?? '').trim();
      const bounds = monthBounds(month);
      const bankId = Number(form.get('bankId') ?? '0');
      const [fetched, bankTx] = await Promise.all([
        fetchApi({ token: String(form.get('token') ?? ''), month, currency: company.currencyCode }),
        bankId > 0 ? loadPendingBankTransactions(env, session, bankId, bounds.month) : Promise.resolve([]),
      ]);
      const matching = fetched.filter((p) => p.currency === company.currencyCode).sort((a, b) => b.date.localeCompare(a.date));
      return htmlResponse(renderReview({ rows: matchPayouts(matching, bankTx), month: bounds.month, currency: company.currencyCode, bankCount: bankTx.length }));
    } catch (err) {
      return htmlResponse(reaiCallout({ tone: 'danger', title: `Could not review ${BRAND}`, body: err instanceof Error ? err.message : 'Review failed.' }));
    }
  }

  return errorResponse('Unknown Mollie route.', 404);
}
