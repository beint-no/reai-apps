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
  "brand": "Vipps",
  "title": "Vipps Reconcile",
  "lead": "Compare Vipps MobilePay scheduled payouts against pending ReAI bank transactions for one month and export a CSV report.",
  "fields": [
    {
      "key": "clientId",
      "label": "Client ID",
      "placeholder": "Sales unit client_id"
    },
    {
      "key": "clientSecret",
      "label": "Client secret",
      "secret": true,
      "placeholder": "Sales unit client_secret"
    },
    {
      "key": "subscriptionKey",
      "label": "Ocp-Apim-Subscription-Key",
      "secret": true,
      "placeholder": "Subscription key"
    },
    {
      "key": "msn",
      "label": "Merchant Serial Number (MSN)",
      "placeholder": "123456"
    }
  ]
};

const API = 'https://api.vipps.no';
/** Provider calls allowed per review (token + ledgers + one funds report per ledger date, plus extra pages). */
const MAX_PROVIDER_CALLS = 45;
/** Parallel per-date funds requests. */
const CONCURRENCY = 6;
const OSLO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {{ calls: number }} budget
 * @param {typeof fetch} fetchImpl
 */
async function providerJson(url, init, budget, fetchImpl) {
  budget.calls += 1;
  if (budget.calls > MAX_PROVIDER_CALLS) {
    throw new HttpError(400, 'This month has too many Vipps report pages to review in one go. Contact Vipps MobilePay to raise the page size for the ledger, or use the settlement report in the business portal.');
  }
  const res = await fetchImpl(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(25_000) });
  if (res.status >= 300 && res.status < 400) {
    throw new HttpError(502, 'Vipps returned an unexpected redirect.');
  }
  if (res.status === 429) {
    throw new HttpError(400, 'Vipps MobilePay is rate limiting requests. Wait a minute and try again.');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: res.status, ok: res.ok, data };
}

/**
 * Lists every date (YYYY-MM-DD) in [start, end) that is not after today in Europe/Oslo.
 * @param {string} start
 * @param {string} end
 * @param {number} [now]
 */
export function ledgerDates(start, end, now = Date.now()) {
  const today = OSLO_DAY.format(new Date(now));
  const out = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t < Date.parse(`${end}T00:00:00Z`); t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    if (day > today) break;
    out.push(day);
  }
  return out;
}

/**
 * Fetches scheduled payouts from the Report API v2 for one month.
 * Docs: https://developer.vippsmobilepay.com/docs/APIs/report-api/api-guide/fetching-report-data/
 * Calls: POST /accesstoken/get, GET /settlement/v1/ledgers, then GET /report/v2/ledgers/{id}/funds/dates/{date}
 * once per ledger date (there is no date-range parameter), following `cursor` while `hasMore`.
 * @param {Record<string, string>} fields
 * @param {string} start
 * @param {string} end
 * @param {typeof fetch} [fetchImpl]
 * @param {number} [now]
 * @returns {Promise<{ payouts: import('../../lib/reconcile.js').PayoutItem[], openDates: number, calls: number }>}
 */
