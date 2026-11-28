// @ts-check
import { assertPublicHttpsUrl, fetchJson, num } from '../../lib/api-http.js';
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

const SLUG = 'mirakl';
const BRAND = 'Mirakl';
const TITLE = 'Mirakl Marketplace Payout Reconcile';
const LEAD = 'Compare payouts from a Mirakl marketplace, such as Elkjøp Marketplace, with pending ReAI bank transactions for one month and export a reconciliation CSV with orders and commissions.';
const BASE = `/app/${SLUG}`;

const PAGE_LIMIT = 100;
const MAX_PAGES = 5;
const OSLO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** @param {unknown} v */
function minor(v) {
  return Math.round(num(v) * 100);
}

/** @param {string} day @param {number} days */
function shiftDays(day, days) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Normalises the marketplace address the seller logs in to into an API origin.
 * @param {string} raw
 */
function instanceOrigin(raw) {
  const value = raw.trim();
  if (!value) throw new HttpError(400, 'Enter the address of the Mirakl marketplace, for example https://elkjop-prod.mirakl.net.');
  return assertPublicHttpsUrl(/^https?:\/\//i.test(value) ? value : `https://${value}`).origin;
}

/**
 * Fetches paid Mirakl seller billing cycles (payouts) for one month.
 * Docs:
 * - https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/invoicing-and-accounting/sbc11.md
 *   (SBC11 GET /api/seller-billing-cycles: start_date/end_date date-time on creation, pay_out_state, limit max 1000,
 *   next_page_token; fields amount_transferred_to_seller, currency_iso_code, pay_out{state, reference, transaction_date},
 *   payment_voucher_number, summary totals)
 * - https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3.md (Shop-API-Key in the Authorization header)
 * @param {Record<string, string>} creds `instance`, `apiKey`, `month` (YYYY-MM), `shopId` (optional)
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<PayoutItem[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const origin = instanceOrigin(creds.instance ?? '');
  const apiKey = (creds.apiKey ?? '').trim();
  if (!apiKey) throw new HttpError(400, 'Enter the shop API key from the Mirakl seller back office.');
  const shopId = (creds.shopId ?? '').trim();
  if (shopId && !/^[0-9]+$/.test(shopId)) throw new HttpError(400, 'The shop id is a number.');
  const bounds = monthBounds((creds.month ?? '').trim());
  const headers = { authorization: apiKey, accept: 'application/json' };

  // Billing cycles are created before they are paid out, so the creation window starts 45 days earlier.
  const first = new URLSearchParams({ start_date: `${shiftDays(bounds.start, -45)}T00:00:00Z`, end_date: `${bounds.lastDay}T23:59:59Z`, pay_out_state: 'PAID', limit: String(PAGE_LIMIT) });
  if (shopId) first.set('shop_id', shopId);
  /** @type {PayoutItem[]} */
  const payouts = [];
  let query = first;
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES) throw new HttpError(400, 'Mirakl returned more billing cycles than expected. Enter the shop id to narrow the search.');
    const data = await fetchJson(`${origin}/api/seller-billing-cycles?${query}`, { headers }, BRAND, fetchImpl);
    const rows = Array.isArray(data?.data) ? data.data : [];
    for (const c of rows) {
      if (c?.pay_out?.state !== 'PAID') continue;
      const when = String(c.pay_out?.transaction_date ?? c.date_created ?? '');
      const paidOn = when ? OSLO_DAY.format(Date.parse(when) || 0) : '';
      if (paidOn < bounds.start || paidOn > bounds.lastDay) continue;
      const amountMinor = minor(c.amount_transferred_to_seller);
      if (amountMinor <= 0) continue;
      const s = c.summary ?? {};
      const commissions = -(minor(s.total_commissions_incl_tax) + minor(s.total_refund_commissions_incl_tax));
      const orders = minor(s.total_payable_orders_incl_tax) + minor(s.total_refund_payable_orders_incl_tax);
      const id = String(c.id ?? '');
      payouts.push({
        id: `mirakl-${id}`,
        date: paidOn,
        amountMinor,
        currency: String(c.currency_iso_code ?? '').toUpperCase(),
        feeMinor: Math.abs(commissions),
        reference: String(c.pay_out?.reference ?? '').trim() || String(c.payment_voucher_number ?? '').trim() || id,
        detail: `${String(c.shop?.shop_name ?? 'Shop')} · cycle ${id} · orders incl. VAT ${(orders / 100).toFixed(2)} · commissions ${(Math.abs(commissions) / 100).toFixed(2)}${c.payment_voucher_number ? ` · voucher ${String(c.payment_voucher_number)}` : ''}`,
      });
    }
    const token = typeof data?.next_page_token === 'string' ? data.next_page_token : '';
    if (!token || rows.length === 0) break;
    // With page_token the other parameters are ignored; the token carries them.
    query = new URLSearchParams({ page_token: token });
  }
  return payouts;
}

