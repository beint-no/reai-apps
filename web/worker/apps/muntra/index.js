// @ts-check
import { fetchJson, isoDate } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';
import { pairVoucherRows } from '../../lib/voucher-rows.js';

/**
 * @typedef {{ account: string, name: string, minor: number }} LedgerLine
 * @typedef {{ from: string, to: string, transactions: number, lines: LedgerLine[] }} Period
 * @typedef {{ muntra: string[], account: string, name: string, minor: number }} MappedLine
 * @typedef {{ code: string, rate: number, vatType: string, amountBasis: string, reverseCharge: boolean }} VatCode
 */

const SLUG = 'muntra';
const BRAND = 'Muntra';
const BASE_PATH = `/app/${SLUG}`;
const TITLE = 'Muntra Ledger to ReAI';
const LEAD = 'Summarise the Muntra general ledger for a period by account and book it as one balanced ReAI review voucher: patient invoices, payments, HELFO claims and fees as Muntra posted them.';
const API = 'https://api.muntra.com';
const MARKER = 'Muntra ledger';
/** Accounts that carry a customer, supplier or employee subledger in ReAI (same guard as hybel). */
const SUBLEDGER_ACCOUNTS = new Set(['1500', '2400', '2910']);

/** @type {Period} */
const SAMPLE = {
  from: '2026-10-01',
  to: '2026-10-31',
  transactions: 9,
  lines: [
    { account: '1510', name: 'Kundefordringer pasienter', minor: 1_240_000 },
    { account: '1540', name: 'Fordring HELFO', minor: 486_500 },
    { account: '1580', name: 'Kortterminal', minor: 3_115_000 },
    { account: '1920', name: 'Bank', minor: 1_022_000 },
    { account: '3000', name: 'Behandlingsinntekter', minor: -5_863_500 },
    { account: '7770', name: 'Kortgebyrer', minor: 0 },
  ],
};

