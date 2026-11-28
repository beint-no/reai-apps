// @ts-check
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

const CFG = {
  brand: 'PayPal',
  title: 'PayPal Withdrawal Reconcile',
  lead: 'Compare PayPal Business withdrawals to your bank for one month against pending ReAI bank transactions and export a reconciliation CSV.',
  fields: [
    { key: 'clientId', label: 'PayPal REST app client ID', secret: false, placeholder: 'Live client ID' },
    { key: 'clientSecret', label: 'PayPal REST app secret', secret: true, placeholder: 'Live secret' },
  ],
  hasFees: false,
};

const API = 'https://api-m.paypal.com';

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 */
async function providerJson(url, init, fetchImpl) {
  const res = await fetchImpl(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(25_000) });
  if (res.status >= 300 && res.status < 400) throw new HttpError(502, 'PayPal returned an unexpected redirect.');
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: res.status, ok: res.ok, data };
}

/** Bank withdrawal event codes (T04xx) except T0402, which moves money to Hyperwallet instead of a bank. */
const WITHDRAWAL_RE = /^T04[0-9]{2}$/;

/**
 * Fetches PayPal withdrawals to the bank for the date window.
 * Docs: https://developer.paypal.com/api/rest/authentication/ (POST /v1/oauth2/token, client_credentials),
 * https://developer.paypal.com/docs/api/transaction-search/v1/ (GET /v1/reporting/transactions: start_date and
 * end_date in RFC 3339 with at most 31 days between them, fields, page_size up to 500, page from 1, total_pages;
 * scope https://uri.paypal.com/services/reporting/search/read) and
 * https://developer.paypal.com/docs/transaction-search/transaction-event-codes/ (T04xx bank withdrawals).
 * @param {Record<string, string>} fields
 * @param {string} start First day of the window (inclusive).
 * @param {string} end Day after the window (exclusive).
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<import('../../lib/reconcile.js').PayoutItem[]>}
 */