/** @returns {{ payouts: PayoutItem[], bankTx: BankTx[], month: string, currency: string }} */
function sampleData() {
  return {
    month: '2026-10',
    currency: 'NOK',
    payouts: [
      { id: 'mirakl-a5b77ee5', date: '2026-10-08', amountMinor: 4545200, feeMinor: 829320, currency: 'NOK', reference: 'bank-ref-1008', detail: 'Nordic Gear · cycle a5b77ee5 · orders incl. VAT 53745.20 · commissions 8293.20' },
      { id: 'mirakl-b61c02aa', date: '2026-10-22', amountMinor: 3120000, feeMinor: 560000, currency: 'NOK', reference: 'bank-ref-1022', detail: 'Nordic Gear · cycle b61c02aa · orders incl. VAT 36800.00 · commissions 5600.00' },
    ],
    bankTx: [
      { id: 9301, amount: 45452.0, currencyCode: 'NOK', transactionDate: '2026-10-09', description: 'ELKJOP NORDIC bank-ref-1008', paymentReference: 'bank-ref-1008' },
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
        ${reaiMetric({ label: 'Commissions', value: `${formatMinor(totalFees)} ${currency}`, detail: 'Net of refunded commissions, incl. VAT' })}
      </div>
      ${rows.length === 0
        ? reaiCallout({ tone: 'info', body: `No ${currency} Mirakl payouts for ${month}.` })
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
            <input type="hidden" name="filename" value="mirakl-reconciliation-${month}.csv">
            <input type="hidden" name="rowsJson" value="${JSON.stringify(csvRows)}">
            <div><button type="submit" class="button secondary">Download reconciliation CSV</button></div>
          </form>
        `}
    `,
  });
}

/**
 * Handles /app/mirakl/* routes.
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
        ${renderConnectPanel(session, { clientId: 'reai-mirakl-web', clientName: 'ReAI Mirakl Reconcile (Web)' })}
        ${reaiCard({
          eyebrow: 'MIRAKL SELLER API',
          title: 'Fetch Mirakl payouts',
          body: html`
            <p class="muted-note">Generate the shop API key in the marketplace's Mirakl seller back office under your user settings. Enter the marketplace address you sign in to. The key is used only for this request and is never stored.</p>
            <form class="stack" hx-post="${BASE}/review" hx-target="#mirakl-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="mirakl-instance">Marketplace address</label><input id="mirakl-instance" name="instance" type="url" required placeholder="https://elkjop-prod.mirakl.net"></div>
                <div class="field"><label for="mirakl-key">Shop API key</label><input id="mirakl-key" name="apiKey" type="password" autocomplete="off" required></div>
                <div class="field"><label for="mirakl-shop">Shop id (optional)</label><input id="mirakl-shop" name="shopId" type="text" placeholder="Only for several shops"></div>
                <div class="field"><label for="mirakl-month">Payout month</label><input id="mirakl-month" name="month" type="text" pattern="[0-9]{4}-[0-9]{2}" value="${currentMonthIso()}" required placeholder="YYYY-MM"></div>
                <div class="field"><label for="mirakl-bank">ReAI bank account</label><select id="mirakl-bank" name="bankId"><option value="0">${banks.length > 0 ? 'Select bank account' : 'Connect to ReAI to load banks'}</option>${banks.map((b) => html`<option value="${b.id}">${b.displayName} (${b.ledgerAccountNumber} · ${b.currencyCode})</option>`)}</select></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Review Mirakl payouts</button>
                <button type="button" class="button secondary" hx-post="${BASE}/sample" hx-target="#mirakl-output" hx-swap="innerHTML">Load sample review</button>
              </div>
            </form>
          `,
        })}
        <div id="mirakl-output" class="stack"></div>
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
    return csvAttachment(String(form.get('filename') ?? 'mirakl-reconciliation.csv'), rows);
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
        fetchApi({ instance: String(form.get('instance') ?? ''), apiKey: String(form.get('apiKey') ?? ''), shopId: String(form.get('shopId') ?? ''), month }),
        bankId > 0 ? loadPendingBankTransactions(env, session, bankId, bounds.month) : Promise.resolve([]),
      ]);
      const matching = fetched.filter((p) => p.currency === company.currencyCode).sort((a, b) => b.date.localeCompare(a.date));
      return htmlResponse(renderReview({ rows: matchPayouts(matching, bankTx), month: bounds.month, currency: company.currencyCode, bankCount: bankTx.length }));
    } catch (err) {
      return htmlResponse(reaiCallout({ tone: 'danger', title: `Could not review ${BRAND}`, body: err instanceof Error ? err.message : 'Review failed.' }));
    }
  }

  return errorResponse('Unknown Mirakl route.', 404);
}
