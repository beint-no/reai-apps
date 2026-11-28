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
  brand: 'Nexi Checkout',
  title: 'Nexi Checkout Payout Reconcile',
  lead: 'Compare Nexi Checkout (formerly Nets Easy) payouts for one month against pending ReAI bank transactions and export an audit CSV.',
  fields: [
    { key: 'secretKey', label: 'Nexi Checkout secret key', secret: true, optional: false, placeholder: 'live-secret-key-\u2026' },
    { key: 'merchantNumber', label: 'Merchant number (partner keys only)', secret: false, optional: true, placeholder: 'Leave empty' },
  ],
  hasFees: true,
};

const API = 'https://api.dibspayment.eu';
const TEST_API = 'https://test.api.dibspayment.eu';

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 */
async function providerJson(url, init, fetchImpl) {
  const res = await fetchImpl(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(25_000) });
  if (res.status >= 300 && res.status < 400) throw new HttpError(502, `${CFG.brand} returned an unexpected redirect.`);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: res.status, ok: res.ok, data };
}

/**
 * Fetches Nexi Checkout payouts for the date window from the Reporting API.
 * Docs: https://developer.nexigroup.com/nexi-checkout/en-EU/api/reporting-v1/ (GET /report/v1/payouts with the
 * secret key as the plain Authorization header, fromDate/toDate as full dates, zero-based pageNumber, pageSize,
 * merchantNumber only for partner keys; amounts in minor units) and
 * https://developer.nexigroup.com/nexi-checkout/en-EU/api/ (live base https://api.dibspayment.eu, test base https://test.api.dibspayment.eu).
 * @param {Record<string, string>} fields
 * @param {string} start First day of the window (inclusive).
 * @param {string} end Day after the window (exclusive).
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @param {string} [currency] ISO 4217 code; sent as the documented `currency` filter when set.
 * @returns {Promise<import('../../lib/reconcile.js').PayoutItem[]>}
 */
