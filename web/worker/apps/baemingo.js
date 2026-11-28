// @ts-check
import { pairVoucherRows } from '../lib/voucher-rows.js';
import { fetchJson, isoDate, num, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/** @typedef {{ label: string, amountMinor: number, account?: string }} Payment */
/** @typedef {{ ratePct: number, grossMinor: number, account?: string, label?: string, vatCode?: string }} SalesRate */
/** @typedef {{ date: string, ref: string, payments: Payment[], sales: SalesRate[], tipsMinor: number }} Settlement */
/** @typedef {{ account: string, description: string, signedMinor: number, ratePct: number | null, vatMinor: number, vatCode?: string }} VoucherLine */
/** @typedef {{ date: string, ref: string, lines: VoucherLine[], debitMinor: number, creditMinor: number }} Voucher */

/** @type {Record<string, string>} */
const REVENUE_ACCOUNTS = { 25: '3000', 15: '3010', 12: '3020' };

/**
 * Adds an amount to a keyed running total.
 * @param {Map<string, number>} totals
 * @param {string} key
 * @param {number} amountMinor
 */
function addTo(totals, key, amountMinor) {
  totals.set(key, (totals.get(key) ?? 0) + amountMinor);
}

/**
 * Turns keyed totals into a settlement.
 * @param {string} date
 * @param {string} ref
 * @param {Map<string, number>} payments
 * @param {Map<string, number>} salesByRate
 * @param {number} tipsMinor
 * @returns {Settlement}
 */
function toSettlement(date, ref, payments, salesByRate, tipsMinor) {
  return {
    date,
    ref,
    payments: [...payments].filter(([, a]) => a !== 0).map(([label, amountMinor]) => ({ label, amountMinor })),
    sales: [...salesByRate].filter(([, a]) => a !== 0).map(([rate, grossMinor]) => ({ ratePct: Number(rate), grossMinor })).sort((a, b) => b.ratePct - a.ratePct),
    tipsMinor,
  };
}

const SLUG = 'baemingo';
const BRAND = 'Baemingo';
const BASE_PATH = '/app/baemingo';
const TITLE = 'Baemingo Daily Sales Accounting';
const EYEBROW = 'HOSPITALITY POS';
const LEAD = 'Total one Baemingo business day of orders, refunds and tips into a balanced ReAI review voucher with sales split by VAT rate and payments by method.';
const API_HINT = 'Create a key in Baemingo Admin under Integrations → Public API (admin.baemingo.com/integrations/api). Each key belongs to one venue.';
/** @type {import('../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [
  { name: 'apiKey', label: 'Baemingo API key', type: 'password', placeholder: 'x-api-key' },
  { name: 'date', label: 'Business day', type: 'date', defaultValue: '$TODAY' },
];
const API = 'https://public-api.baemingo.se';

/** @type {Settlement} */
const SAMPLE = {
  date: '2026-10-24',
  ref: 'Bar Eksempel',
  payments: [
    { label: 'CARD', amountMinor: 3864000 },
    { label: 'CASH', amountMinor: 210000 },
    { label: 'VIPPS', amountMinor: 518000 },
  ],
  sales: [
    { ratePct: 25, grossMinor: 3912000 },
    { ratePct: 15, grossMinor: 520000 },
  ],
  tipsMinor: 160000,
};

/**
 * Adds a signed per-rate amount set to the day totals and puts any rest
 * (service fee, rounding) on the order's largest VAT rate so the order balances.
 * @param {Map<string, number>} salesByRate
 * @param {Map<string, number>} orderRates
 * @param {number} restMinor
 */
function addOrderSales(salesByRate, orderRates, restMinor) {
  let topRate = '25';
  let topAmount = -1;
  for (const [rate, amount] of orderRates) {
    addTo(salesByRate, rate, amount);
    if (Math.abs(amount) > topAmount) {
      topAmount = Math.abs(amount);
      topRate = rate;
    }
  }
  if (restMinor !== 0) addTo(salesByRate, topRate, restMinor);
}

/**
 * Fetches one Baemingo business day (04:00 UTC to 04:00 UTC) and totals it.
 * Docs: https://docs.baemingo.se/ (x-api-key header, key from admin.baemingo.com/integrations/api),
 * https://docs.baemingo.se/skills/baemingo-openapi/resources/orders.md (GET /orders?date=YYYY-MM-DD,
 * not paginated, amounts in øre including VAT, entries of type ORDER, REFUND and TIP_REFUND) and
 * https://docs.baemingo.se/skills/baemingo-openapi/resources/me.md (GET /me).
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<Settlement>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const date = isoDate(creds.date);
  const apiKey = (creds.apiKey ?? '').trim();
  if (!apiKey) throw new HttpError(400, 'Enter your Baemingo API key.');
  const headers = { 'x-api-key': apiKey, accept: 'application/json' };
  const me = await fetchJson(`${API}/me`, { headers }, BRAND, fetchImpl);
  const data = await fetchJson(`${API}/orders?${new URLSearchParams({ date })}`, { headers }, BRAND, fetchImpl);
  /** @type {any[]} */ const entries = Array.isArray(data?.orders) ? data.orders : [];
  /** @type {Map<string, number>} */ const payments = new Map();
  /** @type {Map<string, number>} */ const salesByRate = new Map();
  let tipsMinor = 0;
  let count = 0;
  for (const entry of entries) {
    const d = entry?.data ?? {};
    if (entry?.type === 'ORDER') {
      count++;
      const tip = Math.round(num(d.intTip));
      /** @type {Map<string, number>} */ const rates = new Map();
      for (const item of Array.isArray(d.items) ? d.items : []) addTo(rates, String(num(item.vatRate)), Math.round(num(item.intAmountAfterDiscount)));
      /** @type {any[]} */ const pms = Array.isArray(d.paymentMethods) ? d.paymentMethods : [];
      const payTotal = pms.reduce((t, p) => t + Math.round(num(p.intAmount)), 0);
      const paid = Math.round(num(d.intAmountAfterDiscounts)) + Math.round(num(d.intServiceFee));
      const includesTip = tip !== 0 && payTotal === paid + tip;
      let settled = 0;
      for (const p of pms) {
        const amount = Math.round(num(p.intAmount)) + (includesTip ? 0 : Math.round(num(p.intTip)));
        settled += amount;
        addTo(payments, String(p.type || d.paymentMethod || 'UNKNOWN'), amount);
      }
      if (pms.length === 0) {
        settled = paid + tip;
        addTo(payments, String(d.paymentMethod || 'UNKNOWN'), settled);
      }
      tipsMinor += tip;
      const itemTotal = [...rates.values()].reduce((t, a) => t + a, 0);
      addOrderSales(salesByRate, rates, settled - tip - itemTotal);
    } else if (entry?.type === 'REFUND') {
      count++;
      /** @type {Map<string, number>} */ const rates = new Map();
      for (const item of Array.isArray(d.items) ? d.items : []) addTo(rates, String(num(item.vatRate)), -Math.round(num(item.amount) - num(item.discount)));
      /** @type {any[]} */ const refunds = Array.isArray(d.payments) ? d.payments : [];
      let settled = 0;
      for (const p of refunds) {
        const amount = -Math.round(num(p.amountRefunded));
        settled += amount;
        addTo(payments, String(p.type || d.paymentMethod || 'UNKNOWN'), amount);
      }
      if (refunds.length === 0) {
        settled = -Math.round(num(d.amountAfterDiscounts));
        addTo(payments, String(d.paymentMethod || 'UNKNOWN'), settled);
      }
      const itemTotal = [...rates.values()].reduce((t, a) => t + a, 0);
      addOrderSales(salesByRate, rates, settled - itemTotal);
    } else if (entry?.type === 'TIP_REFUND') {
      const change = Math.round(num(d.newTipAmount) - num(d.previousTipAmount));
      if (change !== 0) {
        tipsMinor += change;
        addTo(payments, String(d.paymentType || 'UNKNOWN'), change);
      }
    }
  }
  if (count === 0) throw new HttpError(400, `Baemingo has no orders or refunds on ${date}.`);
  const venue = String(me?.venueName ?? me?.name ?? 'venue').trim();
  return toSettlement(date, venue, payments, salesByRate, tipsMinor);
}

