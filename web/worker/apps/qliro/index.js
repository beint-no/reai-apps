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

const SLUG = 'qliro';
const BRAND = 'Qliro';
const TITLE = 'Qliro Checkout Settlement Reconcile';
const LEAD = 'Compare Qliro Checkout settlement batches with pending ReAI bank transactions for one month and export a reconciliation CSV.';
const BASE = `/app/${SLUG}`;

const QLIRO_ADMIN_API = 'https://payments.qit.nu/checkout/adminapi';

/**
 * Qliro Authorization header: "Qliro " + base64(SHA-256(requestBody + apiSecret)); a GET request has an empty body.
 * @param {string} body
 * @param {string} secret
 * @returns {Promise<string>}
 */
async function qliroAuthorization(body, secret) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${body}${secret}`)));
  let bin = '';
  for (const b of digest) bin += String.fromCharCode(b);
  return `Qliro ${btoa(bin)}`;
}

/** @param {string} isoDay */
const qliroDate = (isoDay) => isoDay.replaceAll('-', '/');

/**
 * Fetches Qliro Checkout settlement batches (one per bank transfer) for a month.
 * Docs:
 * - https://developers.qliro.com/docs/qliro-checkout/settlements (recommended flow: list batches, then batch details)
 * - https://developers.qliro.com/docs/api (Admin API v2: GET /v2/settlements/GetSettlementBatches, FromBatchDate/ToBatchDate yyyy/mm/dd,
 *   optional CurrencyCode filter; SettlementBatches[].Id, BatchId, AcquirerName, BatchDate, CurrencyCode, TotalAmount, TotalFeeAmount).
 *   The response is one unpaged list for the period.
 * - Production host and the "Qliro" SHA-256 Authorization scheme as used by Qliro's open-source checkout clients
 *   (https://github.com/krokedil/qliro-one-for-woocommerce, classes/requests/class-qliro-one-request.php).
 * @param {Record<string, string>} creds `apiSecret`, `month` (YYYY-MM), optional `currency` (ISO 4217, filtered by Qliro)
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<PayoutItem[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const apiSecret = (creds.apiSecret ?? '').trim();
  if (!apiSecret) throw new HttpError(400, 'Enter the Qliro API secret.');
  const bounds = monthBounds((creds.month ?? '').trim());
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const lastDay = bounds.lastDay < yesterday ? bounds.lastDay : yesterday;
  if (bounds.start > lastDay) throw new HttpError(400, 'Qliro settles only past dates. Choose a month that has started before today.');

  const query = new URLSearchParams({ FromBatchDate: qliroDate(bounds.start), ToBatchDate: qliroDate(lastDay) });
  const currency = (creds.currency ?? '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(currency)) query.set('CurrencyCode', currency);
  const data = await fetchJson(
    `${QLIRO_ADMIN_API}/v2/settlements/GetSettlementBatches?${query}`,
    { headers: { authorization: await qliroAuthorization('', apiSecret), accept: 'application/json', 'content-type': 'application/json' } },
    BRAND,
    fetchImpl,
  );
  /** @type {PayoutItem[]} */
  const payouts = [];
  for (const b of Array.isArray(data?.SettlementBatches) ? data.SettlementBatches : []) {
    const amountMinor = Math.round(num(b?.TotalAmount) * 100);
    const date = String(b?.BatchDate ?? '').slice(0, 10);
    if (amountMinor <= 0 || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) continue;
    const batchId = String(b.BatchId ?? b.Id ?? '').trim();
    payouts.push({
      id: `qliro-${b.Id ?? batchId}`,
      date,
      amountMinor,
      currency: String(b.CurrencyCode ?? '').toUpperCase(),
      feeMinor: Math.round(Math.abs(num(b.TotalFeeAmount)) * 100),
      reference: batchId,
      detail: `${String(b.AcquirerName ?? 'Qliro')} batch ${batchId} (Qliro id ${b.Id ?? '?'})`,
    });
  }
  return payouts;
}

/** @returns {{ payouts: PayoutItem[], bankTx: BankTx[], month: string, currency: string }} */
function sampleData() {
  return {
    month: '2026-10',
    currency: 'NOK',
    payouts: [
      { id: 'qliro-7001', date: '2026-10-07', amountMinor: 3185000, feeMinor: 47800, currency: 'NOK', reference: 'QB-26100701', detail: 'Qliro batch QB-26100701 (Qliro id 7001)' },
      { id: 'qliro-7002', date: '2026-10-07', amountMinor: 742350, feeMinor: 11200, currency: 'NOK', reference: 'NETS-889120', detail: 'Nets batch NETS-889120 (Qliro id 7002)' },
      { id: 'qliro-7003', date: '2026-10-21', amountMinor: 2290400, feeMinor: 34300, currency: 'NOK', reference: 'QB-26102101', detail: 'Qliro batch QB-26102101 (Qliro id 7003)' },
    ],
    bankTx: [
      { id: 9301, amount: 31850.0, currencyCode: 'NOK', transactionDate: '2026-10-08', description: 'QLIRO AB QB-26100701', paymentReference: 'QB-26100701' },
      { id: 9302, amount: 7423.5, currencyCode: 'NOK', transactionDate: '2026-10-08', description: 'NETS oppgjør', paymentReference: null },
    ],
  };
}

/**
 * @param {{ rows: ReconcileRow[], month: string, currency: string, excluded: number, bankCount: number, isSample?: boolean }} state
 */
function renderReview(state) {
  const { rows, month, currency, excluded, bankCount } = state;
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
        ${reaiMetric({ label: 'Payouts', value: String(rows.length), detail: `${excluded} in other currencies excluded` })}
        ${reaiMetric({ label: 'Paid out', value: `${formatMinor(totalNet)} ${currency}`, detail: `${bankCount} pending ReAI bank rows` })}
        ${reaiMetric({ label: 'Qliro fees', value: `${formatMinor(totalFees)} ${currency}`, detail: 'TotalFeeAmount per batch' })}
      </div>
      ${rows.length === 0
        ? reaiCallout({ tone: 'info', body: `No ${currency} Qliro payouts found for ${month}.` })
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
            <input type="hidden" name="filename" value="qliro-reconciliation-${month}.csv">
            <input type="hidden" name="rowsJson" value="${JSON.stringify(csvRows)}">
            <div><button type="submit" class="button secondary">Download reconciliation CSV</button></div>
          </form>
        `}
    `,
  });
}

/**
 * Handles /app/qliro/* routes.
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
        ${renderConnectPanel(session, { clientId: 'reai-qliro-web', clientName: 'ReAI Qliro Reconcile (Web)' })}
        ${reaiCard({
          eyebrow: 'QLIRO ADMIN API',
          title: 'Fetch Qliro settlement batches',
          body: html`
            <p class="muted-note">Use the production API secret Qliro issued for your Qliro Checkout store. The secret only signs this request and is never sent or stored.</p>
            <form class="stack" hx-post="${BASE}/review" hx-target="#qliro-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                                <div class="field"><label for="qliro-secret">API secret</label><input id="qliro-secret" name="apiSecret" type="password" autocomplete="off" required placeholder="Qliro API secret"></div>
                <div class="field"><label for="qliro-month">Payout month</label><input id="qliro-month" name="month" type="text" pattern="[0-9]{4}-[0-9]{2}" value="${currentMonthIso()}" required placeholder="YYYY-MM"></div>
                <div class="field"><label for="qliro-bank">ReAI bank account</label><select id="qliro-bank" name="bankId"><option value="0">${banks.length > 0 ? 'Select bank account' : 'Connect to ReAI to load banks'}</option>${banks.map((b) => html`<option value="${b.id}">${b.displayName} (${b.ledgerAccountNumber} · ${b.currencyCode})</option>`)}</select></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Review Qliro payouts</button>
                <button type="button" class="button secondary" hx-post="${BASE}/sample" hx-target="#qliro-output" hx-swap="innerHTML">Load sample review</button>
              </div>
            </form>
          `,
        })}
        <div id="qliro-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${BASE}/sample`) {
    const s = sampleData();
    return htmlResponse(renderReview({ rows: matchPayouts(s.payouts, s.bankTx), month: s.month, currency: s.currency, excluded: 0, bankCount: s.bankTx.length, isSample: true }));
  }

  if (pathname === `${BASE}/export`) {
    const form = await request.formData();
    const rows = /** @type {string[][]} */ (JSON.parse(String(form.get('rowsJson') ?? '[]')));
    return csvAttachment(String(form.get('filename') ?? 'qliro-reconciliation.csv'), rows);
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
        fetchApi({ apiSecret: String(form.get('apiSecret') ?? ''), month, currency: company.currencyCode }),
        bankId > 0 ? loadPendingBankTransactions(env, session, bankId, bounds.month) : Promise.resolve([]),
      ]);
      const matching = fetched.filter((p) => p.currency === company.currencyCode).sort((a, b) => b.date.localeCompare(a.date));
      return htmlResponse(renderReview({ rows: matchPayouts(matching, bankTx), month: bounds.month, currency: company.currencyCode, excluded: fetched.length - matching.length, bankCount: bankTx.length }));
    } catch (err) {
      return htmlResponse(reaiCallout({ tone: 'danger', title: `Could not review ${BRAND}`, body: err instanceof Error ? err.message : 'Review failed.' }));
    }
  }

  return errorResponse('Unknown Qliro route.', 404);
}
