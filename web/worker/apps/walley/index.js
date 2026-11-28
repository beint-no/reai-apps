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

const SLUG = 'walley';
const BRAND = 'Walley';
const TITLE = 'Walley Settlement Reconcile';
const LEAD = 'Compare Walley settlement payouts with pending ReAI bank transactions for one month and export a reconciliation CSV.';
const BASE = `/app/${SLUG}`;

const WALLEY_API = 'https://api.walleypay.com';
const WALLEY_PROD_SCOPE = 'a3f3019f-2be9-41cc-a254-7bb347238e89/.default';

/**
 * @param {string} isoDay
 * @param {number} days
 * @returns {string}
 */
function shiftDays(isoDay, days) {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Fetches Walley settlements paid out in one month through the Reports API.
 * Docs:
 * - https://dev.walleypay.com/docs/reports/authentication (OAuth2 client credentials, production scope)
 * - https://dev.walleypay.com/docs/reports/endpoints (https://api.walleypay.com)
 * - https://dev.walleypay.com/docs/reports/settlements-api/search (GET /reports/settlements, query/page/perPage)
 * @param {Record<string, string>} creds `clientId`, `clientSecret`, `month` (YYYY-MM)
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<PayoutItem[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const clientId = (creds.clientId ?? '').trim();
  const clientSecret = (creds.clientSecret ?? '').trim();
  if (!clientId || !clientSecret) throw new HttpError(400, 'Enter the Walley client ID and secret.');
  const bounds = monthBounds((creds.month ?? '').trim());

  const tok = await fetchJson(
    `${WALLEY_API}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials', scope: WALLEY_PROD_SCOPE }).toString(),
    },
    BRAND,
    fetchImpl,
  );
  const accessToken = typeof tok?.access_token === 'string' ? tok.access_token : '';
  if (!accessToken) throw new HttpError(400, 'Walley did not return an access token.');

  // Settlement periods start before the payout date; widen the search and filter on paidOutAt.
  const query = `startDate:>=${shiftDays(bounds.start, -45)} AND endDate:<=${bounds.lastDay}`;
  /** @type {PayoutItem[]} */
  const payouts = [];
  for (let page = 1; page <= 20; page++) {
    const data = await fetchJson(
      `${WALLEY_API}/reports/settlements?query=${encodeURIComponent(query)}&page=${page}&perPage=100`,
      { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } },
      BRAND,
      fetchImpl,
    );
    const rows = Array.isArray(data?.data) ? data.data : [];
    for (const s of rows) {
      const paidOn = String(s?.paidOutAt ?? '').slice(0, 10);
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(paidOn) || paidOn < bounds.start || paidOn > bounds.lastDay) continue;
      const amountMinor = Math.round(num(s.totalAmount) * 100);
      if (amountMinor <= 0) continue;
      const id = String(s.id ?? '');
      payouts.push({
        id: `walley-${id}`,
        date: paidOn,
        amountMinor,
        currency: String(s.currency ?? '').toUpperCase(),
        feeMinor: Math.round(Math.abs(num(s.compensations)) * 100),
        reference: String(s.reference ?? '').trim() || id,
        detail: `Store ${s.storeId ?? '?'} · ${String(s.startDate ?? '').slice(0, 10)} to ${String(s.endDate ?? '').slice(0, 10)} · captured ${num(s.captured).toFixed(2)}, refunded ${num(s.refunded).toFixed(2)}`,
      });
    }
    const pages = Number(data?.metaData?.numberOfPages ?? 1);
    if (rows.length === 0 || page >= pages) break;
  }
  return payouts;
}

/** @returns {{ payouts: PayoutItem[], bankTx: BankTx[], month: string, currency: string }} */
function sampleData() {
  return {
    month: '2026-10',
    currency: 'NOK',
    payouts: [
      { id: 'walley-501', date: '2026-10-05', amountMinor: 2418050, feeMinor: 41200, currency: 'NOK', reference: '4100501', detail: 'Store 1001 · 2026-09-28 to 2026-10-04 · captured 24 890.50, refunded 0.00' },
      { id: 'walley-502', date: '2026-10-12', amountMinor: 1873400, feeMinor: 32600, currency: 'NOK', reference: '4100502', detail: 'Store 1001 · 2026-10-05 to 2026-10-11 · captured 19 520.00, refunded 460.00' },
      { id: 'walley-503', date: '2026-10-19', amountMinor: 2104900, feeMinor: 35900, currency: 'NOK', reference: '4100503', detail: 'Store 1001 · 2026-10-12 to 2026-10-18 · captured 21 408.00, refunded 0.00' },
    ],
    bankTx: [
      { id: 9101, amount: 24180.5, currencyCode: 'NOK', transactionDate: '2026-10-06', description: 'WALLEY AB 4100501', paymentReference: '4100501' },
      { id: 9102, amount: 18734.0, currencyCode: 'NOK', transactionDate: '2026-10-13', description: 'WALLEY AB oppgjør', paymentReference: null },
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
        ${reaiMetric({ label: 'Walley fees', value: `${formatMinor(totalFees)} ${currency}`, detail: 'Compensations in the settlements' })}
      </div>
      ${rows.length === 0
        ? reaiCallout({ tone: 'info', body: `No ${currency} Walley payouts found for ${month}.` })
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
            <input type="hidden" name="filename" value="walley-reconciliation-${month}.csv">
            <input type="hidden" name="rowsJson" value="${JSON.stringify(csvRows)}">
            <div><button type="submit" class="button secondary">Download reconciliation CSV</button></div>
          </form>
        `}
    `,
  });
}

/**
 * Handles /app/walley/* routes.
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
        ${renderConnectPanel(session, { clientId: 'reai-walley-web', clientName: 'ReAI Walley Reconcile (Web)' })}
        ${reaiCard({
          eyebrow: 'WALLEY REPORTS API',
          title: 'Fetch Walley settlements',
          body: html`
            <p class="muted-note">Create an API key in Walley Merchant Hub under your name, Manage Organization, Create new, Api key. The client ID and secret are used only for this request and are never stored.</p>
            <form class="stack" hx-post="${BASE}/review" hx-target="#walley-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="walley-client">Client ID</label><input id="walley-client" name="clientId" type="text" autocomplete="off" required placeholder="Merchant Hub client ID"></div>
                <div class="field"><label for="walley-secret">Client secret</label><input id="walley-secret" name="clientSecret" type="password" autocomplete="off" required placeholder="Merchant Hub secret"></div>
                <div class="field"><label for="walley-month">Payout month</label><input id="walley-month" name="month" type="text" pattern="[0-9]{4}-[0-9]{2}" value="${currentMonthIso()}" required placeholder="YYYY-MM"></div>
                <div class="field"><label for="walley-bank">ReAI bank account</label><select id="walley-bank" name="bankId"><option value="0">${banks.length > 0 ? 'Select bank account' : 'Connect to ReAI to load banks'}</option>${banks.map((b) => html`<option value="${b.id}">${b.displayName} (${b.ledgerAccountNumber} · ${b.currencyCode})</option>`)}</select></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Review Walley payouts</button>
                <button type="button" class="button secondary" hx-post="${BASE}/sample" hx-target="#walley-output" hx-swap="innerHTML">Load sample review</button>
              </div>
            </form>
          `,
        })}
        <div id="walley-output" class="stack"></div>
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
    return csvAttachment(String(form.get('filename') ?? 'walley-reconciliation.csv'), rows);
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
        fetchApi({ clientId: String(form.get('clientId') ?? ''), clientSecret: String(form.get('clientSecret') ?? ''), month }),
        bankId > 0 ? loadPendingBankTransactions(env, session, bankId, bounds.month) : Promise.resolve([]),
      ]);
      const matching = fetched.filter((p) => p.currency === company.currencyCode).sort((a, b) => b.date.localeCompare(a.date));
      return htmlResponse(renderReview({ rows: matchPayouts(matching, bankTx), month: bounds.month, currency: company.currencyCode, excluded: fetched.length - matching.length, bankCount: bankTx.length }));
    } catch (err) {
      return htmlResponse(reaiCallout({ tone: 'danger', title: `Could not review ${BRAND}`, body: err instanceof Error ? err.message : 'Review failed.' }));
    }
  }

  return errorResponse('Unknown Walley route.', 404);
}