/** @param {string} label */
function paymentAccount(label) {
  return /^(cash|kontant)/i.test(label.trim()) ? '1900' : '1580';
}

/** @param {number} ratePct */
function revenueAccount(ratePct) {
  return REVENUE_ACCOUNTS[String(ratePct)] ?? '3100';
}

/** @param {number} grossMinor @param {number} pct */
function splitVat(grossMinor, pct) {
  if (pct <= 0 || grossMinor === 0) return { net: grossMinor, vat: 0 };
  const net = Math.round((grossMinor * 100) / (100 + pct));
  return { net, vat: grossMinor - net };
}

/** @param {Settlement} s @returns {Voucher} */
function buildVoucher(s) {
  /** @type {VoucherLine[]} */ const lines = [];
  const pfx = `${BRAND} ${s.ref}`;
  for (const p of s.payments) {
    if (p.amountMinor !== 0) lines.push({ account: p.account ?? paymentAccount(p.label), description: `${pfx} · ${p.label}`, signedMinor: p.amountMinor, ratePct: null, vatMinor: 0 });
  }
  for (const r of s.sales) {
    if (r.grossMinor !== 0) {
      const { vat } = r.vatCode ? { vat: 0 } : splitVat(r.grossMinor, r.ratePct);
      lines.push({ account: r.account ?? revenueAccount(r.ratePct), description: `${pfx} · ${r.label ?? `Sales ${r.ratePct}% VAT`}`, signedMinor: -r.grossMinor, ratePct: r.ratePct, vatMinor: -vat, ...(r.vatCode ? { vatCode: r.vatCode } : {}) });
    }
  }
  if (s.tipsMinor !== 0) lines.push({ account: '2930', description: `${pfx} · Staff tips payable`, signedMinor: -s.tipsMinor, ratePct: null, vatMinor: 0 });
  const debitMinor = lines.filter((l) => l.signedMinor > 0).reduce((t, l) => t + l.signedMinor, 0);
  const creditMinor = lines.filter((l) => l.signedMinor < 0).reduce((t, l) => t - l.signedMinor, 0);
  return { date: s.date, ref: s.ref, lines, debitMinor, creditMinor };
}