/** @param {string} day @param {number} months */
function addMonths(day, months) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * Reads every Muntra ledger transaction in a period and sums it by account.
 * Docs: https://api.muntra.com/api/documentation (ReDoc of https://api.muntra.com/docs, API 3.5.234):
 * Bearer personal access token (POST /api/personal-access-tokens is disabled, "Contact Muntra support to create a personal access token");
 * GET /api/transactions with required from_date and to_date (range at most 3 months, to_date after from_date) and optional
 * fiscal_year_id; the endpoint has no paging parameters and returns { data: [{ id, type, attributes: { amount, account_number,
 * account_name, cost_center_code, cost_center_name } }] }.
 * @param {Record<string, string>} creds `token`, `from`, `to`, optional `fiscalYearId`
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<Period>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.token ?? '').trim();
  if (!token) throw new HttpError(400, 'Enter the Muntra personal access token from Muntra support.');
  const from = isoDate(creds.from, '');
  const to = isoDate(creds.to, '');
  if (!from || !to || to <= from) throw new HttpError(400, 'Choose a period where the end date is after the start date.');
  if (to > addMonths(from, 3)) throw new HttpError(400, 'Muntra allows at most three months per request. Choose a shorter period.');
  const fiscalYearId = (creds.fiscalYearId ?? '').trim();
  if (fiscalYearId && !/^[0-9]+$/.test(fiscalYearId)) throw new HttpError(400, 'The Muntra fiscal year id must be a number.');
  const q = new URLSearchParams({ from_date: from, to_date: to, ...(fiscalYearId ? { fiscal_year_id: fiscalYearId } : {}) });
  const res = await fetchJson(`${API}/api/transactions?${q}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, BRAND, fetchImpl);
  /** @type {any[]} */ const rows = Array.isArray(res?.data) ? res.data : [];
  /** @type {Map<string, LedgerLine>} */ const byAccount = new Map();
  for (const row of rows) {
    const a = row?.attributes ?? {};
    const account = String(a.account_number ?? '').trim();
    const minor = Math.round(Number(a.amount ?? 0) * 100);
    if (!Number.isFinite(minor)) throw new HttpError(400, `Muntra returned an invalid amount on transaction ${String(row?.id ?? '')}.`);
    if (!account) throw new HttpError(400, `Muntra transaction ${String(row?.id ?? '')} has no account number.`);
    const line = byAccount.get(account) ?? { account, name: String(a.account_name ?? '').trim(), minor: 0 };
    line.minor += minor;
    byAccount.set(account, line);
  }
  const lines = [...byAccount.values()].sort((x, y) => x.account.localeCompare(y.account));
  const total = lines.reduce((s, l) => s + l.minor, 0);
  if (rows.length === 0) throw new HttpError(400, `Muntra has no ledger transactions from ${from} to ${to}.`);
  if (total !== 0) throw new HttpError(400, `The Muntra transactions for ${from} to ${to} do not balance (difference ${formatMinor(total)}). Check that every verification in the period is complete in Muntra.`);
  return { from, to, transactions: rows.length, lines };
}

/**
 * Parses "muntra=reai" account mapping lines.
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseMapping(text) {
  /** @type {Map<string, string>} */ const map = new Map();
  for (const rawLine of text.split(/[\n,;]+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = /^([0-9A-Za-z]+)\s*(?:=|->|→)\s*([0-9]{4})$/.exec(line);
    if (!m) throw new HttpError(400, `Account mapping "${line}" must look like 1510=1570.`);
    map.set(/** @type {string} */ (m[1]), /** @type {string} */ (m[2]));
  }
  return map;
}

/**
 * Applies the account mapping and drops accounts that net to zero.
 * @param {Period} p @param {Map<string, string>} mapping
 * @returns {MappedLine[]}
 */
export function mapLines(p, mapping) {
  /** @type {Map<string, MappedLine>} */ const out = new Map();
  for (const l of p.lines) {
    const account = mapping.get(l.account) ?? l.account;
    const m = out.get(account) ?? { muntra: [], account, name: l.name, minor: 0 };
    m.muntra.push(l.account);
    m.minor += l.minor;
    out.set(account, m);
  }
  return [...out.values()].filter((l) => l.minor !== 0).sort((x, y) => x.account.localeCompare(y.account));
}

/** @param {Period} p @param {MappedLine[]} lines @param {Record<string, string>} hidden @param {boolean} isSample */
function renderPreview(p, lines, hidden, isSample) {
  const debit = lines.filter((l) => l.minor > 0).reduce((s, l) => s + l.minor, 0);
  const credit = lines.filter((l) => l.minor < 0).reduce((s, l) => s - l.minor, 0);
  const bad = lines.filter((l) => !/^[0-9]{4}$/.test(l.account));
  const vat = lines.filter((l) => /^27[0-9]{2}$/.test(l.account));
  const revenue = lines.filter((l) => l.account.startsWith('3'));
  const revenueSign = revenue.reduce((s, l) => s + l.minor, 0);
  const canBook = !isSample && bad.length === 0 && vat.length === 0 && debit === credit && debit > 0;
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} LEDGER → REAI REVIEW VOUCHER`,
    title: `${p.from} to ${p.to}`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : debit === credit ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }) : reaiBadge({ text: 'Not balanced', tone: 'danger' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Debit', value: `${formatMinor(debit)} NOK` })}
        ${reaiMetric({ label: 'Credit', value: `${formatMinor(credit)} NOK` })}
        ${reaiMetric({ label: 'Muntra transactions', value: String(p.transactions), detail: 'Summed per account' })}
      </div>
      ${bad.length ? reaiCallout({ tone: 'warn', body: `Map these Muntra accounts to four digit ReAI accounts below: ${bad.map((l) => l.account).join(', ')}.` }) : ''}
      ${vat.length ? reaiCallout({ tone: 'warn', body: `Muntra posted VAT on ${vat.map((l) => l.account).join(', ')}. This integration books VAT exempt treatment revenue only. Book taxable product sales separately.` }) : ''}
      ${revenueSign > 0 ? reaiCallout({ tone: 'warn', body: 'Revenue accounts net to a debit in this period. Check credit notes in Muntra before booking.' }) : ''}
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Muntra account</th><th>ReAI account</th><th>Name</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${lines.map((l) => html`<tr><td class="mono">${l.muntra.join(', ')}</td><td class="mono">${l.account}</td><td>${l.name}</td><td class="num">${l.minor > 0 ? formatMinor(l.minor) : ''}</td><td class="num">${l.minor < 0 ? formatMinor(-l.minor) : ''}</td></tr>`)}</tbody>
      </table></div>
      <p class="muted-note">The voucher is dated ${p.to}. Revenue accounts get the ReAI VAT code for sales outside the VAT act (health services). Accounts linked to a bank in ReAI are posted to that bank. Customer, supplier and employee subledger accounts must be mapped to a plain account, for example 1510=1570.</p>
      ${isSample
        ? reaiCallout({ tone: 'info', body: `Sample ${BRAND} period loaded. Connect to ReAI and fetch a real period above to book it.` })
        : canBook
          ? html`<form class="stack-sm confirm-box" hx-post="${BASE_PATH}/book" hx-target="#${SLUG}-book" hx-swap="innerHTML">
              ${Object.entries(hidden).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
              <label class="check-row"><input type="checkbox" name="confirm" required> I checked these totals against the Muntra reports for the period.</label>
              <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
            </form><div id="${SLUG}-book" class="stack-sm"></div>`
          : ''}
    `,
  });
}

/**
 * Picks the ReAI code for revenue outside the VAT act (health services), preferring code 6.
 * @param {VatCode[]} codes
 */
function exemptRevenueCode(codes) {
  const usable = codes.filter((c) => c.vatType === 'outside_scope' && !c.reverseCharge && Math.abs(c.rate) < 0.001);
  const match = usable.find((c) => c.code === '6') ?? usable[0];
  if (!match) throw new HttpError(400, 'ReAI has no VAT code for sales outside the VAT act in this company.');
  return match.code;
}

/**
 * Books the mapped period lines as one ReAI review voucher.
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {import('../../lib/types.d.ts').SessionData} session
 * @param {Period} p
 * @param {MappedLine[]} lines
 */
export async function bookPeriod(env, session, p, lines) {
  const auth = { token: session.accessToken, tenantId: session.tenantId };
  const company = session.tenants.find((t) => t.id === session.tenantId);
  if (company && company.currencyCode !== 'NOK') throw new HttpError(400, 'Muntra ledgers in Norway are in NOK. Choose a NOK company in ReAI.');
  for (const l of lines) {
    if (!/^[0-9]{4}$/.test(l.account)) throw new HttpError(400, `Map Muntra account ${l.account} to a four digit ReAI account.`);
    if (/^27[0-9]{2}$/.test(l.account)) throw new HttpError(400, `Muntra posted VAT on account ${l.account}. Book taxable sales separately; this integration handles VAT exempt treatment revenue only.`);
    if (SUBLEDGER_ACCOUNTS.has(l.account)) throw new HttpError(400, `Account ${l.account} needs a customer, supplier or employee in ReAI. Map it to a plain account, for example ${l.account}=1570.`);
  }
  const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (await reaiAll(env, '/api/vouchers', { ...auth, query: { startDate: p.from, endDate: p.to, includeReversed: 'true' } }));
  const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(MARKER));
  if (dup) return { duplicate: true, id: dup.id, number: dup.number };

  const accounts = [...new Set(lines.map((l) => l.account))];
  /** @type {Promise<unknown>[]} */ const lookups = [];
  for (let i = 0; i < accounts.length; i += 20) {
    const qs = new URLSearchParams(accounts.slice(i, i + 20).map((n) => ['accountNumberPrefix', n]));
    qs.set('limit', '100');
    lookups.push(reaiRequest(env, `/api/chart-of-accounts/accounts?${qs}`, auth));
  }
  const [vatCodes, banks, ...chartBatches] = await Promise.all([
    /** @type {Promise<VatCode[]>} */ (reaiRequest(env, '/api/vat-codes', auth)),
    /** @type {Promise<import('../../lib/types.d.ts').CompanyBank[]>} */ (reaiRequest(env, '/api/company-banks', auth)),
    ...lookups,
  ]);
  const chart = /** @type {Array<{ accountNumber: string, type?: string, restrictedToSystemUsage: boolean, subsidiaryLedger: { type: string } | null }>} */ (chartBatches.flat());
  const revenueCode = exemptRevenueCode(vatCodes);
  /** @type {Record<string, number>} */ const bankIds = {};
  /** @type {Record<string, string>} */ const types = {};
  for (const n of accounts) {
    const match = chart.find((a) => a.accountNumber === n && !a.restrictedToSystemUsage);
    if (!match) throw new HttpError(400, `Account ${n} is missing or reserved in ReAI. Add it to the chart of accounts or map it to another account.`);
    types[n] = String(match.type ?? '');
    if (match.subsidiaryLedger && match.subsidiaryLedger.type !== 'bank') throw new HttpError(400, `Account ${n} needs a ${match.subsidiaryLedger.type} in ReAI. Map it to a plain account.`);
    if (match.subsidiaryLedger?.type === 'bank' || n.startsWith('19')) {
      const bank = banks.filter((b) => b.ledgerAccountNumber === n && !b.archived && b.currencyCode === 'NOK');
      if (bank.length !== 1 || !bank[0]) throw new HttpError(400, `Account ${n} must match exactly one active NOK bank account in ReAI.`);
      bankIds[n] = bank[0].id;
    }
  }
  const postings = pairVoucherRows(lines.map((l) => ({
    accountNumber: l.account,
    postingDate: p.to,
    currencyCode: 'NOK',
    amount: Number((l.minor / 100).toFixed(2)),
    vatCode: types[l.account] === 'revenue' ? revenueCode : '0',
    description: `${BRAND} ${l.muntra.join(', ')} ${l.name}`.trim().slice(0, 200),
    ...(bankIds[l.account] !== undefined ? { companyBankId: bankIds[l.account] } : {}),
  })));
  const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', {
    ...auth,
    method: 'POST',
    body: { date: p.to, description: `${MARKER} ${p.from} to ${p.to}`, reviewReason: `${BRAND} ledger summary imported via apps.reai.no. Check against the Muntra accounting reports and attach them.`, postings },
  }));
  return { duplicate: false, id: created.id, number: created.number };
}

/** @param {FormData} form */
function credsFrom(form) {
  return {
    token: String(form.get('token') ?? '').trim(),
    from: String(form.get('from') ?? '').trim(),
    to: String(form.get('to') ?? '').trim(),
    fiscalYearId: String(form.get('fiscalYearId') ?? '').trim(),
    mapping: String(form.get('mapping') ?? '').slice(0, 4000),
  };
}

/**
 * Handles /app/muntra/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE_PATH && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE_PATH}/`, request.url), 301);
  if (pathname === `${BASE_PATH}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = `${today.slice(0, 7)}-01`;
    const body = html`
      <section class="app-intro"><p class="eyebrow">DENTAL CLINICS</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${SLUG}-web`, clientName: `ReAI ${BRAND} (Web)` })}
        ${reaiCard({
          eyebrow: 'LIVE MUNTRA API',
          title: 'Fetch the Muntra ledger for a period',
          body: html`<p class="muted-note">Ask Muntra support for a personal access token for the API. The token is used only for these requests and is never stored.</p>
            <form class="stack" hx-post="${BASE_PATH}/fetch-api" hx-target="#${SLUG}-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="mu-token">Muntra personal access token</label><input id="mu-token" name="token" type="password" autocomplete="off" required></div>
                <div class="field"><label for="mu-from">From</label><input id="mu-from" name="from" type="date" value="${monthStart}" required></div>
                <div class="field"><label for="mu-to">To (voucher date)</label><input id="mu-to" name="to" type="date" value="${today}" required></div>
                <div class="field"><label for="mu-fy">Muntra fiscal year id (optional)</label><input id="mu-fy" name="fiscalYearId" type="text" inputmode="numeric"></div>
              </div>
              <div class="field"><label for="mu-map">Account mapping, Muntra=ReAI (optional, one per line)</label><textarea id="mu-map" name="mapping" rows="3" placeholder="1510=1570"></textarea></div>
              <div class="inline-row">
                <button type="submit" class="button primary">Fetch from Muntra API</button>
                <button type="button" class="button secondary" hx-post="${BASE_PATH}/sample" hx-target="#${SLUG}-output" hx-swap="innerHTML">Load sample preview</button>
              </div>
            </form>`,
        })}
        <div id="${SLUG}-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderPreview(SAMPLE, mapLines(SAMPLE, new Map([['1510', '1570'], ['1540', '1530']])), {}, true));
  try {
    const form = await request.formData();
    const creds = credsFrom(form);
    if (pathname === `${BASE_PATH}/fetch-api`) {
      const mapping = parseMapping(creds.mapping);
      const p = await fetchApi(creds);
      return htmlResponse(renderPreview(p, mapLines(p, mapping), { token: creds.token, from: p.from, to: p.to, fiscalYearId: creds.fiscalYearId, mapping: creds.mapping }, false));
    }
    if (pathname === `${BASE_PATH}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('confirm') !== 'on') throw new HttpError(400, 'Confirm the verification checkbox first.');
      const mapping = parseMapping(creds.mapping);
      const p = await fetchApi(creds);
      const result = await bookPeriod(env, session, p, mapLines(p, mapping));
      const link = html`<a href="${reaiOrigin(env)}/voucher/${result.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${result.number} ↗</a>`;
      return htmlResponse(result.duplicate
        ? reaiCallout({ tone: 'warn', title: `Already booked (${result.number})`, body: html`A Muntra ledger voucher already exists in this period: ${link}.` })
        : reaiCallout({ tone: 'success', title: `Created review voucher ${result.number}`, body: link }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