export async function fetchApi(fields, start, end, fetchImpl = fetch, currency = '') {
  const secretKey = (fields.secretKey ?? '').trim();
  if (!secretKey) throw new HttpError(400, 'Enter your Nexi Checkout secret key.');
  const host = secretKey.startsWith('test-') ? TEST_API : API;
  const lastDay = new Date(Date.parse(`${end}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const merchant = (fields.merchantNumber ?? '').trim();
  if (merchant && !/^[0-9]+$/.test(merchant)) throw new HttpError(400, 'The merchant number must be digits only.');
  /** @type {import('../../lib/reconcile.js').PayoutItem[]} */
  const payouts = [];
  const pageSize = 100;
  for (let page = 0; page < 20; page++) {
    const url = new URL(`${host}/report/v1/payouts`);
    url.searchParams.set('fromDate', start);
    url.searchParams.set('toDate', lastDay);
    url.searchParams.set('pageNumber', String(page));
    url.searchParams.set('pageSize', String(pageSize));
    if (/^[A-Z]{3}$/.test(currency)) url.searchParams.set('currency', currency);
    if (merchant) url.searchParams.set('merchantNumber', merchant);
    const r = await providerJson(url.toString(), { headers: { authorization: secretKey, accept: 'application/json' } }, fetchImpl);
    if (!r.ok) {
      throw new HttpError(400, r.status === 401 || r.status === 403
        ? 'Nexi Checkout rejected this secret key. Use the live secret key from the Nexi Checkout portal.'
        : r.status === 429
          ? 'Nexi Checkout is rate limiting requests. Wait a minute and try again.'
          : `Nexi Checkout Reporting API returned HTTP ${r.status}${typeof r.data?.message === 'string' ? `: ${r.data.message.slice(0, 200)}` : ''}.`);
    }
    /** @type {any[]} */ const rows = Array.isArray(r.data?.payouts) ? r.data.payouts : [];
    for (const row of rows) {
      const amount = Number(row.amount ?? 0);
      const date = String(row.date ?? '').slice(0, 10);
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !Number.isFinite(amount) || amount === 0) continue;
      const fees = Number(row.fees ?? 0);
      const feeTax = Number(row.feeTaxAmount ?? 0);
      payouts.push({
        id: String(row.id ?? `${date}-${amount}`),
        date,
        amountMinor: Math.round(Math.abs(amount)),
        feeMinor: Number.isFinite(fees) ? Math.round(Math.abs(fees)) : 0,
        currency: String(row.currency ?? 'NOK').toUpperCase(),
        reference: String(row.reference ?? row.id ?? ''),
        detail: `${CFG.brand} payout · charged ${(Number(row.chargedAmount ?? 0) / 100).toFixed(2)}, refunded ${(Number(row.refundedAmount ?? 0) / 100).toFixed(2)}${Number.isFinite(feeTax) && feeTax !== 0 ? `, fee tax ${(Math.abs(feeTax) / 100).toFixed(2)}` : ''}`,
      });
    }
    const total = Number(r.data?.numberOfPayouts ?? 0);
    if (rows.length < pageSize || (total > 0 && (page + 1) * pageSize >= total)) return payouts;
  }
  throw new HttpError(400, 'Nexi Checkout returned more than 2000 payouts for the month. Contact ReAI support.');
}

/**
 * @returns {{ payouts: import('../../lib/reconcile.js').PayoutItem[], bankTx: import('../../lib/reconcile.js').BankTx[], month: string, currency: string }}
 */
function sampleData() {
  const month = '2026-10';
  const prefix = 'NEXI';
  /** @type {import('../../lib/reconcile.js').PayoutItem[]} */
  const payouts = [
    { id: 'nets-1', date: '2026-10-06', amountMinor: 1482000, feeMinor: 29640, currency: 'NOK', reference: `${prefix}-2610-001`, detail: `Sample ${prefix} payout 1` },
    { id: 'nets-2', date: '2026-10-14', amountMinor: 964500, feeMinor: 19290, currency: 'NOK', reference: `${prefix}-2610-002`, detail: `Sample ${prefix} payout 2` },
    { id: 'nets-3', date: '2026-10-27', amountMinor: 712000, feeMinor: 14240, currency: 'NOK', reference: `${prefix}-2610-003`, detail: `Sample ${prefix} payout 3 (pending settlement)` },
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
            ? reaiMetric({ label: 'Withheld fees', value: `${formatMinor(totalFees)} ${currency}`, detail: `Compare against the ${CFG.brand} payout report` })
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
            <form class="stack-sm" method="post" action="/app/nets/export">
              <input type="hidden" name="filename" value="nets-reconciliation-${month}.csv">
              <input type="hidden" name="rowsJson" value="${JSON.stringify(csvRows)}">
              <div><button type="submit" class="button secondary">Download reconciliation CSV ↓</button></div>
            </form>
          `}
      `,
    })}
  `;
}

/**
 * Handles /app/nets/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = `/app/nets`;

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
        ${renderConnectPanel(session, { clientId: 'reai-nets-web', clientName: `ReAI ${CFG.brand} Reconcile (Web)` })}
        ${reaiCard({
          eyebrow: 'ON-DEMAND REVIEW',
          title: `Fetch ${CFG.brand} payouts`,
          body: html`
            <p class="muted-note">Provider credentials are used only for this single HTTPS request and are never stored in cookies, browser storage or a database.</p>
            <form class="stack" hx-post="${basePath}/review" hx-target="#reconcile-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                ${CFG.fields.map((f) => html`<div class="field"><label for="f-${f.key}">${f.label}</label><input id="f-${f.key}" name="${f.key}" type="${f.secret ? 'password' : 'text'}" autocomplete="off"${f.optional ? '' : html` required`} placeholder="${f.placeholder}"></div>`)}
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
    const filename = String(form.get('filename') ?? `nets-reconciliation.csv`);
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
        if (!val && !f.optional) throw new HttpError(400, `Enter ${f.label}.`);
        fields[f.key] = val;
      }
      const [fetched, bankTx] = await Promise.all([
        fetchApi(fields, bounds.start, bounds.end, fetch, company.currencyCode),
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