export async function fetchApi(fields, start, end, fetchImpl = fetch) {
  const clientId = (fields.clientId ?? '').trim();
  const clientSecret = (fields.clientSecret ?? '').trim();
  if (!clientId || !clientSecret) throw new HttpError(400, 'Enter the client ID and secret of your live PayPal REST app.');
  const tokRes = await providerJson(`${API}/v1/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: 'grant_type=client_credentials',
  }, fetchImpl);
  if (!tokRes.ok || typeof tokRes.data?.access_token !== 'string') throw new HttpError(400, 'PayPal rejected these REST app credentials.');
  const headers = { authorization: `Bearer ${tokRes.data.access_token}`, accept: 'application/json' };
  const endInclusive = new Date(Date.parse(`${end}T00:00:00Z`) - 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  /** @type {import('../../lib/reconcile.js').PayoutItem[]} */
  const payouts = [];
  for (let page = 1; page <= 20; page++) {
    const url = new URL(`${API}/v1/reporting/transactions`);
    url.searchParams.set('start_date', `${start}T00:00:00Z`);
    url.searchParams.set('end_date', endInclusive);
    url.searchParams.set('fields', 'transaction_info');
    url.searchParams.set('page_size', '500');
    url.searchParams.set('page', String(page));
    const r = await providerJson(url.toString(), { headers }, fetchImpl);
    if (!r.ok) {
      throw new HttpError(400, r.status === 403
        ? 'Turn on Transaction search for this live REST app in the PayPal Developer Dashboard.'
        : `PayPal Transaction Search API returned HTTP ${r.status}.`);
    }
    /** @type {any[]} */ const details = Array.isArray(r.data?.transaction_details) ? r.data.transaction_details : [];
    for (const item of details) {
      const info = item.transaction_info ?? {};
      const code = String(info.transaction_event_code ?? '');
      const amount = Number(info.transaction_amount?.value ?? '0');
      if (!WITHDRAWAL_RE.test(code) || code === 'T0402' || !Number.isFinite(amount) || amount >= 0) continue;
      if (info.transaction_status && info.transaction_status !== 'S') continue;
      const fee = Number(info.fee_amount?.value ?? '0');
      payouts.push({
        id: String(info.transaction_id ?? `${info.transaction_initiation_date}-${amount}`),
        date: String(info.transaction_initiation_date ?? info.transaction_updated_date ?? '').slice(0, 10),
        amountMinor: Math.round(Math.abs(amount) * 100),
        currency: String(info.transaction_amount?.currency_code ?? 'NOK').toUpperCase(),
        reference: String(info.bank_reference_id ?? info.transaction_id ?? ''),
        detail: `PayPal ${code} withdrawal${Number.isFinite(fee) && fee !== 0 ? ` · fee ${Math.abs(fee).toFixed(2)}` : ''}`,
      });
    }
    if (page >= Number(r.data?.total_pages ?? 1)) break;
  }
  return payouts;
}

/**
 * @returns {{ payouts: import('../../lib/reconcile.js').PayoutItem[], bankTx: import('../../lib/reconcile.js').BankTx[], month: string, currency: string }}
 */
function sampleData() {
  const month = '2026-10';
  const prefix = 'PAYPAL';
  /** @type {import('../../lib/reconcile.js').PayoutItem[]} */
  const payouts = [
    { id: 'paypal-1', date: '2026-10-06', amountMinor: 1482000, currency: 'NOK', reference: `${prefix}-2610-001`, detail: `Sample ${prefix} withdrawal 1` },
    { id: 'paypal-2', date: '2026-10-14', amountMinor: 964500, currency: 'NOK', reference: `${prefix}-2610-002`, detail: `Sample ${prefix} withdrawal 2` },
    { id: 'paypal-3', date: '2026-10-27', amountMinor: 712000, currency: 'NOK', reference: `${prefix}-2610-003`, detail: `Sample ${prefix} withdrawal 3 (pending settlement)` },
  ];
  /** @type {import('../../lib/reconcile.js').BankTx[]} */
  const bankTx = [
    { id: 9001, amount: 14820.0, currencyCode: 'NOK', transactionDate: '2026-10-07', description: `Utbetaling ${prefix}-2610-001`, paymentReference: `${prefix}-2610-001` },
    { id: 9002, amount: 9645.0, currencyCode: 'NOK', transactionDate: '2026-10-16', description: `${prefix} oppgjør`, paymentReference: null },
  ];
  return { payouts, bankTx, month, currency: 'NOK' };
}

/**
 * @param {{ rows: import('../../lib/reconcile.js').ReconcileRow[], month: string, currency: string, excluded: number, bankCount: number, isSample?: boolean }} state
 */
function renderReviewResults(state) {
  const { rows, month, currency, excluded, bankCount, isSample } = state;
  const matched = rows.filter((r) => r.match !== null).length;
  const totalNet = rows.reduce((s, r) => s + r.payout.amountMinor, 0);
  const totalFees = rows.reduce((s, r) => s + Math.abs(r.payout.feeMinor ?? 0), 0);
  const csvRows = [
    CFG.hasFees
      ? ['provider', 'reference', 'payout_date', 'net_payout', 'fee_field', 'currency', 'match_status', 'reai_bank_transaction_id', 'detail']
      : ['provider', 'reference', 'payout_date', 'amount', 'currency', 'match_status', 'reai_bank_transaction_id', 'detail'],
    ...rows.map((r) =>
      CFG.hasFees
        ? [CFG.brand, r.payout.reference, r.payout.date, (r.payout.amountMinor / 100).toFixed(2), ((r.payout.feeMinor ?? 0) / 100).toFixed(2), r.payout.currency, r.status, r.match ? String(r.match.id) : '', r.payout.detail]
        : [CFG.brand, r.payout.reference, r.payout.date, (r.payout.amountMinor / 100).toFixed(2), r.payout.currency, r.status, r.match ? String(r.match.id) : '', r.payout.detail],
    ),
  ];

  return html`
    ${reaiCard({
      eyebrow: 'RECONCILIATION PREVIEW',
      title: `${CFG.brand} · ${month}`,
      badge: isSample
        ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' })
        : reaiBadge({ text: `${matched}/${rows.length} matched`, tone: matched === rows.length && rows.length > 0 ? 'success' : 'warn' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Payouts', value: String(rows.length), detail: `${excluded} other-currency excluded` })}
          ${reaiMetric({ label: 'Net payout total', value: `${formatMinor(totalNet)} ${currency}`, detail: `${bankCount} pending ReAI bank rows` })}
          ${CFG.hasFees
            ? reaiMetric({ label: 'Withheld fees', value: `${formatMinor(totalFees)} ${currency}`, detail: 'Compare against the PayPal activity report' })
            : reaiMetric({ label: 'Bank matches', value: `${matched} / ${rows.length}`, detail: '±8 day window, exact ref or unique amount' })}
        </div>

        ${rows.length === 0
          ? reaiCallout({ tone: 'info', body: `No ${currency} payouts found for ${month}.` })
          : html`
            <div class="table-wrap"><table class="data-table">
              <thead><tr><th>Date</th><th>Reference</th><th class="num">Net amount</th>${CFG.hasFees ? html`<th class="num">Fee</th>` : ''}<th>Bank match</th><th>ReAI Bank Tx</th><th>Details</th></tr></thead>
              <tbody>${rows.map(
                (r) => html`<tr>
                  <td class="mono">${r.payout.date}</td><td class="mono">${r.payout.reference}</td>
                  <td class="num">${formatMinor(r.payout.amountMinor)} ${r.payout.currency}</td>
                  ${CFG.hasFees ? html`<td class="num">${formatMinor(r.payout.feeMinor ?? 0)}</td>` : ''}
                  <td>${reaiBadge({ text: r.status, tone: r.match ? 'success' : 'warn' })}</td>
                  <td class="mono">${r.match ? `#${r.match.id} (${r.match.transactionDate})` : '—'}</td>
                  <td>${r.payout.detail}</td>
                </tr>`,
              )}</tbody>
            </table></div>
            <form class="stack-sm" method="post" action="/app/paypal/export">
              <input type="hidden" name="filename" value="paypal-reconciliation-${month}.csv">
              <input type="hidden" name="rowsJson" value="${JSON.stringify(csvRows)}">
              <div><button type="submit" class="button secondary">Download reconciliation CSV ↓</button></div>
            </form>
          `}
      `,
    })}
  `;
}

/**
 * Handles /app/paypal/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = `/app/paypal`;

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    let banks = /** @type {Array<{ id: number, displayName: string, currencyCode: string, ledgerAccountNumber: string }>} */ ([]);
    if (session && session.tenantId > 0) {
      try { banks = await loadActiveBanks(env, session); } catch { banks = []; }
    }
    const defaultMonth = currentMonthIso();
    const body = html`
      <section class="app-intro"><p class="eyebrow">PAYMENTS & PAYOUTS</p><h1>${CFG.title}</h1><p class="lead">${CFG.lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-paypal-web', clientName: `ReAI ${CFG.brand} Reconcile (Web)` })}
        ${reaiCard({
          eyebrow: 'ON-DEMAND REVIEW',
          title: `Fetch ${CFG.brand} payouts`,
          body: html`
            <p class="muted-note">Provider credentials are used only for this single HTTPS request and are never stored in cookies, browser storage or a database.</p>
            <form class="stack" hx-post="${basePath}/review" hx-target="#reconcile-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                ${CFG.fields.map((f) => html`<div class="field"><label for="f-${f.key}">${f.label}</label><input id="f-${f.key}" name="${f.key}" type="${f.secret ? 'password' : 'text'}" autocomplete="off" required placeholder="${f.placeholder}"></div>`)}
                <div class="field"><label for="reconcile-month">Payout month</label><input id="reconcile-month" name="month" type="text" pattern="[0-9]{4}-[0-9]{2}" value="${defaultMonth}" required placeholder="YYYY-MM"></div>
                <div class="field"><label for="reconcile-bank">ReAI bank account${CFG.hasFees ? ' (optional)' : ''}</label><select id="reconcile-bank" name="bankId"><option value="0">${banks.length > 0 ? 'Select bank account…' : 'Connect to ReAI to load banks'}</option>${banks.map((b) => html`<option value="${b.id}">${b.displayName} (${b.ledgerAccountNumber} · ${b.currencyCode})</option>`)}</select></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Review ${CFG.brand} payouts</button>
                <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#reconcile-output" hx-swap="innerHTML">Load sample review</button>
              </div>
            </form>
          `,
        })}
        <div id="reconcile-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: CFG.title, description: CFG.lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${basePath}/sample`) {
    const s = sampleData();
    return htmlResponse(renderReviewResults({ rows: matchPayouts(s.payouts, s.bankTx), month: s.month, currency: s.currency, excluded: 0, bankCount: s.bankTx.length, isSample: true }));
  }

  if (pathname === `${basePath}/export`) {
    const form = await request.formData();
    const filename = String(form.get('filename') ?? `paypal-reconciliation.csv`);
    const rows = /** @type {string[][]} */ (JSON.parse(String(form.get('rowsJson') ?? '[]')));
    return csvAttachment(filename, rows);
  }

  if (pathname === `${basePath}/review`) {
    try {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const company = session.tenants.find((t) => t.id === session.tenantId);
      if (!company) throw new HttpError(400, 'Select a valid ReAI company.');
      const form = await request.formData();
      const bounds = monthBounds(String(form.get('month') ?? '').trim());
      const bankId = Number(form.get('bankId') ?? '0');
      /** @type {Record<string, string>} */
      const fields = {};
      for (const f of CFG.fields) {
        const val = String(form.get(f.key) ?? '').trim();
        if (!val) throw new HttpError(400, `Enter ${f.label}.`);
        fields[f.key] = val;
      }
      const [fetched, bankTx] = await Promise.all([
        fetchApi(fields, bounds.start, bounds.end),
        bankId > 0 ? loadPendingBankTransactions(env, session, bankId, bounds.month) : Promise.resolve([]),
      ]);
      const matching = fetched.filter((p) => p.currency === company.currencyCode).sort((a, b) => b.date.localeCompare(a.date));
      const rows = matchPayouts(matching, bankTx);
      return htmlResponse(renderReviewResults({ rows, month: bounds.month, currency: company.currencyCode, excluded: fetched.length - matching.length, bankCount: bankTx.length }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Review failed.';
      return htmlResponse(reaiCallout({ tone: 'danger', title: `Could not review ${CFG.brand}`, body: msg }));
    }
  }

  return errorResponse('Unknown reconciliation route.', 404);
}