/** @param {Voucher} v @param {boolean} isSample */
function renderPreview(v, isSample) {
  const diff = v.debitMinor - v.creditMinor;
  const balanced = diff === 0 && v.debitMinor > 0;
  const vatTotal = v.lines.reduce((t, l) => t - l.vatMinor, 0);
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI REVIEW VOUCHER`,
    title: `${v.ref} · ${v.date}`,
    badge: balanced ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }) : reaiBadge({ text: `Diff ${formatMinor(Math.abs(diff))} NOK`, tone: 'danger' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Payments (debit)', value: `${formatMinor(v.debitMinor)} NOK` })}
        ${reaiMetric({ label: 'Sales incl. VAT + tips (credit)', value: `${formatMinor(v.creditMinor)} NOK` })}
        ${reaiMetric({ label: 'Output VAT (split by ReAI)', value: `${formatMinor(vatTotal)} NOK` })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Posting</th><th>VAT</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${v.lines.map((l) => html`<tr><td class="mono">${l.account}</td><td>${l.description}</td><td>${l.vatCode ? `Code ${l.vatCode}` : l.ratePct === null ? 'None' : `${l.ratePct}% (${formatMinor(-l.vatMinor)})`}</td><td class="num">${l.signedMinor > 0 ? formatMinor(l.signedMinor) : ''}</td><td class="num">${l.signedMinor < 0 ? formatMinor(-l.signedMinor) : ''}</td></tr>`)}</tbody>
      </table></div>
      <p class="muted-note">Sales lines are posted including VAT with the matching ReAI output VAT code, so ReAI separates the taxable base and VAT. Card, Vipps and other terminal payments go to clearing account 1580 for later bank matching.</p>
      ${balanced && !isSample
        ? html`<form class="stack-sm confirm-box" hx-post="${BASE_PATH}/book" hx-target="#${SLUG}-book" hx-swap="innerHTML">
            <input type="hidden" name="voucherJson" value="${JSON.stringify(v)}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I verified these figures against the ${BRAND} report and will attach it in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="${SLUG}-book" class="stack-sm"></div>`
        : isSample
          ? reaiCallout({ tone: 'info', body: `Sample ${BRAND} settlement loaded. Connect to ReAI and fetch a real day above to book it.` })
          : reaiCallout({ tone: 'warn', body: `Payments and sales do not balance for this day in ${BRAND}. Check the report there before booking.` })}
    `,
  });
}

/**
 * Picks the ReAI output VAT code for each sales rate (VAT-inclusive amounts).
 * @param {Array<{ code: string, rate: number, vatType: string, amountBasis: string, reverseCharge: boolean }>} codes
 * @param {number} ratePct
 */
function outputVatCode(codes, ratePct) {
  const usable = codes.filter((c) => !c.reverseCharge && c.amountBasis === 'vat_inclusive' && Math.abs(c.rate - ratePct) < 0.001);
  const match = ratePct > 0
    ? usable.find((c) => c.vatType === 'output_vat')
    : (usable.find((c) => c.vatType === 'output_vat') ?? usable.find((c) => c.vatType === 'exempt') ?? usable.find((c) => c.vatType === 'outside_scope'));
  if (!match) throw new HttpError(400, `ReAI has no output VAT code for ${ratePct}% in this company.`);
  return match.code;
}

/**
 * Checks a VAT code taken from the POS report against the ReAI VAT codes.
 * @param {Array<{ code: string, rate: number, vatType: string, amountBasis: string, reverseCharge: boolean }>} codes
 * @param {string} code
 */
function knownOutputVatCode(codes, code) {
  const match = codes.find((c) => c.code === code);
  if (!match || match.reverseCharge || match.amountBasis !== 'vat_inclusive' || match.vatType === 'input_vat') throw new HttpError(400, `VAT code ${code} from ${BRAND} is not a ReAI output VAT code. Check the VAT mapping in ${BRAND}.`);
  return match.code;
}

/**
 * Handles /app/baemingo/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
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
  if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderPreview(buildVoucher(SAMPLE), true));
  try {
    const form = await request.formData();
    if (pathname === `${BASE_PATH}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderPreview(buildVoucher(await fetchApi(creds)), false));
    }
    if (pathname === `${BASE_PATH}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('confirm') !== 'on') throw new HttpError(400, 'Confirm the verification checkbox first.');
      const v = /** @type {Voucher} */ (JSON.parse(String(form.get('voucherJson') ?? '{}')));
      if (!Array.isArray(v.lines) || !v.lines.length || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(v.date))) throw new HttpError(400, 'Voucher is empty.');
      const sum = v.lines.reduce((t, l) => t + Math.round(Number(l.signedMinor)), 0);
      if (sum !== 0 || !v.lines.every((l) => /^[0-9]{4}$/.test(String(l.account)))) throw new HttpError(400, 'Voucher must balance to 0.00.');
      const marker = `${BRAND} ${String(v.ref).slice(0, 80)} ${v.date}`;
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (await reaiAll(env, '/api/vouchers', { ...auth, query: { startDate: v.date, endDate: v.date, includeReversed: 'true' } }));
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      const vatCodes = /** @type {Array<{ code: string, rate: number, vatType: string, amountBasis: string, reverseCharge: boolean }>} */ (await reaiRequest(env, '/api/vat-codes', auth));
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', {
        ...auth,
        method: 'POST',
        body: {
          date: v.date,
          description: marker,
          reviewReason: `${BRAND} daily settlement imported via apps.reai.no. Check against the ${BRAND} report.`,
          postings: pairVoucherRows(v.lines.map((l) => ({
            accountNumber: String(l.account),
            postingDate: v.date,
            currencyCode: 'NOK',
            amount: Number((Math.round(Number(l.signedMinor)) / 100).toFixed(2)),
            vatCode: l.vatCode ? knownOutputVatCode(vatCodes, String(l.vatCode)) : l.ratePct === null ? '0' : outputVatCode(vatCodes, Number(l.ratePct)),
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
