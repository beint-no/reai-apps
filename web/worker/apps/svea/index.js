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

const SLUG = 'svea';
const BRAND = 'Svea';
const TITLE = 'Svea Checkout Settlement Reconcile';
const LEAD = 'Compare daily Svea Checkout payouts with pending ReAI bank transactions for one month and export a reconciliation CSV.';
const BASE = `/app/${SLUG}`;

const SVEA_ADMIN_API = 'https://paymentadminapi.svea.com';

/**
 * Svea Payment Admin API Authorization header: "Svea " + base64("{merchantId}:{SHA512 hex upper of body+secret+timestamp}").
 * @param {string} merchantId
 * @param {string} secret
 * @param {string} timestamp `yyyy-MM-dd HH:mm:ss` in UTC
 * @returns {Promise<string>}
 */
async function sveaAuthorization(merchantId, secret, timestamp) {
  const digest = await crypto.subtle.digest('SHA-512', new TextEncoder().encode(`${secret}${timestamp}`));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `Svea ${btoa(`${merchantId}:${hex}`)}`;
}

/**
 * Fetches Svea reconciliation reports (one per payout date) for every settled day of a month.
 * Docs:
 * - https://paymentsdocs.svea.com/docs/manage-order/reports/ (GET /api/v2/reports?date=&includeWithholding=, response fields)
 * - https://paymentsdocs.svea.com/docs/getting-started/authentication/ (Authorization + Timestamp headers)
 * - https://paymentsdocs.svea.com/docs/getting-started/before-you-start/ (production host paymentadminapi.svea.com, minor units)
 * @param {Record<string, string>} creds `merchantId`, `secret`, `month` (YYYY-MM)
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<PayoutItem[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const merchantId = (creds.merchantId ?? '').trim();
  const secret = (creds.secret ?? '').trim();
  if (!/^[0-9]+$/.test(merchantId) || !secret) throw new HttpError(400, 'Enter the numeric Svea Checkout merchant ID and the secret key.');
  const bounds = monthBounds((creds.month ?? '').trim());
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const lastDay = bounds.lastDay < yesterday ? bounds.lastDay : yesterday;
  if (bounds.start > lastDay) throw new HttpError(400, 'Svea reports exist only for past dates. Choose a month that has started before today.');

  /** @type {string[]} */
  const days = [];
  for (let d = new Date(`${bounds.start}T00:00:00Z`); d.toISOString().slice(0, 10) <= lastDay; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  // The API answers 404 when no report was generated for a date (no payout); treat that as an empty day.
  // 400 means a bad date or that reconciliation reports are not activated for the merchant.
  /** @type {import('../../lib/api-http.js').FetchLike} */
  const tolerant404 = async (input, init) => {
    const res = await fetchImpl(input, init);
    if (res.status === 400) throw new HttpError(400, 'Svea refused the report request. Ask Svea to activate reconciliation reports for this merchant ID.');
    return res.status === 404 ? new Response('{"clientReports":[]}', { status: 200, headers: { 'content-type': 'application/json' } }) : res;
  };

  /** @type {PayoutItem[]} */
  const payouts = [];
  for (let i = 0; i < days.length; i += 6) {
    const batch = days.slice(i, i + 6);
    const reports = await Promise.all(batch.map(async (day) => {
      const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const data = await fetchJson(
        `${SVEA_ADMIN_API}/api/v2/reports?date=${day}&includeWithholding=true`,
        { headers: { authorization: await sveaAuthorization(merchantId, secret, timestamp), timestamp, accept: 'application/json' } },
        BRAND,
        tolerant404,
      );
      return { day, data };
    }));
    for (const { day, data } of reports) {
      for (const client of Array.isArray(data?.clientReports) ? data.clientReports : []) {
        const report = client?.paymentReport ?? {};
        const amountMinor = Math.round(num(report.sveaPaidAmountIncludingWithholding));
        if (amountMinor <= 0) continue;
        const date = /^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(String(client.reconciliationDate ?? '')) ? String(client.reconciliationDate).slice(0, 10) : day;
        const clientId = String(client.clientId ?? merchantId);
        payouts.push({
          id: `svea-${clientId}-${date}`,
          date,
          amountMinor,
          currency: String(report.currency ?? '').toUpperCase(),
          feeMinor: Math.round(Math.abs(num(report.feeAmountExcludingVat)) + Math.abs(num(report.feeVatAmount))),
          reference: `${clientId}/${date}`,
          detail: `${Number(report.numberOfRows ?? 0)} rows · nominal ${formatMinor(Math.round(num(report.nominalAmount)))} · opening debt ${formatMinor(Math.round(num(report.openingBalanceDebt)))}`,
        });
      }
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
      { id: 'svea-58702-2026-10-06', date: '2026-10-06', amountMinor: 1264800, feeMinor: 18900, currency: 'NOK', reference: '58702/2026-10-06', detail: '14 rows · nominal 12 837,00 · opening debt 0,00' },
      { id: 'svea-58702-2026-10-07', date: '2026-10-07', amountMinor: 893250, feeMinor: 13400, currency: 'NOK', reference: '58702/2026-10-07', detail: '9 rows · nominal 9 066,50 · opening debt 0,00' },
      { id: 'svea-58702-2026-10-08', date: '2026-10-08', amountMinor: 450000, feeMinor: 6750, currency: 'NOK', reference: '58702/2026-10-08', detail: '5 rows · nominal 4 567,50 · opening debt 0,00' },
    ],
    bankTx: [
      { id: 9201, amount: 12648.0, currencyCode: 'NOK', transactionDate: '2026-10-06', description: 'SVEA BANK AB utbetaling', paymentReference: null },
      { id: 9202, amount: 8932.5, currencyCode: 'NOK', transactionDate: '2026-10-08', description: 'SVEA BANK AB', paymentReference: null },
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
        ${reaiMetric({ label: 'Svea fees', value: `${formatMinor(totalFees)} ${currency}`, detail: 'Svea fees incl. VAT' })}
      </div>
      ${rows.length === 0
        ? reaiCallout({ tone: 'info', body: `No ${currency} Svea payouts found for ${month}.` })
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
            <input type="hidden" name="filename" value="svea-reconciliation-${month}.csv">
            <input type="hidden" name="rowsJson" value="${JSON.stringify(csvRows)}">
            <div><button type="submit" class="button secondary">Download reconciliation CSV</button></div>
          </form>
        `}
    `,
  });
}

/**
 * Handles /app/svea/* routes.
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
        ${renderConnectPanel(session, { clientId: 'reai-svea-web', clientName: 'ReAI Svea Reconcile (Web)' })}
        ${reaiCard({
          eyebrow: 'SVEA PAYMENT ADMIN API',
          title: 'Fetch Svea reconciliation reports',
          body: html`
            <p class="muted-note">Use the Checkout merchant ID and secret key Svea issued for your Svea Checkout agreement. Reconciliation reports must be activated by Svea. The secret is used only to sign these requests and is never stored.</p>
            <form class="stack" hx-post="${BASE}/review" hx-target="#svea-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="svea-merchant">Checkout merchant ID</label><input id="svea-merchant" name="merchantId" type="text" inputmode="numeric" pattern="[0-9]+" autocomplete="off" required placeholder="123456"></div>
                <div class="field"><label for="svea-secret">Secret key</label><input id="svea-secret" name="secret" type="password" autocomplete="off" required placeholder="Svea Checkout secret"></div>
                <div class="field"><label for="svea-month">Payout month</label><input id="svea-month" name="month" type="text" pattern="[0-9]{4}-[0-9]{2}" value="${currentMonthIso()}" required placeholder="YYYY-MM"></div>
                <div class="field"><label for="svea-bank">ReAI bank account</label><select id="svea-bank" name="bankId"><option value="0">${banks.length > 0 ? 'Select bank account' : 'Connect to ReAI to load banks'}</option>${banks.map((b) => html`<option value="${b.id}">${b.displayName} (${b.ledgerAccountNumber} · ${b.currencyCode})</option>`)}</select></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Review Svea payouts</button>
                <button type="button" class="button secondary" hx-post="${BASE}/sample" hx-target="#svea-output" hx-swap="innerHTML">Load sample review</button>
              </div>
            </form>
          `,
        })}
        <div id="svea-output" class="stack"></div>
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
    return csvAttachment(String(form.get('filename') ?? 'svea-reconciliation.csv'), rows);
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
        fetchApi({ merchantId: String(form.get('merchantId') ?? ''), secret: String(form.get('secret') ?? ''), month }),
        bankId > 0 ? loadPendingBankTransactions(env, session, bankId, bounds.month) : Promise.resolve([]),
      ]);
      const matching = fetched.filter((p) => p.currency === company.currencyCode).sort((a, b) => b.date.localeCompare(a.date));
      return htmlResponse(renderReview({ rows: matchPayouts(matching, bankTx), month: bounds.month, currency: company.currencyCode, excluded: fetched.length - matching.length, bankCount: bankTx.length }));
    } catch (err) {
      return htmlResponse(reaiCallout({ tone: 'danger', title: `Could not review ${BRAND}`, body: err instanceof Error ? err.message : 'Review failed.' }));
    }
  }

  return errorResponse('Unknown Svea route.', 404);
}
