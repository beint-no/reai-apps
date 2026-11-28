// @ts-check
import { pairVoucherRows } from '../../lib/voucher-rows.js';
import { assertPublicHttpsUrl, fetchJson, isoDate, num, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/** @typedef {{ label: string, amountMinor: number, account: string }} Payment */
/** @typedef {{ ratePct: number, grossMinor: number, account: string, label: string }} SalesRate */
/** @typedef {{ date: string, ref: string, currency: string, payments: Payment[], sales: SalesRate[], tipsMinor: number }} Settlement */
/** @typedef {{ account: string, description: string, signedMinor: number, ratePct: number | null }} VoucherLine */
/** @typedef {{ date: string, ref: string, currency: string, lines: VoucherLine[], debitMinor: number, creditMinor: number }} Voucher */
/** @typedef {{ code: string, rate: number, vatType: string, amountBasis: string, reverseCharge: boolean }} VatCode */

const SLUG = 'favrit';
const BRAND = 'Favrit';
const BASE_PATH = '/app/favrit';
const TITLE = 'Favrit Sales Accounting';
const EYEBROW = 'RESTAURANT ORDERING · NORWAY';
const LEAD = 'Turn one day of Favrit orderlines into a balanced ReAI review voucher with sales per account and VAT rate, refunds and tips.';
const API_HINT = 'Create a client app in Favrit admin under Company Settings → Integration → Developer → Integrate to Favrit with the prod/transaction scope. Leave location id empty if the client covers one location.';
/** @type {import('../../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [
  { name: 'clientId', label: 'Client id', placeholder: 'ClientId' },
  { name: 'clientSecret', label: 'Secret id', type: 'password', placeholder: 'SecretId' },
  { name: 'locationId', label: 'Location id (optional)', required: false },
  { name: 'date', label: 'Sales day', type: 'date', defaultValue: '$TODAY' },
];
const AUTH = 'https://accounting-api-auth.favrit.com/oauth2/token';
const API = 'https://favrit.com/ws/accounting-api-service/api';

/** @type {Record<string, string>} */
const REVENUE_ACCOUNTS = { 25: '3000', 15: '3010', 12: '3020' };

/** @type {Settlement} */
const SAMPLE = {
  date: '2026-10-24',
  ref: 'location 123 Demo restaurant',
  currency: 'NOK',
  payments: [
    { label: 'Payments to settle', amountMinor: 4855000, account: '1580' },
  ],
  sales: [
    { ratePct: 25, grossMinor: 3850000, account: '3000', label: 'Mat' },
    { ratePct: 25, grossMinor: 815000, account: '3020', label: 'Beer' },
  ],
  tipsMinor: 190000,
};

/** @param {unknown} v */
function minor(v) {
  return Math.round(num(v) * 100);
}

/** @param {number} ratePct */
function revenueAccount(ratePct) {
  return REVENUE_ACCOUNTS[String(ratePct)] ?? '3100';
}

/**
 * UTC instant of 00:00 Europe/Oslo on a calendar day.
 * @param {string} day YYYY-MM-DD
 */
function osloMidnightUtc(day) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Oslo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  /** @param {number} t */
  const offset = (t) => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - t;
  };
  const naive = Date.parse(`${day}T00:00:00Z`);
  return naive - offset(naive - offset(naive));
}

/** @param {string} s Favrit UTC timestamp without zone, e.g. 2023-11-01T14:51:53.102628 */
function parseUtc(s) {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?/.exec(s.trim());
  return m ? Date.parse(`${m[1]}.${(m[2] ?? '').padEnd(3, '0').slice(0, 3)}Z`) : Number.NaN;
}

/**
 * Parses Favrit's semicolon separated CSV into objects keyed by the header row.
 * @param {string} text
 * @returns {Array<Record<string, string>>}
 */
