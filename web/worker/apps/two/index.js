// @ts-check
import { assertPublicHttpsUrl, isoDate, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';
import { pairVoucherRows } from '../../lib/voucher-rows.js';
import { parseCsv } from '../../lib/csv.js';

/** @typedef {{ ref: string, date: string, currency: string, grossMinor: number, paidMinor: number, feeMinor: number, feeVatRate: number, lineCount: number }} TwoSettlement */
/** @typedef {{ payout: string, fee: string, receivable: string }} TwoAccounts */

const BRAND = 'Two';
const BASE_PATH = '/app/two';
const TITLE = 'Two Settlement Accounting';
const LEAD = 'Fetch the Two settlement report for a period and book each payout in ReAI as a review voucher with gross invoice amount, fee and net payout.';
const API = 'https://api.two.inc';
const PAID_TYPES = new Set(['GROSS_PAID', 'NET_PAID', 'PAID']);
const DEFAULT_ACCOUNTS = /** @type {TwoAccounts} */ ({ payout: '1580', fee: '7770', receivable: '1579' });

/** @type {TwoSettlement[]} */
const SAMPLE = [
  { ref: 'TWO-NO-2026-43', date: '2026-10-27', currency: 'NOK', grossMinor: 11800000, paidMinor: 11587600, feeMinor: 212400, feeVatRate: 0, lineCount: 7 },
];

/**
 * Parses a decimal from the Two report ("9200.00", "9,200.00" or "9200,00").
 * @param {string | undefined} raw
 */
function minorOf(raw) {
  let s = String(raw ?? '').trim().replace(/\s/g, '');
  if (!s) return 0;
  s = s.includes('.') && s.includes(',') ? s.replace(/,/g, '') : s.replace(',', '.');
  const n = Number(s.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * Groups settlement report rows into one settlement per Payment Reference.
 * Columns from https://docs.two.inc/docs/guides/settlement-report-guide/.
 * @param {string} csvText
 * @returns {TwoSettlement[]}
 */
export function parseSettlementReport(csvText) {
  const text = csvText.replace(/^﻿/, '').trim();
  if (!text.includes('\n')) return [];
  const doc = parseCsv(text);
  const col = (/** @type {string} */ name) => doc.headers.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());
  const idx = {
    ref: col('Payment Reference'), date: col('Settlement Date'), currency: col('Currency'), type: col('Settlement Type'),
    gross: col('Gross Settlement'), net: col('Net Settlement Amount'), feeRate: col('Total Fee Tax Rate'),
  };
  if (idx.ref < 0 || idx.date < 0 || idx.gross < 0 || idx.net < 0 || idx.type < 0) {
    throw new HttpError(400, 'The Two settlement report is missing Payment Reference, Settlement Date, Settlement Type, Gross Settlement or Net Settlement Amount.');
  }
  /** @type {Map<string, TwoSettlement>} */ const groups = new Map();
  for (const r of doc.rows) {
    const type = String(r[idx.type] ?? '').trim().toUpperCase();
    if (!PAID_TYPES.has(type)) continue;
    const date = isoDate(r[idx.date], '');
    if (!date) continue;
    const ref = String(r[idx.ref] ?? '').trim() || `TWO-${date}`;
    const currency = idx.currency >= 0 ? String(r[idx.currency] ?? '').trim().toUpperCase() || 'NOK' : 'NOK';
    const grossMinor = minorOf(r[idx.gross]);
    const paidMinor = type === 'GROSS_PAID' ? grossMinor : minorOf(r[idx.net]);
    const feeVatRate = idx.feeRate >= 0 ? Number(String(r[idx.feeRate] ?? '').replace(',', '.').replace(/[^0-9.]/g, '')) || 0 : 0;
    const key = `${ref}|${currency}`;
    const g = groups.get(key) ?? { ref, date, currency, grossMinor: 0, paidMinor: 0, feeMinor: 0, feeVatRate: 0, lineCount: 0 };
    g.grossMinor += grossMinor;
    g.paidMinor += paidMinor;
    g.feeMinor = g.grossMinor - g.paidMinor;
    g.feeVatRate = Math.max(g.feeVatRate, feeVatRate > 1 ? feeVatRate : feeVatRate * 100);
    g.lineCount += 1;
    if (date < g.date) g.date = date;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Downloads the Two settlement report for a date range as CSV.
 * Docs: https://docs.two.inc/docs/api/checkout/get-merchant-statement-handler-get/ (GET /v2/merchant/statement with
 * start_date, end_date, filetype=csv, country_code; X-Api-Key header), column reference
 * https://docs.two.inc/docs/guides/settlement-report-guide/ and API keys
 * https://docs.two.inc/docs/guides/getting-api-keys-page/ (Merchant Portal → Settings → Integration → Production).
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<TwoSettlement[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const apiKey = (creds.apiKey ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!apiKey) throw new HttpError(400, 'Enter your Two API key.');
  if (to < from) throw new HttpError(400, 'The end date must be on or after the start date.');
  const url = `${API}/v2/merchant/statement?${new URLSearchParams({ start_date: from, end_date: to, filetype: 'csv', country_code: 'NO' })}`;
  assertPublicHttpsUrl(url);
  const res = await fetchImpl(url, { headers: { 'x-api-key': apiKey, accept: 'text/csv' }, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) {
    throw new HttpError(400, res.status === 401 || res.status === 403 ? 'Two rejected the API key. Use a production key from the Two Merchant Portal.' : `Two returned HTTP ${res.status}.`);
  }
  const settlements = parseSettlementReport(await res.text()).filter((s) => s.currency === 'NOK');
  if (settlements.length === 0) throw new HttpError(400, `Two has no paid NOK settlements between ${from} and ${to}.`);
  return settlements;
}

/** @param {TwoSettlement} s @param {TwoAccounts} a */
function postingsFor(s, a) {
  return [
    { account: a.payout, description: 'Two net payout', signedMinor: s.paidMinor, feeVat: false },
    { account: a.fee, description: 'Two merchant fee', signedMinor: s.feeMinor, feeVat: s.feeVatRate > 0 },
    { account: a.receivable, description: 'Two settled invoices (gross)', signedMinor: -s.grossMinor, feeVat: false },
  ].filter((p) => p.signedMinor !== 0);
}

/** @param {TwoSettlement[]} list @param {TwoAccounts} accounts @param {boolean} isSample */
function renderPreview(list, accounts, isSample) {
  return html`${list.map((s, i) => reaiCard({
    eyebrow: 'TWO → REAI REVIEW VOUCHER',
    title: `${s.ref} · ${s.date}`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${s.lineCount} report lines`, tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: `Net payout (${accounts.payout})`, value: `${formatMinor(s.paidMinor)} NOK`, detail: 'Match against the bank deposit' })}
        ${reaiMetric({ label: `Fee (${accounts.fee})`, value: `${formatMinor(s.feeMinor)} NOK`, detail: s.feeVatRate > 0 ? `Incl. ${s.feeVatRate}% VAT` : 'No VAT' })}
        ${reaiMetric({ label: `Gross invoices (${accounts.receivable})`, value: `${formatMinor(s.grossMinor)} NOK` })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Posting</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${postingsFor(s, accounts).map((p) => html`<tr><td class="mono">${p.account}</td><td>${p.description}</td><td class="num">${p.signedMinor > 0 ? formatMinor(p.signedMinor) : ''}</td><td class="num">${p.signedMinor < 0 ? formatMinor(-p.signedMinor) : ''}</td></tr>`)}</tbody>
      </table></div>
      ${isSample
        ? reaiCallout({ tone: 'info', body: 'Sample Two settlement loaded. Connect to ReAI and fetch a real period above to book it.' })
        : html`<form class="stack-sm confirm-box" hx-post="${BASE_PATH}/book" hx-target="#two-book-${i}" hx-swap="innerHTML">
            <input type="hidden" name="settlementJson" value="${JSON.stringify(s)}"><input type="hidden" name="accountsJson" value="${JSON.stringify(accounts)}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I verified this payout against the Two settlement report and will attach it in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="two-book-${i}" class="stack-sm"></div>`}
    `,
  }))}`;
}

/**
 * Picks the ReAI input VAT code for a VAT-inclusive fee at the given rate.
 * @param {Array<{ code: string, rate: number, vatType: string, amountBasis: string, reverseCharge: boolean }>} codes
 * @param {number} ratePct
 */
function inputVatCode(codes, ratePct) {
  const match = codes.find((c) => c.vatType === 'input_vat' && !c.reverseCharge && c.amountBasis === 'vat_inclusive' && Math.abs(c.rate - ratePct) < 0.001);
  if (!match) throw new HttpError(400, `ReAI has no input VAT code for ${ratePct}% in this company.`);
  return match.code;
}

/** @param {FormData | Record<string, string>} src */
function readAccounts(src) {
  const get = (/** @type {string} */ k) => String((src instanceof FormData ? src.get(k) : src[k]) ?? '').trim();
  const a = { payout: get('payoutAccount') || DEFAULT_ACCOUNTS.payout, fee: get('feeAccount') || DEFAULT_ACCOUNTS.fee, receivable: get('receivableAccount') || DEFAULT_ACCOUNTS.receivable };
  if (![a.payout, a.fee, a.receivable].every((x) => /^[0-9]{4}$/.test(x))) throw new HttpError(400, 'Accounts must be four digits.');
  return a;
}

/**
 * Handles /app/two/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE_PATH && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE_PATH}/`, request.url), 301);
  if (pathname === `${BASE_PATH}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">B2B INVOICE PAYMENTS</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-two-web', clientName: 'ReAI Two (Web)' })}
        ${renderApiFetchCard({
          basePath: BASE_PATH,
          targetId: 'two-output',
          brand: BRAND,
          hint: 'Create a production API key in the Two Merchant Portal under Settings → Integration. Only paid NOK settlements are shown.',
          fields: [
            { name: 'apiKey', label: 'Two API key', type: 'password', placeholder: 'secret_prod_…' },
            { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
            { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
            { name: 'payoutAccount', label: 'Account for the net payout', defaultValue: DEFAULT_ACCOUNTS.payout },
            { name: 'feeAccount', label: 'Account for Two fees', defaultValue: DEFAULT_ACCOUNTS.fee },
            { name: 'receivableAccount', label: 'Account for the receivable on Two', defaultValue: DEFAULT_ACCOUNTS.receivable },
          ],
          sampleAction: true,
        })}
        <div id="two-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderPreview(SAMPLE, DEFAULT_ACCOUNTS, true));
  try {
    const form = await request.formData();
    if (pathname === `${BASE_PATH}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      const accounts = readAccounts(creds);
      return htmlResponse(renderPreview(await fetchApi(creds), accounts, false));
    }
    if (pathname === `${BASE_PATH}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('confirm') !== 'on') throw new HttpError(400, 'Confirm the verification checkbox first.');
      const tenant = session.tenants.find((t) => t.id === session.tenantId);
      if (tenant && tenant.currencyCode !== 'NOK') throw new HttpError(400, `This ReAI company keeps its books in ${tenant.currencyCode}; Two settlements are booked in NOK only.`);
      const s = /** @type {TwoSettlement} */ (JSON.parse(String(form.get('settlementJson') ?? '{}')));
      const accounts = readAccounts(/** @type {Record<string, string>} */ (JSON.parse(String(form.get('accountsJson') ?? '{}'))));
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(s.date)) || s.currency !== 'NOK' || ![s.grossMinor, s.paidMinor, s.feeMinor].every(Number.isInteger) || s.grossMinor - s.paidMinor !== s.feeMinor) {
        throw new HttpError(400, 'The settlement is invalid.');
      }
      const marker = `${BRAND} ${String(s.ref).slice(0, 80)} ${s.date}`;
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (await reaiAll(env, '/api/vouchers', { ...auth, query: { startDate: s.date, endDate: s.date, includeReversed: 'true' } }));
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      const feeCode = s.feeVatRate > 0
        ? inputVatCode(/** @type {Array<{ code: string, rate: number, vatType: string, amountBasis: string, reverseCharge: boolean }>} */ (await reaiRequest(env, '/api/vat-codes', auth)), s.feeVatRate)
        : '0';
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', {
        ...auth,
        method: 'POST',
        body: {
          date: s.date,
          description: marker,
          reviewReason: 'Two settlement imported via apps.reai.no. Check against the Two settlement report.',
          postings: pairVoucherRows(postingsFor(s, accounts).map((p) => ({
            accountNumber: p.account,
            postingDate: s.date,
            currencyCode: 'NOK',
            amount: p.signedMinor / 100,
            vatCode: p.feeVat ? feeCode : '0',
            description: `${BRAND} ${s.ref} · ${p.description}`.slice(0, 200),
          }))),
        },
      }));
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Two error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown Two route.', 404);
}
