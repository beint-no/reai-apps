// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import {
  csvAttachment,
  currentMonthIso,
  formatMinor,
  loadActiveBanks,
  loadPendingBankTransactions,
  matchPayouts,
  monthBounds,
} from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

const CFG = {
  "brand": "Dintero",
  "title": "Dintero Fees & Reconcile",
  "lead": "Review withheld fees across paid Dintero settlements, compare net payouts against ReAI bank transactions, and optionally create a monthly review voucher for fees.",
  "fields": [
    {
      "key": "accountID",
      "label": "Dintero Account ID",
      "placeholder": "P12345678"
    },
    {
      "key": "clientID",
      "label": "Client ID",
      "placeholder": "Backoffice API client ID"
    },
    {
      "key": "clientSecret",
      "label": "Client secret",
      "secret": true,
      "placeholder": "Backoffice API client secret"
    }
  ],
  "hasFees": true
};

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {string} errPrefix
 */
async function providerJson(url, init, errPrefix) {
  const res = await fetch(url, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status >= 300 && res.status < 400) {
    throw new HttpError(502, `${errPrefix} returned an unexpected redirect.`);
  }
  const text = await res.text();
  return { status: res.status, ok: res.ok, data: text ? JSON.parse(text) : null };
}

/**
 * @param {Record<string, string>} fields
 * @param {string} start
 * @param {string} end
 * @returns {Promise<import('../lib/reconcile.js').PayoutItem[]>}
 */

/**
 * @param {Record<string, string>} fields
 * @param {string} start
 * @param {string} end
 * @returns {Promise<import('../lib/reconcile.js').PayoutItem[]>}
 */
async function fetchDinteroSettlements(fields, start, end) {
  const account = fields.accountID ?? '';
  if (!/^[PT][0-9]{8}$/.test(account)) {
    throw new HttpError(400, 'Enter a valid Dintero account ID (P12345678 or T12345678).');
  }
  const base = `https://api.dintero.com/v1/accounts/${account}`;
  const basic = btoa(`${fields.clientID ?? ''}:${fields.clientSecret ?? ''}`);
  const tokRes = await providerJson(
    `${base}/auth/token`,
    {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', audience: base }),
    },
    'Dintero',
  );
  if (!tokRes.ok || !tokRes.data?.access_token) {
    throw new HttpError(400, 'Dintero rejected these credentials. Check settlement report permissions.');
  }
  const headers = { authorization: `Bearer ${tokRes.data.access_token}`, accept: 'application/json' };
  /** @type {import('../lib/reconcile.js').PayoutItem[]} */
  const payouts = [];
  /** @type {{ id: string, settled_at?: string } | null} */
  let cursor = null;
  const seen = new Set();

  for (let p = 0; p < 50; p++) {
    const url = new URL(`${base}/settlements`);
    url.searchParams.set('limit', '100');
    url.searchParams.set('created_at.gte', start);
    url.searchParams.set('created_at.lte', end);
    if (cursor) {
      if (!cursor.settled_at) {
        throw new HttpError(502, 'Dintero omitted a pagination date.');
      }
      url.searchParams.set('starting_after_id', cursor.id);
      url.searchParams.set('starting_after_date', cursor.settled_at);
    }
    const r = await providerJson(url.toString(), { headers }, 'Dintero');
    if (!r.ok) {
      throw new HttpError(400, `Dintero settlements returned HTTP ${r.status}.`);
    }
    const items = Array.isArray(r.data?.items) ? r.data.items : [];
    for (const item of items) {
      if (seen.has(item.id)) {
        throw new HttpError(502, 'Dintero repeated a settlement page.');
      }
      seen.add(item.id);
      const day = typeof item.settled_at === 'string' ? item.settled_at.slice(0, 10) : '';
      if (String(item.payment_status ?? '').toLowerCase() !== 'paid' || day < start || day >= end) {
        continue;
      }
      const amounts = Array.isArray(item.amounts) ? item.amounts : [];
      amounts.forEach((/** @type {{ amount: number, capture?: number, refund?: number, fee: number, currency: string }} */ a, /** @type {number} */ idx) => {
        payouts.push({
          id: `${item.id}:${idx}`,
          date: day,
          amountMinor: Number(a.amount ?? 0),
          feeMinor: Number(a.fee ?? 0),
          currency: String(a.currency),
          reference: String(item.id),
          detail: `${item.provider ?? 'Dintero'} · captured ${a.capture ?? 0}, refunds ${a.refund ?? 0} minor units`,
        });
      });
    }
    cursor = r.data?.last_evaluated_key ?? null;
    if (!cursor) {
      break;
    }
  }
  return payouts;
}

/**
 * Fetches SumUp payouts for a merchant code and date range.
 * @param {Record<string, string>} fields
 * @param {string} start
 * @param {string} end
 * @returns {Promise<import('../lib/reconcile.js').PayoutItem[]>}
 */

