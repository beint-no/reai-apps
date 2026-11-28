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
  "brand": "PayPal Point of Sale",
  "title": "PayPal Point of Sale (Zettle) Reconcile",
  "lead": "Compare PayPal Point of Sale payouts, formerly Zettle, against pending ReAI bank transactions for one month and export a CSV report.",
  "fields": [
    {
      "key": "clientId",
      "label": "Client ID",
      "placeholder": "Shown when you create the API key"
    },
    {
      "key": "apiKey",
      "label": "API key (READ:FINANCE)",
      "secret": true,
      "placeholder": "API key from my.zettle.com"
    }
  ],
};
const PAGE = 10000;

/** @param {string} day YYYY-MM-DD @returns {string} UTC instant of 00:00 Europe/Oslo as YYYY-MM-DDThh:mm:ss. */
function osloMidnightUtc(day) {
  const guess = new Date(`${day}T00:00:00Z`);
  const local = new Date(guess.toLocaleString('sv-SE', { timeZone: 'Europe/Oslo' }).replace(' ', 'T') + 'Z');
  return new Date(guess.getTime() - (local.getTime() - guess.getTime())).toISOString().slice(0, 19);
}

/** @param {string} ts Zettle timestamp, UTC with or without an offset @returns {string} Calendar day in Norwegian time. */
function osloDay(ts) {
  const d = new Date(/[zZ]|[+-][0-9]{2}:?[0-9]{2}$/.test(ts) ? ts : `${ts}Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Oslo' });
}

/**
 * Fetches PayPal Point of Sale (Zettle) payouts from the liquid account.
 * Docs: https://developer.zettle.com/docs/api/oauth/user-guides/set-up-app-authorisation/set-up-authorisation-assertion-grant
 * (POST https://oauth.zettle.com/token, grant_type urn:ietf:params:oauth:grant-type:jwt-bearer, client_id, assertion),
 * https://developer.zettle.com/docs/api/finance/reference (Finance API v2: GET /v2/accounts/liquid/balance returns currencyId;
 * GET /v2/accounts/liquid/transactions with start inclusive and end exclusive in UTC, includeTransactionType, limit up to 10000,
 * offset; amounts in minor units; a negative PAYOUT goes to the bank or PayPal Wallet; FAILED_PAYOUT voids an earlier payout)
 * and https://developer.zettle.com/docs/api/finance/user-guides/fetch-account-transactions (rows wrapped in data,
 * id named originatingTransactionUuid; the reference names it originatorTransactionUuid, so both are read).
 * @param {Record<string, string>} fields
 * @param {string} start First day of the month (YYYY-MM-DD, Oslo)
 * @param {string} end First day of the next month (YYYY-MM-DD, Oslo)
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<{ payouts: import('../../lib/reconcile.js').PayoutItem[], failed: number }>}
 */
export async function fetchZettlePayouts(fields, start, end, fetchImpl = fetch) {
  const form = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    client_id: (fields.clientId ?? '').trim(),
    assertion: (fields.apiKey ?? '').trim(),
  });
  const json = async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
    const res = await fetchImpl(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(25_000) });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { status: res.status, ok: res.ok, data };
  };
  const tokRes = await json('https://oauth.zettle.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
  if (!tokRes.ok || !tokRes.data?.access_token) {
    throw new HttpError(400, `${CFG.brand} rejected the API key or client ID. Create a new API key at my.zettle.com and copy the client ID shown with it.`);
  }
  const headers = { authorization: `Bearer ${tokRes.data.access_token}`, accept: 'application/json' };
  /** @param {number} status */
  const fail = (status) => new HttpError(400, status === 403 ? 'This API key needs the READ:FINANCE scope.' : status === 429 ? `${CFG.brand} rate limited the request. Try again in a minute.` : `${CFG.brand} Finance API returned HTTP ${status}.`);
  /** @param {number} offset */
  const page = (offset) => {
    const url = new URL('https://finance.izettle.com/v2/accounts/liquid/transactions');
    url.searchParams.set('start', osloMidnightUtc(start));
    url.searchParams.set('end', osloMidnightUtc(end));
    url.searchParams.append('includeTransactionType', 'PAYOUT');
    url.searchParams.append('includeTransactionType', 'FAILED_PAYOUT');
    url.searchParams.set('limit', String(PAGE));
    url.searchParams.set('offset', String(offset));
    return json(url.toString(), { headers });
  };
  // The balance gives the account currency; it runs in parallel with the first transactions page.
  const [balRes, first] = await Promise.all([json('https://finance.izettle.com/v2/accounts/liquid/balance', { headers }), page(0)]);
  if (!balRes.ok) throw fail(balRes.status);
  const currency = String(balRes.data?.currencyId ?? balRes.data?.data?.currencyId ?? '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, `${CFG.brand} did not return the account currency.`);

  /** @type {any[]} */
  const rows = [];
  let r = first;
  for (let p = 0; p < 5; p++) {
    if (!r.ok) throw fail(r.status);
    /** @type {any[]} */
    const items = Array.isArray(r.data) ? r.data : Array.isArray(r.data?.data) ? r.data.data : [];
    rows.push(...items);
    if (items.length < PAGE) break;
    r = await page(rows.length);
  }
  /** @param {any} row */
  const uuidOf = (row) => String(row.originatingTransactionUuid ?? row.originatorTransactionUuid ?? '');
  const failedIds = new Set(rows.filter((row) => row.originatorTransactionType === 'FAILED_PAYOUT').map(uuidOf).filter(Boolean));
  /** @type {import('../../lib/reconcile.js').PayoutItem[]} */
  const payouts = [];
  for (const row of rows) {
    const amount = Number(row.amount);
    if (row.originatorTransactionType !== 'PAYOUT' || !Number.isFinite(amount) || amount >= 0) continue;
    const uuid = uuidOf(row) || `${row.timestamp}${amount}`;
    if (failedIds.has(uuid)) continue;
    payouts.push({
      id: uuid,
      date: osloDay(String(row.timestamp ?? '')),
      amountMinor: Math.round(-amount),
      currency,
      reference: uuid,
      detail: 'Liquid account payout',
    });
  }
  return { payouts, failed: rows.filter((row) => row.originatorTransactionType === 'FAILED_PAYOUT').length };
}

/**
 * @returns {{ payouts: import('../../lib/reconcile.js').PayoutItem[], bankTx: import('../../lib/reconcile.js').BankTx[], month: string, currency: string }}
 */
function sampleData() {
  const month = '2026-10';
  const prefix = 'PPOS';
  /** @type {import('../../lib/reconcile.js').PayoutItem[]} */
  const payouts = [
    { id: 'zettle-1', date: '2026-10-06', amountMinor: 1482000, currency: 'NOK', reference: `${prefix}-2610-001`, detail: `Sample ${prefix} payout batch 1` },
    { id: 'zettle-2', date: '2026-10-14', amountMinor: 964500, currency: 'NOK', reference: `${prefix}-2610-002`, detail: `Sample ${prefix} payout batch 2` },
    { id: 'zettle-3', date: '2026-10-27', amountMinor: 712000, currency: 'NOK', reference: `${prefix}-2610-003`, detail: `Sample ${prefix} payout batch 3 (pending settlement)` },
  ];
  /** @type {import('../../lib/reconcile.js').BankTx[]} */
  const bankTx = [
    { id: 9001, amount: 14820.0, currencyCode: 'NOK', transactionDate: '2026-10-07', description: `Utbetaling ${prefix}-2610-001`, paymentReference: `${prefix}-2610-001` },
    { id: 9002, amount: 9645.0, currencyCode: 'NOK', transactionDate: '2026-10-16', description: `${prefix} oppgjør`, paymentReference: null },
  ];
  return { payouts, bankTx, month, currency: 'NOK' };
}

/**
 * @param {{ rows: import('../../lib/reconcile.js').ReconcileRow[], month: string, currency: string, excluded: number, failed: number, bankCount: number, isSample?: boolean }} state
 */
function renderReviewResults(state) {
  const { rows, month, currency, excluded, failed, bankCount, isSample } = state;
  const matched = rows.filter((r) => r.match !== null).length;
  const totalNet = rows.reduce((s, r) => s + r.payout.amountMinor, 0);
  const csvRows = [
    ['provider', 'reference', 'payout_date', 'amount', 'currency', 'match_status', 'reai_bank_transaction_id', 'detail'],
    ...rows.map((r) => [CFG.brand, r.payout.reference, r.payout.date, (r.payout.amountMinor / 100).toFixed(2), r.payout.currency, r.status, r.match ? String(r.match.id) : '', r.payout.detail]),
  ];
  return reaiCard({
    eyebrow: 'RECONCILIATION PREVIEW',
    title: `${CFG.brand} · ${month}`,
    badge: isSample
      ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' })
      : reaiBadge({ text: `${matched}/${rows.length} matched`, tone: matched === rows.length && rows.length > 0 ? 'success' : 'warn' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Payouts', value: String(rows.length), detail: excluded > 0 ? `${excluded} in another currency excluded` : `${currency} account` })}
        ${reaiMetric({ label: 'Net payout total', value: `${formatMinor(totalNet)} ${currency}`, detail: `${bankCount} pending ReAI bank rows` })}
        ${reaiMetric({ label: 'Bank matches', value: `${matched} / ${rows.length}`, detail: 'Within 8 days, exact reference or unique amount' })}
      </div>
      ${failed > 0 ? reaiCallout({ tone: 'warn', body: `${failed} failed payouts were returned to the liquid account this month. Payouts they voided are left out.` }) : ''}
      ${rows.length === 0
        ? reaiCallout({ tone: 'info', body: `No ${currency} payouts found for ${month}.` })
        : html`
          <div class="table-wrap"><table class="data-table">
            <thead><tr><th>Date</th><th>Reference</th><th class="num">Net amount</th><th>Bank match</th><th>ReAI Bank Tx</th><th>Details</th></tr></thead>
            <tbody>${rows.map(
              (r) => html`<tr>
                <td class="mono">${r.payout.date}</td><td class="mono">${r.payout.reference}</td>
                <td class="num">${formatMinor(r.payout.amountMinor)} ${r.payout.currency}</td>
                <td>${reaiBadge({ text: r.status, tone: r.match ? 'success' : 'warn' })}</td>
                <td class="mono">${r.match ? `#${r.match.id} (${r.match.transactionDate})` : 'None'}</td>
                <td>${r.payout.detail}</td>
              </tr>`,
            )}</tbody>
          </table></div>
          <form class="stack-sm" method="post" action="/app/zettle/export">
            <input type="hidden" name="filename" value="zettle-reconciliation-${month}.csv">
            <input type="hidden" name="rowsJson" value="${JSON.stringify(csvRows)}">
            <div><button type="submit" class="button secondary">Download reconciliation CSV</button></div>
          </form>
        `}
    `,
  });
}

/**
 * Handles /app/zettle/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = `/app/zettle`;

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
        ${renderConnectPanel(session, { clientId: 'reai-zettle-web', clientName: `ReAI ${CFG.brand} Reconcile (Web)` })}
        ${reaiCard({
          eyebrow: 'ON-DEMAND REVIEW',
          title: `Fetch ${CFG.brand} payouts`,
          body: html`
            <p class="muted-note">Create an API key with the READ:FINANCE scope at <a href="https://my.zettle.com/apps/api-keys?name=ReAI&amp;scopes=READ:FINANCE" target="_blank" rel="noopener">my.zettle.com/apps/api-keys</a> and copy the client ID shown with it. The key is used only for this request and is never stored.</p>
            <form class="stack" hx-post="${basePath}/review" hx-target="#reconcile-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                ${CFG.fields.map((f) => html`<div class="field"><label for="f-${f.key}">${f.label}</label><input id="f-${f.key}" name="${f.key}" type="${f.secret ? 'password' : 'text'}" autocomplete="off" required placeholder="${f.placeholder}"></div>`)}
                <div class="field"><label for="reconcile-month">Payout month</label><input id="reconcile-month" name="month" type="text" pattern="[0-9]{4}-[0-9]{2}" value="${defaultMonth}" required placeholder="YYYY-MM"></div>
                <div class="field"><label for="reconcile-bank">ReAI bank account</label><select id="reconcile-bank" name="bankId"><option value="0">${banks.length > 0 ? 'Select bank account…' : 'Connect to ReAI to load banks'}</option>${banks.map((b) => html`<option value="${b.id}">${b.displayName} (${b.ledgerAccountNumber} · ${b.currencyCode})</option>`)}</select></div>
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
    return htmlResponse(renderReviewResults({ rows: matchPayouts(s.payouts, s.bankTx), month: s.month, currency: s.currency, excluded: 0, failed: 0, bankCount: s.bankTx.length, isSample: true }));
  }

  if (pathname === `${basePath}/export`) {
    const form = await request.formData();
    const filename = String(form.get('filename') ?? `zettle-reconciliation.csv`);
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
      const [{ payouts: fetched, failed }, bankTx] = await Promise.all([
        fetchZettlePayouts(fields, bounds.start, bounds.end),
        bankId > 0 ? loadPendingBankTransactions(env, session, bankId, bounds.month) : Promise.resolve([]),
      ]);
      const matching = fetched.filter((p) => p.currency === company.currencyCode).sort((a, b) => b.date.localeCompare(a.date));
      const rows = matchPayouts(matching, bankTx);
      return htmlResponse(renderReviewResults({ rows, month: bounds.month, currency: company.currencyCode, excluded: fetched.length - matching.length, failed, bankCount: bankTx.length }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Review failed.';
      return htmlResponse(reaiCallout({ tone: 'danger', title: `Could not review ${CFG.brand}`, body: msg }));
    }
  }

  return errorResponse('Unknown reconciliation route.', 404);
}
