// @ts-check
import { pairVoucherRows } from '../../lib/voucher-rows.js';
import { fetchJson, isoDate, num, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/** @typedef {{ label: string, amountMinor: number, account?: string }} Payment */
/** @typedef {{ ratePct: number, grossMinor: number, account?: string, label?: string, vatCode?: string }} SalesRate */
/** @typedef {{ date: string, ref: string, payments: Payment[], sales: SalesRate[], tipsMinor: number }} Settlement */
/** @typedef {{ account: string, description: string, signedMinor: number, ratePct: number | null, vatMinor: number, vatCode?: string }} VoucherLine */
/** @typedef {{ date: string, ref: string, lines: VoucherLine[], debitMinor: number, creditMinor: number }} Voucher */

/** @type {Record<string, string>} */
const REVENUE_ACCOUNTS = { 25: '3000', 15: '3010', 12: '3020' };

/**
 * Converts a decimal amount in kroner to øre.
 * @param {unknown} v
 */
function minor(v) {
  return Math.round(num(v) * 100);
}

const SLUG = 'duell';
const BRAND = 'Duell';
const BASE_PATH = '/app/duell';
const TITLE = 'Duell Z-report Accounting';
const EYEBROW = 'RETAIL POS · NORWAY';
const LEAD = 'Turn the Duell Z-reports for one day into a balanced ReAI review voucher, using the accounts and VAT rates from your Duell account plan.';
const API_HINT = 'Use the client number and token from Duell Admin under System → Integrasjoner → API-oppsett. Leave department empty to include every active department.';
/** @type {import('../../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [
  { name: 'clientNumber', label: 'Client number (avtalenummer)', placeholder: '191141' },
  { name: 'clientToken', label: 'Client token', type: 'password', placeholder: 'API-oppsett token' },
  { name: 'department', label: 'Department id or name (optional)', required: false },
  { name: 'date', label: 'Settlement date', type: 'date', defaultValue: '$TODAY' },
];
const API = 'https://api.kasseservice.no/v1';

/** @type {Settlement} */
const SAMPLE = {
  date: '2026-10-24',
  ref: 'Z 1005',
  payments: [
    { label: 'Kontant', amountMinor: 315000, account: '1900' },
    { label: 'Bankterminal', amountMinor: 2689000, account: '1580' },
    { label: 'Vipps', amountMinor: 412500, account: '1580' },
    { label: 'Øreavrunding', amountMinor: -50, account: '7990' },
  ],
  sales: [
    { ratePct: 25, grossMinor: 3061450, account: '3000', label: 'Salg Varer 25.00% MVA' },
    { ratePct: 15, grossMinor: 355000, account: '3010', label: 'Salg Varer 15.00% MVA' },
  ],
  tipsMinor: 0,
};

/**
 * Collects GBAT10 journal lines from the nested gbat → journal_type → index envelope.
 * @param {unknown} node
 * @param {any[]} out
 * @param {number} depth
 */
function collectGbatLines(node, out, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return;
  const rec = /** @type {Record<string, unknown>} */ (node);
  if ('account_number' in rec && 'balance' in rec) {
    out.push(rec);
    return;
  }
  for (const value of Object.values(rec)) collectGbatLines(value, out, depth + 1);
}

/**
 * Fetches one day's Z-reports from the Duell API as GBAT10 accounting lines.
 * Docs: https://api.kasseservice.no/docs/authentication/ (POST /getaccesstokens, Bearer token valid 3 days),
 * https://api.kasseservice.no/docs/department/list/, https://api.kasseservice.no/docs/z-report/list/
 * (GET /account/cashsettlements) and https://api.kasseservice.no/docs/z-report/view/ (GET /account/gbat10).
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<Settlement>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const date = isoDate(creds.date);
  const clientNumber = (creds.clientNumber ?? '').trim();
  const clientToken = (creds.clientToken ?? '').trim();
  if (!/^[0-9]+$/.test(clientNumber) || !clientToken) throw new HttpError(400, 'Enter your Duell client number and client token.');
  const login = await fetchJson(`${API}/getaccesstokens`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ client_number: clientNumber, client_token: clientToken }).toString(),
  }, BRAND, fetchImpl);
  const token = typeof login?.token === 'string' ? login.token : '';
  if (!token) throw new HttpError(400, 'Duell did not return an access token. Check the client number and token.');
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };

  const deptData = await fetchJson(`${API}/department/list?${new URLSearchParams({ 'filter[is_active]': '1' })}`, { headers }, BRAND, fetchImpl);
  /** @type {any[]} */ const departments = Array.isArray(deptData?.departments) ? deptData.departments : [];
  const wanted = (creds.department ?? '').trim().toLowerCase();
  const chosen = wanted
    ? departments.filter((d) => String(d.department_id) === wanted || String(d.department_name ?? '').trim().toLowerCase() === wanted)
    : departments.filter((d) => String(d.is_deleted ?? '0') !== '1');
  if (chosen.length === 0) throw new HttpError(400, wanted ? `No active Duell department matches "${creds.department}".` : 'Duell returned no active departments.');

  const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  /** @type {Payment[]} */ const payments = [];
  /** @type {SalesRate[]} */ const sales = [];
  /** @type {string[]} */ const zNumbers = [];
  for (const dept of chosen.slice(0, 20)) {
    const list = await fetchJson(`${API}/account/cashsettlements?${new URLSearchParams({ department_token: String(dept.api_token ?? ''), start_date: `${date} 00:00:00`, end_date: `${next} 23:59:59` })}`, { headers }, BRAND, fetchImpl);
    /** @type {any[]} */ const settlements = (Array.isArray(list?.cashsettlements) ? list.cashsettlements : [])
      .filter((/** @type {any} */ z) => isoDate(z.cash_settlement_date ?? z.timestamp, '') === date);
    if (settlements.length === 0) continue;
    const query = new URLSearchParams({ department_id: String(dept.department_id) });
    for (const z of /** @type {any[]} */ (settlements)) query.append('cashsettlement_id[]', String(z.cash_settlement_id));
    const journal = await fetchJson(`${API}/account/gbat10?${query}`, { headers }, BRAND, fetchImpl);
    /** @type {any[]} */ const lines = [];
    collectGbatLines(journal?.gbat ?? journal, lines);
    for (const z of /** @type {any[]} */ (settlements)) zNumbers.push(String(z.cash_settlement_seq_no ?? z.cash_settlement_id));
    const deptLabel = chosen.length > 1 ? ` (${String(dept.department_name ?? dept.department_id)})` : '';
    for (const l of lines) {
      const account = String(l.account_number ?? '').trim();
      const amountMinor = minor(l.balance);
      if (!/^[0-9]{4}$/.test(account) || amountMinor === 0) continue;
      const label = `${String(l.ledger_description ?? l.record_type ?? 'Z-report line').trim()}${deptLabel}`;
      const ratePct = num(l.vatrate_percent);
      const isSales = ratePct > 0 || String(l.record_type ?? '').startsWith('sales');
      if (isSales) sales.push({ ratePct, grossMinor: -amountMinor, account, label });
      else payments.push({ label, amountMinor, account });
    }
  }
  if (zNumbers.length === 0) throw new HttpError(400, `Duell has no Z-report dated ${date}.`);
  return { date, ref: `Z ${zNumbers.join(', ')}`, payments, sales, tipsMinor: 0 };
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
 * Handles /app/duell/* routes.
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