/**
 * @returns {{ payouts: import('../lib/reconcile.js').PayoutItem[], bankTx: import('../lib/reconcile.js').BankTx[], month: string, currency: string }}
 */
function sampleData() {
  const month = '2026-10';
  const prefix = 'DINTERO';
  /** @type {import('../lib/reconcile.js').PayoutItem[]} */
  const payouts = [
    { id: 'dintero-1', date: '2026-10-06', amountMinor: 1482000, feeMinor: 29500, currency: 'NOK', reference: `${prefix}-2610-001`, detail: `Sample ${prefix} payout batch 1` },
    { id: 'dintero-2', date: '2026-10-14', amountMinor: 964500, feeMinor: 19200, currency: 'NOK', reference: `${prefix}-2610-002`, detail: `Sample ${prefix} payout batch 2` },
    { id: 'dintero-3', date: '2026-10-27', amountMinor: 712000, feeMinor: 14100, currency: 'NOK', reference: `${prefix}-2610-003`, detail: `Sample ${prefix} payout batch 3 (pending settlement)` },
  ];
  /** @type {import('../lib/reconcile.js').BankTx[]} */
  const bankTx = [
    { id: 9001, amount: 14820.0, currencyCode: 'NOK', transactionDate: '2026-10-07', description: `Utbetaling ${prefix}-2610-001`, paymentReference: `${prefix}-2610-001` },
    { id: 9002, amount: 9645.0, currencyCode: 'NOK', transactionDate: '2026-10-16', description: `${prefix} oppgjør`, paymentReference: null },
  ];
  return { payouts, bankTx, month, currency: 'NOK' };
}

/**
 * @param {{ rows: import('../lib/reconcile.js').ReconcileRow[], month: string, currency: string, excluded: number, bankCount: number, isSample?: boolean, accountID?: string }} state
 */