function parseOrderlines(text) {
  /** @type {string[][]} */ const rows = [];
  /** @type {string[]} */ let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ';') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  const header = (rows.shift() ?? []).map((h) => h.trim());
  if (rows.length > 0 && !header.includes('amount_with_vat')) throw new HttpError(502, 'Favrit returned orderlines without the documented columns.');
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/**
 * Fetches one Europe/Oslo day of Favrit orderlines and sums them per account and VAT rate.
 * Docs: https://support.favrit.com/getting-started-1 (client app with ClientId and SecretId),
 * https://support.favrit.com/authentication (POST https://accounting-api-auth.favrit.com/oauth2/token, Basic auth,
 * grant_type=client_credentials, scope prod/transaction) and https://support.favrit.com/orderline-api-documentation
 * (GET https://favrit.com/ws/accounting-api-service/api/orderlines/v6[/{location}] with from-date and to-date in UTC,
 * yyyy-MM-ddTHH:mm:ss, at most 24 hours per request; semicolon separated CSV; refunds and discards are extra lines with
 * negative quantity; order_line_category TIP for tips). Replaces the Accounting API, which Favrit marks as deprecated.
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<Settlement>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const date = isoDate(creds.date);
  const clientId = (creds.clientId ?? '').trim();
  const clientSecret = (creds.clientSecret ?? '').trim();
  const locationId = (creds.locationId ?? '').trim();
  if (!clientId || !clientSecret) throw new HttpError(400, 'Enter the Favrit client id and secret id.');
  if (locationId && !/^[0-9]+$/.test(locationId)) throw new HttpError(400, 'Location id must be a number.');
  /** @type {import('../../lib/api-http.js').FetchLike} */
  const limited = async (input, init) => {
    const res = await fetchImpl(input, init);
    if (res.status === 429) throw new HttpError(429, `Favrit rate limit reached. Wait ${res.headers.get('retry-after') ?? '60'} seconds and try again.`);
    return res;
  };
  const login = await fetchJson(AUTH, {
    method: 'POST',
    headers: { authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'prod/transaction' }).toString(),
  }, BRAND, limited);
  const token = typeof login?.access_token === 'string' ? login.access_token : '';
  if (!token) throw new HttpError(400, 'Favrit did not return an access token. Check the client id, secret id and the prod/transaction scope.');

  const start = osloMidnightUtc(date);
  const end = osloMidnightUtc(new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10));
  const path = `${API}/orderlines/v6${locationId ? `/${locationId}` : ''}`;
  /** @type {Map<string, Record<string, string>>} */ const lines = new Map();
  // Favrit returns nothing for ranges over 24 hours, so a 25 hour day (end of summer time) takes two requests.
  for (let from = start; from < end; from += 86_400_000) {
    const to = Math.min(from + 86_400_000, end);
    const url = `${path}?${new URLSearchParams({ 'from-date': new Date(from).toISOString().slice(0, 19), 'to-date': new Date(to).toISOString().slice(0, 19) })}`;
    assertPublicHttpsUrl(url);
    const res = await limited(url, { headers: { authorization: `Bearer ${token}`, accept: 'text/csv' }, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    if (res.status === 401 || res.status === 403) throw new HttpError(400, 'Favrit rejected the request. Give the client app the prod/transaction scope and check the location id.');
    if (!res.ok) throw new HttpError(400, `Favrit API returned HTTP ${res.status}.`);
    for (const l of parseOrderlines(await res.text())) {
      const created = parseUtc(l.order_line_created_utc ?? '');
      if (!(created >= start && created < end)) continue;
      lines.set(`${l.order_line_id}|${l.order_line_status}|${l.counter_line_id}`, l);
    }
  }
  if (lines.size === 0) throw new HttpError(400, `Favrit has no orderlines on ${date}${locationId ? ` for location ${locationId}` : ''}.`);

  /** @type {Map<string, string>} */ const locations = new Map();
  /** @type {Set<string>} */ const currencies = new Set();
  /** @type {Map<string, SalesRate>} */ const sales = new Map();
  let tipsMinor = 0;
  for (const l of lines.values()) {
    locations.set(l.order_location_id ?? '', l.order_location_name ?? '');
    currencies.add((l.currency ?? '').toUpperCase());
    let amountMinor = minor(l.amount_with_vat);
    if (num(l.quantity) < 0 && amountMinor > 0) amountMinor = -amountMinor;
    if (amountMinor === 0) continue;
    if (l.order_line_category === 'TIP') { tipsMinor += amountMinor; continue; }
    const rawRate = num(l.vat_percentage);
    const ratePct = Math.round((rawRate <= 1 ? rawRate * 100 : rawRate) * 100) / 100;
    const ref = l.account_reference ?? '';
    const account = /^[0-9]{4}$/.test(ref) ? ref : revenueAccount(ratePct);
    const key = `${account}|${ratePct}`;
    const prev = sales.get(key);
    sales.set(key, { ratePct, account, label: (l.account_name || `Sales ${ratePct}% VAT`).slice(0, 80), grossMinor: (prev?.grossMinor ?? 0) + amountMinor });
  }
  if (locations.size > 1) throw new HttpError(400, `These Favrit credentials cover several locations. Enter one location id: ${[...locations].map(([id, name]) => `${id} ${name}`.trim()).join(', ')}.`);
  const currency = [...currencies][0] ?? '';
  if (currencies.size !== 1 || !/^[A-Z]{3}$/.test(currency)) throw new HttpError(400, `Favrit orderlines on ${date} have more than one currency or none.`);
  const [locId, locName] = [...locations][0] ?? ['', ''];
  const salesTotal = [...sales.values()].reduce((t, r) => t + r.grossMinor, 0);
  return {
    date,
    ref: `location ${locId}${locName ? ` ${locName}` : ''}`.slice(0, 80),
    currency,
    payments: [{ label: 'Payments to settle', amountMinor: salesTotal + tipsMinor, account: '1580' }],
    sales: [...sales.values()],
    tipsMinor,
  };
}

/** @param {Settlement} s @returns {Voucher} */
function buildVoucher(s) {
  /** @type {VoucherLine[]} */ const lines = [];
  const pfx = `${BRAND} ${s.ref}`;
  for (const p of s.payments) {
    if (p.amountMinor !== 0) lines.push({ account: p.account, description: `${pfx} · ${p.label}`, signedMinor: p.amountMinor, ratePct: null });
  }
  for (const r of s.sales) {
    if (r.grossMinor !== 0) lines.push({ account: r.account, description: `${pfx} · ${r.label}`, signedMinor: -r.grossMinor, ratePct: r.ratePct });
  }
  if (s.tipsMinor !== 0) lines.push({ account: '2930', description: `${pfx} · Staff tips payable`, signedMinor: -s.tipsMinor, ratePct: null });
  const debitMinor = lines.filter((l) => l.signedMinor > 0).reduce((t, l) => t + l.signedMinor, 0);
  const creditMinor = lines.filter((l) => l.signedMinor < 0).reduce((t, l) => t - l.signedMinor, 0);
  return { date: s.date, ref: s.ref, currency: s.currency, lines, debitMinor, creditMinor };
}

/** @param {Voucher} v @param {boolean} isSample */
function renderPreview(v, isSample) {
  const diff = v.debitMinor - v.creditMinor;
  const balanced = diff === 0 && v.debitMinor > 0;
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI REVIEW VOUCHER`,
    title: `${v.ref} · ${v.date}`,
    badge: balanced ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }) : reaiBadge({ text: `Diff ${formatMinor(Math.abs(diff))} ${v.currency}`, tone: 'danger' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Payments (debit)', value: `${formatMinor(v.debitMinor)} ${v.currency}` })}
        ${reaiMetric({ label: 'Sales incl. VAT and tips (credit)', value: `${formatMinor(v.creditMinor)} ${v.currency}` })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Posting</th><th>VAT</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${v.lines.map((l) => html`<tr><td class="mono">${l.account}</td><td>${l.description}</td><td>${l.ratePct === null ? 'None' : `${l.ratePct}%`}</td><td class="num">${l.signedMinor > 0 ? formatMinor(l.signedMinor) : ''}</td><td class="num">${l.signedMinor < 0 ? formatMinor(-l.signedMinor) : ''}</td></tr>`)}</tbody>
      </table></div>
      <p class="muted-note">Sales lines are posted including VAT with the matching ReAI output VAT code, so ReAI separates the taxable base and VAT. Payments go to clearing account 1580 and tips to 2930. Book payment fees when the payout reaches the bank. Sales accounts come from the account references in Favrit, and refunds reduce sales on the day they happen.</p>
      ${balanced && !isSample
        ? html`<form class="stack-sm confirm-box" hx-post="${BASE_PATH}/book" hx-target="#${SLUG}-book" hx-swap="innerHTML">
            <input type="hidden" name="voucherJson" value="${JSON.stringify(v)}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I verified these figures against the ${BRAND} sales report and will attach it in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="${SLUG}-book" class="stack-sm"></div>`
        : isSample
          ? reaiCallout({ tone: 'info', body: `Sample ${BRAND} day loaded. Connect to ReAI and fetch a real day above to book it.` })
          : reaiCallout({ tone: 'warn', body: `Payments and sales do not balance for this day in ${BRAND}. Check the sales report there before booking.` })}
    `,
  });
}

/**
 * Picks the ReAI output VAT code for a sales rate (VAT-inclusive amounts).
 * @param {VatCode[]} codes
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
 * Handles /app/favrit/* routes.
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
      const company = session.tenants.find((t) => t.id === session.tenantId);
      if (company && company.currencyCode !== v.currency) throw new HttpError(400, `The orderlines are in ${String(v.currency)} but ${company.companyName} keeps its accounts in ${company.currencyCode}.`);
      const marker = `${BRAND} ${String(v.ref).slice(0, 80)} ${v.date}`;
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (await reaiAll(env, '/api/vouchers', { ...auth, query: { startDate: v.date, endDate: v.date, includeReversed: 'true' } }));
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      const vatCodes = /** @type {VatCode[]} */ (await reaiRequest(env, '/api/vat-codes', auth));
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', {
        ...auth,
        method: 'POST',
        body: {
          date: v.date,
          description: marker,
          reviewReason: `${BRAND} orderlines imported via apps.reai.no. Check against the ${BRAND} sales report.`,
          postings: pairVoucherRows(v.lines.map((l) => ({
            accountNumber: String(l.account),
            postingDate: v.date,
            currencyCode: String(v.currency),
            amount: Number((Math.round(Number(l.signedMinor)) / 100).toFixed(2)),
            vatCode: l.ratePct === null ? '0' : outputVatCode(vatCodes, Number(l.ratePct)),
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
