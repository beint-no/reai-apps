// @ts-check
import { pairVoucherRows } from '../../lib/voucher-rows.js';
import { fetchJson, isoDate, num, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/** @typedef {'output' | 'input' | 'none'} VatKind */
/** @typedef {{ account: string, description: string, signedMinor: number, ratePct: number | null, kind: VatKind }} VoucherLine */
/** @typedef {{ date: string, ref: string, currency: string, lines: VoucherLine[], debitMinor: number, creditMinor: number }} Voucher */
/** @typedef {{ from: string, to: string, currency: string, count: number, lines: VoucherLine[], payoutsMinor: number, ignored: string[] }} Period */
/** @typedef {{ code: string, rate: number, vatType: string, amountBasis: string, reverseCharge: boolean }} VatCode */

const SLUG = 'billetto';
const BRAND = 'Billetto';
const BASE_PATH = '/app/billetto';
const TITLE = 'Billetto Ticket Sales Accounting';
const EYEBROW = 'EVENTS · TICKETING';
const LEAD = 'Turn the Billetto ledger for a period into a balanced ReAI review voucher: ticket revenue per VAT rate, the fees Billetto deducts and the balance due from Billetto.';
const API_HINT = 'Create a key pair in Billetto under Integrations → Developers → API - Key pairs. Enter the access key ID and the secret.';
/** @type {import('../../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [
  { name: 'keyId', label: 'Access key ID', placeholder: 'Key pair ID' },
  { name: 'secret', label: 'Secret', type: 'password' },
  { name: 'from', label: 'Ledger entries from', type: 'date', defaultValue: '$MONTH_START' },
  { name: 'to', label: 'To', type: 'date', defaultValue: '$TODAY' },
];
const API = 'https://billetto.no/api/v3';
const API_VERSION = '2026-02-10';
const PAGE_LIMIT = 100;
const MAX_PAGES = 45;
const KNOWN_RATES = [25, 15, 12, 0];
/** @type {Record<string, string>} */
const REVENUE_ACCOUNTS = { 25: '3000', 15: '3010', 12: '3020', 0: '3100' };
const REVENUE_TYPES = new Set(['ORDER_REVENUE', 'DISCOUNTS']);
const FEE_TYPES = new Set(['ORGANIZER_PAYMENT_FEE', 'TICKETS_FEE', 'COMMISSION', 'INVOICE_FEE', 'PROMOTION_FEE']);
const PAYOUT_TYPES = new Set(['PAYOUT', 'IMMEDIATE_PAYOUT', 'IMMEDIATE_PAYOUT_WITHDRAWAL']);
const REVERSING = new Set(['REFUND', 'CANCELLATION', 'CHARGEBACK', 'REVERSE_ENTRY']);
const OSLO_PARTS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
const OSLO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * Returns the UTC instant of 00:00 Europe/Oslo on a calendar day.
 * @param {string} day YYYY-MM-DD
 */
function osloMidnightUtc(day) {
  const base = Date.parse(`${day}T00:00:00Z`);
  for (const hours of [1, 2]) {
    const t = base - hours * 3_600_000;
    const parts = OSLO_PARTS.formatToParts(t);
    const get = (/** @type {string} */ type) => parts.find((p) => p.type === type)?.value ?? '';
    if (`${get('year')}-${get('month')}-${get('day')}` === day && get('hour') === '00') return new Date(t).toISOString().replace('.000Z', 'Z');
  }
  return new Date(base).toISOString().replace('.000Z', 'Z');
}

/** @param {string} day @param {number} days */
function shiftDay(day, days) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** @param {unknown} v */
function parseRate(v) {
  if (v === null || v === undefined || v === '' || v === 'NO_VAT') return 0;
  const n = num(v);
  const pct = n > 0 && n < 1 ? n * 100 : n;
  const rate = KNOWN_RATES.find((k) => Math.abs(k - pct) < 0.01);
  if (rate === undefined) throw new HttpError(400, `Billetto sent VAT rate ${String(v)}, which is not a Norwegian rate.`);
  return rate;
}

/**
 * VAT-inclusive amount of one ledger entry in cents. The reference says only "Amount in cents" and "VAT in cents",
 * so the entry's own VAT decides whether `amount` already contains it.
 * @param {any} e @param {number} rate
 */
function grossCents(e, rate) {
  const amount = Math.abs(num(e.amount));
  const vat = Math.abs(num(e.vat));
  if (rate === 0 || vat === 0) return Math.round(amount);
  const inclusive = Math.abs(vat - (amount * rate) / (100 + rate));
  const exclusive = Math.abs(vat - (amount * rate) / 100);
  return Math.round(exclusive < inclusive ? amount + vat : amount);
}

/**
 * Reads the Billetto organiser ledger for a period and sums it into voucher lines.
 * Docs: https://api.billetto.com/reference/list-ledger-2.md (Billetto Public API v3, version 2026-02-10:
 * GET /organiser/ledger_entries with created_after, created_before, after cursor and limit max 100; list has data,
 * has_more and next_url; ledger_entry has entry_type, transaction_type, revenue_channel, currency, vat_rate, amount and
 * vat in cents) and https://go.billetto.com/resources/developers (Api-Keypair header, key pairs under Integrations).
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<Period>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const keyId = (creds.keyId ?? '').trim();
  const secret = (creds.secret ?? '').trim();
  if (!keyId) throw new HttpError(400, 'Enter the Billetto access key ID and secret.');
  const keypair = keyId.includes(':') && !secret ? keyId : `${keyId}:${secret}`;
  if (keypair.endsWith(':')) throw new HttpError(400, 'Enter the Billetto access key ID and secret.');
  const from = isoDate(creds.from);
  const to = isoDate(creds.to);
  if (to < from) throw new HttpError(400, 'The end date is before the start date.');
  const headers = { 'api-keypair': keypair, 'billetto-version': API_VERSION, accept: 'application/json' };

  /** @type {any[]} */ const entries = [];
  const query = new URLSearchParams({ created_after: osloMidnightUtc(from), created_before: osloMidnightUtc(shiftDay(to, 1)), limit: String(PAGE_LIMIT) });
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES) throw new HttpError(400, `The Billetto ledger has more than ${MAX_PAGES * PAGE_LIMIT} entries in this period. Choose a shorter period.`);
    const data = await fetchJson(`${API}/organiser/ledger_entries?${query}`, { headers }, BRAND, fetchImpl);
    /** @type {any[]} */ const rows = Array.isArray(data?.data) ? data.data : [];
    entries.push(...rows);
    const last = rows.at(-1);
    if (!data?.has_more || !last?.id) break;
    query.set('after', String(last.id));
  }

  const inPeriod = entries.filter((e) => {
    const day = OSLO_DAY.format(Date.parse(String(e.created_at ?? e.time ?? '')) || 0);
    return day >= from && day <= to;
  });
  if (inPeriod.length === 0) throw new HttpError(400, `Billetto has no ledger entries from ${from} to ${to}.`);
  const currencies = [...new Set(inPeriod.map((e) => String(e.currency ?? '').toUpperCase()))];
  if (currencies.length !== 1 || !/^[A-Z]{3}$/.test(currencies[0] ?? '')) throw new HttpError(400, `The Billetto ledger mixes currencies (${currencies.join(', ')}). Book each currency separately.`);
  const currency = /** @type {string} */ (currencies[0]);

  /** @type {Map<string, VoucherLine>} */ const byKey = new Map();
  /** @param {string} key @param {Omit<VoucherLine, 'signedMinor'>} base @param {number} minor */
  const add = (key, base, minor) => {
    const line = byKey.get(key) ?? { ...base, signedMinor: 0 };
    line.signedMinor += minor;
    byKey.set(key, line);
  };
  /** @type {Set<string>} */ const ignored = new Set();
  let payoutsMinor = 0;
  for (const e of inPeriod) {
    const type = String(e.entry_type ?? '');
    const tx = String(e.transaction_type ?? '');
    const sign = REVERSING.has(tx) ? -1 : 1;
    const channel = String(e.revenue_channel ?? 'billetto');
    const clearingKey = `clearing:${channel}`;
    const clearingBase = { account: '1580', description: channel === 'billetto' ? 'Due from Billetto' : channel === 'organizer' ? 'Collected by the organiser (own terminal or cash)' : 'Invoiced through Billetto', ratePct: null, kind: /** @type {VatKind} */ ('none') };
    if (REVENUE_TYPES.has(type)) {
      const rate = parseRate(e.vat_rate);
      const gross = sign * grossCents(e, rate) * (type === 'DISCOUNTS' ? -1 : 1);
      add(`rev:${rate}`, { account: REVENUE_ACCOUNTS[String(rate)] ?? '3000', description: `Ticket revenue ${rate}% VAT`, ratePct: rate, kind: 'output' }, -gross);
      add(clearingKey, clearingBase, gross);
    } else if (FEE_TYPES.has(type) || type === 'CHARGEBACK') {
      // A fee only carries input VAT when the entry itself has VAT.
      const rate = type === 'CHARGEBACK' || num(e.vat) === 0 ? 0 : parseRate(e.vat_rate);
      const cost = (tx === 'REVERSE_ENTRY' || (type !== 'CHARGEBACK' && REVERSING.has(tx)) ? -1 : 1) * grossCents(e, rate);
      const label = type === 'CHARGEBACK' ? 'Chargebacks' : `Billetto fees (${type.toLowerCase().replaceAll('_', ' ')})`;
      add(`fee:${type}:${rate}`, { account: type === 'CHARGEBACK' ? '7790' : '7770', description: label, ratePct: rate === 0 ? null : rate, kind: rate === 0 ? 'none' : 'input' }, cost);
      add(clearingKey, clearingBase, -cost);
    } else if (PAYOUT_TYPES.has(type)) {
      payoutsMinor += Math.round(Math.abs(num(e.amount))) * (tx === 'REVERSE_ENTRY' ? -1 : 1);
    } else if (type) {
      ignored.add(type);
    }
  }
  const lines = [...byKey.values()].filter((l) => l.signedMinor !== 0);
  return { from, to, currency, count: inPeriod.length, lines, payoutsMinor, ignored: [...ignored] };
}