export async function fetchVippsPayouts(fields, start, end, fetchImpl = fetch, now = Date.now()) {
  const budget = { calls: 0 };
  const msn = (fields.msn ?? '').trim();
  const baseHeaders = {
    accept: 'application/json',
    'vipps-system-name': 'reai-apps',
    'vipps-system-version': '1.0.0',
    'ocp-apim-subscription-key': fields.subscriptionKey ?? '',
    'merchant-serial-number': msn,
  };
  const tokRes = await providerJson(
    `${API}/accesstoken/get`,
    { method: 'POST', headers: { ...baseHeaders, 'content-type': 'application/json', client_id: fields.clientId ?? '', client_secret: fields.clientSecret ?? '' }, body: '' },
    budget,
    fetchImpl,
  );
  if (!tokRes.ok || !tokRes.data?.access_token) {
    throw new HttpError(400, 'Vipps MobilePay rejected the client ID, client secret, subscription key or MSN. Use the production keys for the sales unit.');
  }
  const authHeaders = { ...baseHeaders, authorization: `Bearer ${String(tokRes.data.access_token)}` };

  /** @type {Array<{ ledgerId: string, currency: string, settlesForRecipientHandles?: string[] }>} */
  const ledgers = [];
  let cursor = '';
  for (let page = 0; page < 5; page++) {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const lRes = await providerJson(`${API}/settlement/v1/ledgers${q}`, { headers: authHeaders }, budget, fetchImpl);
    if (!lRes.ok) {
      throw new HttpError(400, lRes.status === 401 || lRes.status === 403 || lRes.status === 404
        ? 'These keys have no Report API access. Vippsnummer sales units cannot use the Report API.'
        : `Vipps ledger lookup failed (HTTP ${lRes.status}).`);
    }
    ledgers.push(...(Array.isArray(lRes.data?.items) ? lRes.data.items : []));
    cursor = typeof lRes.data?.cursor === 'string' ? lRes.data.cursor : '';
    if (!cursor) break;
  }
  // Since February 2025 each ledger belongs to one sales unit; keep the one for this MSN when several are visible.
  const forMsn = ledgers.filter((l) => (l.settlesForRecipientHandles ?? []).some((h) => String(h).split(':').pop() === msn));
  const selected = forMsn.length > 0 ? forMsn : ledgers;
  if (selected.length === 0) {
    throw new HttpError(400, 'No Report API ledger is available for this sales unit.');
  }

  const tasks = selected.flatMap((ledger) => ledgerDates(start, end, now).map((day) => ({ ledger, day })));
  /** @type {import('../../lib/reconcile.js').PayoutItem[]} */
  const payouts = [];
  let openDates = 0;
  /** @param {{ ledger: { ledgerId: string }, day: string }} task */
  const runTask = async ({ ledger, day }) => {
    let c = '';
    for (let p = 0; p < 20; p++) {
      const q = c ? `?cursor=${encodeURIComponent(c)}` : '';
      const r = await providerJson(`${API}/report/v2/ledgers/${encodeURIComponent(ledger.ledgerId)}/funds/dates/${day}${q}`, { headers: authHeaders }, budget, fetchImpl);
      if (r.status === 404) throw new HttpError(400, `Vipps MobilePay denied access to ledger ${ledger.ledgerId}. Check the keys and that Report API access is granted in the business portal.`);
      if (!r.ok) throw new HttpError(400, `Vipps report failed for ${day} (HTTP ${r.status}).`);
      if (r.data?.tryLater) openDates += 1;
      for (const row of Array.isArray(r.data?.items) ? r.data.items : []) {
        // payout-scheduled lowers the ledger balance, so its amount is negative (minor units).
        if (row.entryType === 'payout-scheduled' && Number.isInteger(row.amount) && row.amount < 0) {
          payouts.push({
            id: String(row.pspReference ?? `${ledger.ledgerId}:${row.ledgerDate}`),
            date: String(row.ledgerDate ?? day).slice(0, 10),
            amountMinor: -row.amount,
            currency: String(row.currency ?? '').toUpperCase(),
            reference: String(row.reference ?? row.pspReference ?? ''),
            detail: `Ledger ${ledger.ledgerId} · payout ${String(row.pspReference ?? '')}`,
          });
        }
      }
      c = r.data?.hasMore && typeof r.data?.cursor === 'string' && r.data.cursor ? r.data.cursor : '';
      if (!c) return;
    }
  };
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      if (task) await runTask(task);
    }
  }));
  payouts.sort((a, b) => a.date.localeCompare(b.date));
  return { payouts, openDates, calls: budget.calls };
}

/**
 * @returns {{ payouts: import('../../lib/reconcile.js').PayoutItem[], bankTx: import('../../lib/reconcile.js').BankTx[], month: string, currency: string }}
 */
function sampleData() {
  const month = '2026-10';
  const prefix = 'VIPPS';
  /** @type {import('../../lib/reconcile.js').PayoutItem[]} */
  const payouts = [
    { id: 'vipps-1', date: '2026-10-06', amountMinor: 1482000, currency: 'NOK', reference: `${prefix}-2610-001`, detail: `Sample ${prefix} payout batch 1` },
    { id: 'vipps-2', date: '2026-10-14', amountMinor: 964500, currency: 'NOK', reference: `${prefix}-2610-002`, detail: `Sample ${prefix} payout batch 2` },
    { id: 'vipps-3', date: '2026-10-27', amountMinor: 712000, currency: 'NOK', reference: `${prefix}-2610-003`, detail: `Sample ${prefix} payout batch 3 (pending settlement)` },
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
          ${reaiMetric({ label: 'Payouts', value: String(rows.length), detail: `${excluded} other-currency excluded` })}
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
            <form class="stack-sm" method="post" action="/app/vipps/export">
              <input type="hidden" name="filename" value="vipps-reconciliation-${month}.csv">
              <input type="hidden" name="rowsJson" value="${JSON.stringify(csvRows)}">
              <div><button type="submit" class="button secondary">Download reconciliation CSV ↓</button></div>
            </form>
          `}
      `,
    })}
  `;
}

/**
 * Handles /app/vipps/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = `/app/vipps`;

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
        ${renderConnectPanel(session, { clientId: 'reai-vipps-web', clientName: `ReAI ${CFG.brand} Reconcile (Web)` })}
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
    const filename = String(form.get('filename') ?? `vipps-reconciliation.csv`);
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
      const [{ payouts: fetched, openDates }, bankTx] = await Promise.all([
        fetchVippsPayouts(fields, bounds.start, bounds.end),
        bankId > 0 ? loadPendingBankTransactions(env, session, bankId, bounds.month) : Promise.resolve([]),
      ]);
      const matching = fetched.filter((p) => p.currency === company.currencyCode).sort((a, b) => b.date.localeCompare(a.date));
      const rows = matchPayouts(matching, bankTx);
      const note = openDates > 0 ? reaiCallout({ tone: 'info', body: `${openDates === 1 ? 'One ledger date is' : 'Some ledger dates are'} still open in Vipps MobilePay, so a payout for that date may not be listed yet.` }) : '';
      return htmlResponse(html`${note}${renderReviewResults({ rows, month: bounds.month, currency: company.currencyCode, excluded: fetched.length - matching.length, bankCount: bankTx.length })}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Review failed.';
      return htmlResponse(reaiCallout({ tone: 'danger', title: `Could not review ${CFG.brand}`, body: msg }));
    }
  }

  return errorResponse('Unknown reconciliation route.', 404);
}
