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
  "brand": "Klarna",
  "title": "Klarna Reconcile",
  "lead": "Compare Klarna settlement payouts against pending ReAI bank transactions for one month and export a CSV report.",
  "fields": [
    {
      "key": "apiKey",
      "label": "Klarna API key",
      "secret": true,
      "placeholder": "klarna_live_api_\u2026"
    }
  ]
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
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

/**
 * Returns the UTC instant of 00:00 Europe/Oslo on the given day.
 * @param {string} day YYYY-MM-DD
 * @returns {Date}
 */
function osloMidnight(day) {
  const guess = new Date(`${day}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', hourCycle: 'h23' }).formatToParts(guess);
  const offsetHours = Number(parts.find((x) => x.type === 'hour')?.value ?? '0');
  return new Date(guess.getTime() - offsetHours * 3_600_000);
}

/**
 * Formats an ISO instant as the Europe/Oslo calendar day.
 * @param {string} iso
 * @returns {string}
 */
function osloDay(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso.slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
}

/** Documented maximum page size for GET /settlements/v1/payouts. */
const PAGE_SIZE = 500;

/**
 * Lists Klarna payouts with a payout date in the month (Europe/Oslo days), filtered server-side by currency.
 * @param {Record<string, string>} fields
 * @param {string} start First day of the month, YYYY-MM-DD.
 * @param {string} end First day of the next month, YYYY-MM-DD.
 * @param {string} currency ISO 4217 currency of the ReAI company.
 * @returns {Promise<import('../../lib/reconcile.js').PayoutItem[]>}
 */
async function fetchKlarnaPayouts(fields, start, end, currency) {
  const key = (fields.apiKey ?? '').trim();
  if (!/^klarna_live_api_[A-Za-z0-9_.+/=*-]+$/.test(key)) {
    throw new HttpError(400, 'Paste a live Klarna API key beginning with klarna_live_api_ from the Klarna Partner Portal.');
  }
  const from = osloMidnight(start).toISOString().replace('.000Z', 'Z');
  const to = new Date(osloMidnight(end).getTime() - 1000).toISOString().replace('.000Z', 'Z');
  /** @type {import('../../lib/reconcile.js').PayoutItem[]} */
  const payouts = [];
  let offset = 0;
  for (let p = 0; p < 10; p++) {
    const url = new URL('https://api.klarna.com/settlements/v1/payouts');
    url.searchParams.set('start_date', from);
    url.searchParams.set('end_date', to);
    url.searchParams.set('currency_code', currency);
    url.searchParams.set('size', String(PAGE_SIZE));
    url.searchParams.set('offset', String(offset));
    const r = await providerJson(
      url.toString(),
      { headers: { authorization: `Basic ${key}`, accept: 'application/json' } },
      'Klarna',
    );
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) throw new HttpError(400, 'Klarna rejected this API key or it lacks access to settlements. Create a live API key in the Klarna Partner Portal.');
      if (r.status === 429) throw new HttpError(429, 'Klarna is rate limiting this key. Wait a minute and try again.');
      const detail = Array.isArray(r.data?.error_messages) ? ` ${r.data.error_messages.join(' ')}` : '';
      throw new HttpError(400, `Klarna returned HTTP ${r.status}.${detail}`);
    }
    const items = Array.isArray(r.data?.payouts) ? r.data.payouts : [];
    for (const item of items) {
      const t = item.totals ?? {};
      payouts.push({
        id: String(item.payment_reference),
        date: osloDay(String(item.payout_date)),
        amountMinor: Math.round(Number(t.settlement_amount ?? 0)),
        currency: String(item.currency_code),
        reference: String(item.payment_reference),
        detail: `Sales ${formatMinor(Number(t.sale_amount ?? 0))}, returns ${formatMinor(Number(t.return_amount ?? 0))}, fees ${formatMinor(Number(t.fee_amount ?? 0))}${Number(t.holdback_amount ?? 0) ? `, holdback ${formatMinor(Number(t.holdback_amount))}` : ''} (${item.merchant_settlement_type ?? 'NET'})`,
      });
    }
    offset += items.length;
    const total = typeof r.data?.pagination?.total === 'number' ? r.data.pagination.total : Infinity;
    if (items.length < PAGE_SIZE || offset >= total) {
      return payouts;
    }
  }
  throw new HttpError(400, 'Klarna returned more payouts than one review can show. Contact ReAI support.');
}

/**
 * @returns {{ payouts: import('../../lib/reconcile.js').PayoutItem[], bankTx: import('../../lib/reconcile.js').BankTx[], month: string, currency: string }}
 */
function sampleData() {
  const month = '2026-10';
  const prefix = 'KLARNA';
  /** @type {import('../../lib/reconcile.js').PayoutItem[]} */
  const payouts = [
    { id: 'klarna-1', date: '2026-10-06', amountMinor: 1482000, currency: 'NOK', reference: `${prefix}-2610-001`, detail: `Sample ${prefix} payout batch 1` },
    { id: 'klarna-2', date: '2026-10-14', amountMinor: 964500, currency: 'NOK', reference: `${prefix}-2610-002`, detail: `Sample ${prefix} payout batch 2` },
    { id: 'klarna-3', date: '2026-10-27', amountMinor: 712000, currency: 'NOK', reference: `${prefix}-2610-003`, detail: `Sample ${prefix} payout batch 3 (pending settlement)` },
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
  const csvRows = [
    ['provider', 'reference', 'payout_date', 'amount', 'currency', 'match_status', 'reai_bank_transaction_id', 'detail'],
    ...rows.map((r) => [CFG.brand, r.payout.reference, r.payout.date, (r.payout.amountMinor / 100).toFixed(2), r.payout.currency, r.status, r.match ? String(r.match.id) : '', r.payout.detail]),
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
          ${reaiMetric({ label: 'Payouts', value: String(rows.length), detail: excluded > 0 ? `${excluded} other-currency excluded` : `${currency} only` })}
          ${reaiMetric({ label: 'Net payout total', value: `${formatMinor(totalNet)} ${currency}`, detail: `${bankCount} pending ReAI bank rows` })}
          ${reaiMetric({ label: 'Bank matches', value: `${matched} / ${rows.length}`, detail: '±8 day window, exact ref or unique amount' })}
        </div>

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
                  <td class="mono">${r.match ? `#${r.match.id} (${r.match.transactionDate})` : '—'}</td>
                  <td>${r.payout.detail}</td>
                </tr>`,
              )}</tbody>
            </table></div>
            <form class="stack-sm" method="post" action="/app/klarna/export">
              <input type="hidden" name="filename" value="klarna-reconciliation-${month}.csv">
              <input type="hidden" name="rowsJson" value="${JSON.stringify(csvRows)}">
              <div><button type="submit" class="button secondary">Download reconciliation CSV ↓</button></div>
            </form>
          `}
      `,
    })}
  `;
}

/**
 * Handles /app/klarna/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = `/app/klarna`;

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
        ${renderConnectPanel(session, { clientId: 'reai-klarna-web', clientName: `ReAI ${CFG.brand} Reconcile (Web)` })}
        ${reaiCard({
          eyebrow: 'ON-DEMAND REVIEW',
          title: `Fetch ${CFG.brand} payouts`,
          body: html`
            <p class="muted-note">Provider credentials are used only for this single HTTPS request and are never stored in cookies, browser storage or a database.</p>
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
    return htmlResponse(renderReviewResults({ rows: matchPayouts(s.payouts, s.bankTx), month: s.month, currency: s.currency, excluded: 0, bankCount: s.bankTx.length, isSample: true }));
  }

  if (pathname === `${basePath}/export`) {
    const form = await request.formData();
    const filename = String(form.get('filename') ?? `klarna-reconciliation.csv`);
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
        fetchKlarnaPayouts(fields, bounds.start, bounds.end, company.currencyCode),
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