function renderReviewResults(state) {
  const { rows, month, currency, excluded, bankCount, isSample, accountID } = state;
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
            ? reaiMetric({ label: 'Withheld fees', value: `${formatMinor(totalFees)} ${currency}`, detail: 'Compare against Dintero report' })
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
            <form class="stack-sm" method="post" action="/app/dintero/export">
              <input type="hidden" name="filename" value="dintero-reconciliation-${month}.csv">
              <input type="hidden" name="rowsJson" value="${JSON.stringify(csvRows)}">
              <div><button type="submit" class="button secondary">Download reconciliation CSV ↓</button></div>
            </form>
          `}
      `,
    })}
    ${CFG.hasFees && !isSample && totalFees > 0 && accountID
      ? reaiCard({
          eyebrow: 'OPTIONAL · BOOK WITHHELD FEES',
          title: 'Create monthly fee voucher for review',
          body: html`
            <p class="muted-note">Only book if Dintero withheld these fees directly from payouts and has not separately invoiced them.</p>
            <form class="stack" hx-post="/app/dintero/voucher" hx-target="#dintero-booking" hx-swap="innerHTML">
              <input type="hidden" name="month" value="${month}"><input type="hidden" name="accountID" value="${accountID}"><input type="hidden" name="totalFeeMinor" value="${totalFees}">
              <div class="inline-row">
                <div class="field"><label for="dintero-expense">Fee expense account (e.g. 7770)</label><input id="dintero-expense" name="expenseAccount" type="text" pattern="[0-9]{4}" required placeholder="7770"></div>
                <div class="field"><label for="dintero-clearing">Payout clearing account (asset/liability)</label><input id="dintero-clearing" name="clearingAccount" type="text" pattern="[0-9]{4}" required placeholder="1580"></div>
              </div>
              <label class="check-row"><input type="checkbox" name="c_deducted" required> I confirm ${formatMinor(totalFees)} ${currency} was withheld from payouts and not separately invoiced.</label>
              <label class="check-row"><input type="checkbox" name="c_report" required> I verified this total against Dintero's official payout reports for ${month}.</label>
              <div><button type="submit" class="button primary">Create review voucher (${formatMinor(totalFees)} ${currency})</button></div>
            </form>
            <div id="dintero-booking" class="stack-sm"></div>
          `,
        })
      : ''}
  `;
}

/**
 * Handles /app/dintero/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = `/app/dintero`;

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
        ${renderConnectPanel(session, { clientId: 'reai-dintero-web', clientName: `ReAI ${CFG.brand} Reconcile (Web)` })}
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
    const filename = String(form.get('filename') ?? `dintero-reconciliation.csv`);
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
        fetchDinteroSettlements(fields, bounds.start, bounds.end),
        bankId > 0 ? loadPendingBankTransactions(env, session, bankId, bounds.month) : Promise.resolve([]),
      ]);
      const matching = fetched.filter((p) => p.currency === company.currencyCode).sort((a, b) => b.date.localeCompare(a.date));
      const rows = matchPayouts(matching, bankTx);
      return htmlResponse(renderReviewResults({ rows, month: bounds.month, currency: company.currencyCode, excluded: fetched.length - matching.length, bankCount: bankTx.length, ...(fields.accountID ? { accountID: fields.accountID } : {}) }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Review failed.';
      return htmlResponse(reaiCallout({ tone: 'danger', title: `Could not review ${CFG.brand}`, body: msg }));
    }
  }

  if (pathname === '/app/dintero/voucher') {
    try {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company first.');
      const company = session.tenants.find((t) => t.id === session.tenantId);
      if (!company) throw new HttpError(400, 'Select a valid ReAI company.');
      const form = await request.formData();
      const bounds = monthBounds(String(form.get('month') ?? '').trim());
      const accountID = String(form.get('accountID') ?? '').trim();
      const expense = String(form.get('expenseAccount') ?? '').trim();
      const clearing = String(form.get('clearingAccount') ?? '').trim();
      const totalFeeMinor = Number(form.get('totalFeeMinor') ?? '0');

      if (!accountID.startsWith('P')) throw new HttpError(400, 'Test Dintero settlements cannot be booked to ReAI.');
      if (!expense || !clearing || expense === clearing) throw new HttpError(400, 'Choose separate fee expense and payout clearing accounts.');
      if (!Number.isSafeInteger(totalFeeMinor) || totalFeeMinor <= 0) throw new HttpError(400, 'Fee total must be positive.');
      if (form.get('c_deducted') !== 'on' || form.get('c_report') !== 'on') throw new HttpError(400, 'Confirm both checkboxes before creating the voucher.');

      const marker = `Dintero withheld fees ${accountID} ${bounds.month}`;
      const [vouchers, expenseOpts, clearingOpts] = await Promise.all([
        reaiAll(env, '/api/vouchers', { token: session.accessToken, tenantId: company.id, query: { startDate: bounds.start, endDate: bounds.end } }),
        reaiRequest(env, '/api/chart-of-accounts/accounts', { token: session.accessToken, tenantId: company.id, query: { accountNumberPrefix: expense } }),
        reaiRequest(env, '/api/chart-of-accounts/accounts', { token: session.accessToken, tenantId: company.id, query: { accountNumberPrefix: clearing } }),
      ]);

      const voucherList = /** @type {Array<{ description?: string | null }>} */ (vouchers);
      if (voucherList.some((v) => typeof v.description === 'string' && v.description.includes(marker))) {
        throw new HttpError(409, 'A Dintero fee voucher for this account and month already exists in ReAI.');
      }
      const expAccounts = /** @type {Array<{ accountNumber: string, type: string, restrictedToSystemUsage: boolean }>} */ (expenseOpts);
      const clrAccounts = /** @type {Array<{ accountNumber: string, type: string, restrictedToSystemUsage: boolean }>} */ (clearingOpts);
      const validExp = expAccounts.some((a) => a.accountNumber === expense && !a.restrictedToSystemUsage && a.type === 'expense');
      const validClr = clrAccounts.some((a) => a.accountNumber === clearing && !a.restrictedToSystemUsage && (a.type === 'asset' || a.type === 'liability'));
      if (!validExp || !validClr) throw new HttpError(400, 'Use an active expense account and an active asset or liability clearing account from ReAI.');

      const amount = Number((totalFeeMinor / 100).toFixed(2));
      const created = /** @type {import('../lib/types.d.ts').VoucherSummary} */ (
        await reaiRequest(env, '/api/manual-vouchers', {
          token: session.accessToken,
          tenantId: company.id,
          method: 'POST',
          body: {
            date: bounds.lastDay,
            description: marker,
            reviewReason: 'Verify Dintero payout reports, invoicing, fee VAT treatment, and the payout clearing account before finalizing.',
            postings: [
              { accountNumber: expense, postingDate: bounds.lastDay, currencyCode: company.currencyCode, amount, vatCode: '0', rowNumber: 0, description: marker },
              { accountNumber: clearing, postingDate: bounds.lastDay, currencyCode: company.currencyCode, amount: -amount, vatCode: '0', rowNumber: 1, description: marker },
            ],
          },
        })
      );
      const url = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${company.id}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Booked ${formatMinor(totalFeeMinor)} ${company.currencyCode} flagged for review. <a href="${url}" target="_blank" rel="noopener">Open in ReAI ↗</a>` }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Voucher creation failed.';
      return htmlResponse(reaiCallout({ tone: 'danger', title: 'Could not book Dintero fees', body: msg }));
    }
  }

  return errorResponse('Unknown reconciliation route.', 404);
}