/** @param {Period} p @returns {Voucher} */
function buildVoucher(p) {
  const ref = `${p.from} to ${p.to}`;
  const lines = p.lines.map((l) => ({ ...l, description: `${BRAND} ${ref} · ${l.description}` }));
  const debitMinor = lines.filter((l) => l.signedMinor > 0).reduce((t, l) => t + l.signedMinor, 0);
  const creditMinor = lines.filter((l) => l.signedMinor < 0).reduce((t, l) => t - l.signedMinor, 0);
  return { date: p.to, ref, currency: p.currency, lines, debitMinor, creditMinor };
}

/** @type {Period} */
const SAMPLE = {
  from: '2026-10-01',
  to: '2026-10-31',
  currency: 'NOK',
  count: 318,
  payoutsMinor: 8420000,
  ignored: [],
  lines: [
    { account: '1580', description: 'Due from Billetto', signedMinor: 9121500, ratePct: null, kind: 'none' },
    { account: '7770', description: 'Billetto fees (organizer payment fee)', signedMinor: 278500, ratePct: null, kind: 'none' },
    { account: '3100', description: 'Ticket revenue 0% VAT', signedMinor: -7650000, ratePct: 0, kind: 'output' },
    { account: '3000', description: 'Ticket revenue 25% VAT', signedMinor: -1750000, ratePct: 25, kind: 'output' },
  ],
};

