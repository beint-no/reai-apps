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
  ],
  "hasFees": false
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
 * @returns {Promise<import('../../lib/reconcile.js').PayoutItem[]>}
 */

/**
 * @param {Record<string, string>} fields
 * @param {string} start
 * @param {string} end
 * @returns {Promise<import('../../lib/reconcile.js').PayoutItem[]>}
 */
async function fetchVippsPayouts(fields, start, end) {
  const baseHeaders = {
    accept: 'application/json',
    'vipps-system-name': 'reai-apps',
    'vipps-system-version': '1.0.0',
    'ocp-apim-subscription-key': fields.subscriptionKey ?? '',
    'merchant-serial-number': fields.msn ?? '',
  };
  const tokRes = await providerJson(
    'https://api.vipps.no/accesstoken/get',
    {
      method: 'POST',
      headers: {
        ...baseHeaders,
        'content-type': 'application/json',
        client_id: fields.clientId ?? '',
        client_secret: fields.clientSecret ?? '',
      },
      body: '',
    },
    'Vipps',
  );
  if (!tokRes.ok || !tokRes.data?.access_token) {
    throw new HttpError(400, 'Vipps rejected these credentials or Report API access.');
  }
  const token = String(tokRes.data.access_token);
  const authHeaders = { ...baseHeaders, authorization: `Bearer ${token}` };

  /** @type {Array<{ ledgerId: string, currency: string }>} */
  const ledgers = [];
  let cursor = '';
  for (let page = 0; page < 20; page++) {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const lRes = await providerJson(`https://api.vipps.no/settlement/v1/ledgers${q}`, { headers: authHeaders }, 'Vipps');
    if (!lRes.ok) {
      throw new HttpError(400, `Vipps ledger lookup failed (HTTP ${lRes.status}).`);
    }
    const items = Array.isArray(lRes.data?.items) ? lRes.data.items : [];
    ledgers.push(...items);
    cursor = typeof lRes.data?.cursor === 'string' ? lRes.data.cursor : '';
    if (!cursor) {
      break;
    }
  }
  if (ledgers.length === 0) {
    throw new HttpError(400, 'No Vipps Report API ledgers are available for this sales unit.');
  }

  /** @type {import('../../lib/reconcile.js').PayoutItem[]} */
  const payouts = [];
  let cur = new Date(`${start}T00:00:00Z`);
  const limit = new Date(`${end}T00:00:00Z`);
  while (cur < limit) {
    const day = cur.toISOString().slice(0, 10);
    for (const ledger of ledgers) {
      let c = '';
      for (let p = 0; p < 50; p++) {
        const q = c ? `?cursor=${encodeURIComponent(c)}` : '';
        const r = await providerJson(
          `https://api.vipps.no/report/v2/ledgers/${encodeURIComponent(ledger.ledgerId)}/funds/dates/${day}${q}`,
          { headers: authHeaders },
          'Vipps',
        );
        if (r.status === 404) {
          break;
        }
        if (!r.ok) {
          throw new HttpError(400, `Vipps report failed for ${day} (HTTP ${r.status}).`);
        }
        const items = Array.isArray(r.data?.items) ? r.data.items : [];
        for (const row of items) {
          if (row.entryType === 'payout-scheduled' && typeof row.amount === 'number' && row.amount < 0) {
            payouts.push({
              id: `${ledger.ledgerId}:${row.pspReference ?? `${row.ledgerDate}${row.amount}`}`,
              date: String(row.ledgerDate).slice(0, 10),
              amountMinor: -row.amount,
              currency: String(row.currency),
              reference: String(row.reference ?? row.pspReference ?? ''),
              detail: `Ledger ${ledger.ledgerId} · scheduled payout`,
            });
          }
        }
        c = r.data?.hasMore && typeof r.data?.cursor === 'string' ? r.data.cursor : '';
        if (!c) {
          break;
        }
      }
    }
    cur = new Date(cur.getTime() + 86_400_000);
  }
  return payouts;
}

/**
 * @param {Record<string, string>} fields
 * @param {string} start
 * @param {string} end
 * @returns {Promise<import('../../lib/reconcile.js').PayoutItem[]>}
 */

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
 * @param {{ rows: import('../../lib/reconcile.js').ReconcileRow[], month: string, currency: string, excluded: number, bankCount: number, isSample?: boolean, accountID?: string }} state
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
            <form class="stack-sm" method="post" action="/app/vipps/export">
              <input type="hidden" name="filename" value="vipps-reconciliation-${month}.csv">
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
      const [fetched, bankTx] = await Promise.all([
        fetchVippsPayouts(fields, bounds.start, bounds.end),
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