/** @param {Voucher} v @param {Period} p @param {boolean} isSample */
function renderPreview(v, p, isSample) {
  const diff = v.debitMinor - v.creditMinor;
  const balanced = diff === 0 && v.debitMinor > 0;
  const revenue = v.lines.filter((l) => l.kind === 'output').reduce((t, l) => t - l.signedMinor, 0);
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI REVIEW VOUCHER`,
    title: `${v.ref}`,
    badge: balanced ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }) : reaiBadge({ text: `Diff ${formatMinor(Math.abs(diff))} ${v.currency}`, tone: 'danger' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Ledger entries', value: String(p.count) })}
        ${reaiMetric({ label: 'Ticket revenue incl. VAT', value: `${formatMinor(revenue)} ${v.currency}` })}
        ${reaiMetric({ label: 'Payouts in period', value: `${formatMinor(p.payoutsMinor)} ${v.currency}`, detail: 'Not booked here; match them in bank reconciliation' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Posting</th><th>VAT</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${v.lines.map((l) => html`<tr><td class="mono">${l.account}</td><td>${l.description}</td><td>${l.ratePct === null ? 'None' : `${l.kind === 'input' ? 'Input' : 'Output'} ${l.ratePct}%`}</td><td class="num">${l.signedMinor > 0 ? formatMinor(l.signedMinor) : ''}</td><td class="num">${l.signedMinor < 0 ? formatMinor(-l.signedMinor) : ''}</td></tr>`)}</tbody>
      </table></div>
      ${p.ignored.length ? reaiCallout({ tone: 'warn', body: `Entry types not booked here: ${p.ignored.join(', ')}. Check them in Billetto.` }) : ''}
      <p class="muted-note">Ticket revenue is posted including VAT with the matching ReAI VAT code, so ReAI separates base and VAT. Tickets without VAT use the exempt code. The balance stays on clearing account 1580 until the Billetto payout is matched against the bank.</p>
      ${balanced && !isSample
        ? html`<form class="stack-sm confirm-box" hx-post="${BASE_PATH}/book" hx-target="#${SLUG}-book" hx-swap="innerHTML">
            <input type="hidden" name="voucherJson" value="${JSON.stringify(v)}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I verified these figures against the ${BRAND} financial report and will attach it in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="${SLUG}-book" class="stack-sm"></div>`
        : isSample
          ? reaiCallout({ tone: 'info', body: `Sample ${BRAND} period loaded. Connect to ReAI and fetch a real period above to book it.` })
          : reaiCallout({ tone: 'warn', body: 'The ledger does not add up to a positive amount for this period. Check it in Billetto before booking.' })}
    `,
  });
}

/**
 * Picks the ReAI VAT code for a VAT-inclusive voucher line.
 * @param {VatCode[]} codes @param {VoucherLine} l
 */
function vatCodeFor(codes, l) {
  if (l.kind === 'none' || l.ratePct === null) return '0';
  const pct = l.ratePct;
  const usable = codes.filter((c) => !c.reverseCharge && c.amountBasis === 'vat_inclusive' && Math.abs(c.rate - pct) < 0.001);
  const match = l.kind === 'input'
    ? usable.find((c) => c.vatType === 'input_vat')
    : pct > 0
      ? usable.find((c) => c.vatType === 'output_vat')
      : (usable.find((c) => c.vatType === 'exempt') ?? usable.find((c) => c.vatType === 'outside_scope') ?? usable.find((c) => c.vatType === 'output_vat'));
  if (!match) throw new HttpError(400, `ReAI has no ${l.kind} VAT code for ${pct}% in this company.`);
  return match.code;
}

/**
 * Handles /app/billetto/* routes.
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
      <section class="app-intro"><p class="eyebrow">${EYEBROW}</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${SLUG}-web`, clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({ basePath: BASE_PATH, targetId: `${SLUG}-output`, brand: BRAND, hint: API_HINT, fields: API_FIELDS, sampleAction: true })}
        <div id="${SLUG}-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderPreview(buildVoucher(SAMPLE), SAMPLE, true));
  try {
    const form = await request.formData();
    if (pathname === `${BASE_PATH}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      const period = await fetchApi(creds);
      return htmlResponse(renderPreview(buildVoucher(period), period, false));
    }
    if (pathname === `${BASE_PATH}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('confirm') !== 'on') throw new HttpError(400, 'Confirm the verification checkbox first.');
      const v = /** @type {Voucher} */ (JSON.parse(String(form.get('voucherJson') ?? '{}')));
      if (!Array.isArray(v.lines) || !v.lines.length || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(v.date)) || !/^[A-Z]{3}$/.test(String(v.currency))) throw new HttpError(400, 'Voucher is empty.');
      const company = session.tenants.find((t) => t.id === session.tenantId);
      if (company && company.currencyCode !== v.currency) throw new HttpError(400, `The Billetto ledger is in ${v.currency}, but the ReAI company uses ${company.currencyCode}.`);
      const sum = v.lines.reduce((t, l) => t + Math.round(Number(l.signedMinor)), 0);
      if (sum !== 0 || !v.lines.every((l) => /^[0-9]{4}$/.test(String(l.account)))) throw new HttpError(400, 'Voucher must balance to 0.00.');
      const marker = `${BRAND} ${String(v.ref).slice(0, 80)}`;
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const [existing, vatCodes] = await Promise.all([
        /** @type {Promise<Array<{ id: number, number: string, description?: string | null }>>} */ (reaiAll(env, '/api/vouchers', { ...auth, query: { startDate: v.date, endDate: v.date, includeReversed: 'true' } })),
        /** @type {Promise<VatCode[]>} */ (reaiRequest(env, '/api/vat-codes', auth)),
      ]);
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', {
        ...auth,
        method: 'POST',
        body: {
          date: v.date,
          description: marker,
          reviewReason: `${BRAND} ledger imported via apps.reai.no. Check against the ${BRAND} financial report.`,
          postings: pairVoucherRows(v.lines.map((l) => ({
            accountNumber: String(l.account),
            postingDate: v.date,
            currencyCode: v.currency,
            amount: Number((Math.round(Number(l.signedMinor)) / 100).toFixed(2)),
            vatCode: vatCodeFor(vatCodes, l),
            description: String(l.description).slice(0, 200),
          }))),
        },
      }));
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
