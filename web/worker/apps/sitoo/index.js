// @ts-check
import { pairVoucherRows } from '../../lib/voucher-rows.js';
import { fetchJson, isoDate, num, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/**
 * One review voucher line. signedMinor is NOK øre: positive debit, negative credit.
 * Sales lines carry the gross amount and a vat_inclusive ReAI output VAT code, so ReAI splits net and VAT.
 * @typedef {{ account: string, vatCode: string, vatRate: number, description: string, signedMinor: number }} SitooLine
 * @typedef {{ date: string, ref: string, reports: number, lines: SitooLine[] }} SitooVoucher
 * @typedef {{ zreportid?: number, registerid?: string, registernumber?: number, datecreated?: number, dateadded?: number, currencycode?: string, vatgroupssales?: Array<{ vatvalue?: unknown, moneytotal?: unknown }>, vatgroupsrefund?: Array<{ vatvalue?: unknown, moneytotal?: unknown }>, paymentssales?: Array<{ name?: string, moneytotal?: unknown }>, paymentsrefund?: Array<{ name?: string, moneytotal?: unknown }>, moneyroundoff?: unknown }} SitooZReport
 */

const BRAND = 'Sitoo';
const BASE_PATH = '/app/sitoo';
const TITLE = 'Sitoo POS Z-report Accounting';
const LEAD = 'Fetch the day’s Sitoo POS Z-reports and create one balanced review voucher in ReAI: payments by tender, sales by VAT rate with ReAI output VAT codes.';
const SAMPLE_DATE = '2026-10-24';

/** Norwegian output VAT: rate → ReAI VAT code and revenue account (NS 4102). 0% is zero-rated sales (code 5). */
const VAT_MAP = /** @type {Record<number, { code: string, account: string, label: string }>} */ ({
  25: { code: '3', account: '3000', label: 'Sales 25% VAT' },
  15: { code: '31', account: '3010', label: 'Sales 15% VAT' },
  12: { code: '33', account: '3020', label: 'Sales 12% VAT' },
  0: { code: '5', account: '3100', label: 'Sales 0% VAT (zero-rated)' },
});

/** @param {unknown} v */
const minor = (v) => Math.round(num(v) * 100);

/** @param {number} epochSeconds */
function osloDate(epochSeconds) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(epochSeconds * 1000));
}

/** @param {string} name */
function tenderAccount(name) {
  if (/kontant|cash/i.test(name)) return '1900';
  if (/gavekort|gift/i.test(name)) return '2900';
  if (/faktura|invoice/i.test(name)) return '1570';
  return '1580';
}

/**
 * Aggregates POS Z-reports for one day into a review voucher.
 * @param {SitooZReport[]} reports
 * @param {string} date
 * @returns {SitooVoucher}
 */
export function buildVoucher(reports, date) {
  /** @type {Map<string, SitooLine>} */
  const byKey = new Map();
  /** @param {string} account @param {string} vatCode @param {number} vatRate @param {string} description @param {number} signedMinor */
  const add = (account, vatCode, vatRate, description, signedMinor) => {
    if (signedMinor === 0) return;
    const key = `${account}|${vatCode}|${description}`;
    const line = byKey.get(key);
    if (line) line.signedMinor += signedMinor;
    else byKey.set(key, { account, vatCode, vatRate, description, signedMinor });
  };
  for (const r of reports) {
    if (r.currencycode && r.currencycode !== 'NOK') throw new HttpError(400, `Z-report ${r.zreportid} is in ${r.currencycode}. Only NOK registers are supported.`);
    for (const p of r.paymentssales ?? []) add(tenderAccount(String(p.name ?? '')), '0', 0, `${BRAND} ${p.name ?? 'Payment'}`, Math.abs(minor(p.moneytotal)));
    for (const p of r.paymentsrefund ?? []) add(tenderAccount(String(p.name ?? '')), '0', 0, `${BRAND} ${p.name ?? 'Payment'}`, -Math.abs(minor(p.moneytotal)));
    for (const [groups, sign] of /** @type {const} */ ([[r.vatgroupssales ?? [], -1], [r.vatgroupsrefund ?? [], 1]])) {
      for (const g of groups) {
        const rate = Math.round(num(g.vatvalue));
        const vat = VAT_MAP[rate];
        if (!vat) throw new HttpError(400, `Z-report ${r.zreportid} has a ${rate}% VAT group. Only Norwegian rates 25, 15, 12 and 0% are supported.`);
        add(vat.account, vat.code, rate, `${BRAND} ${vat.label}`, sign * Math.abs(minor(g.moneytotal)));
      }
    }
    const roundoff = minor(r.moneyroundoff);
    if (roundoff !== 0) add('7790', '0', 0, `${BRAND} rounding`, -roundoff);
  }
  const lines = [...byKey.values()].filter((l) => l.signedMinor !== 0);
  const ids = reports.map((r) => `${r.registernumber ?? r.registerid}/${r.zreportid}`).join(', ');
  return { date, ref: `Z ${ids}`.slice(0, 120), reports: reports.length, lines };
}

/**
 * Fetches all POS Z-reports created on one Oslo calendar day from the Sitoo REST API.
 * Docs: https://developer.sitoo.com/introduction (Basic auth with API ID and password from
 * Settings / Sitoo REST API, account base URL) and https://developer.sitoo.com/api-reference/z-reports
 * (GET /v2/accounts/{account_id}/pos-z-reports, dateaddedfrom/dateaddedto, max 500 per call sorted by dateadded).
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<SitooVoucher>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const apiId = (creds.apiId ?? '').trim();
  const password = (creds.apiPassword ?? '').trim();
  const date = isoDate(creds.date);
  if (!apiId || !password) throw new HttpError(400, 'Enter your Sitoo API ID and password.');
  const rawBase = (creds.baseUrl ?? '').trim() || 'https://api.mysitoo.com';
  let base;
  try {
    base = new URL(rawBase);
  } catch {
    throw new HttpError(400, 'Enter the Sitoo API base URL shown in Settings / Sitoo REST API.');
  }
  const inUrl = base.pathname.match(/\/v2\/accounts\/([0-9]+)/);
  const accountId = (creds.accountId ?? '').trim() || inUrl?.[1] || '';
  if (!/^[0-9]+$/.test(accountId)) throw new HttpError(400, 'Enter your numeric Sitoo account ID.');
  const auth = `Basic ${btoa(`${apiId}:${password}`)}`;
  const dayStart = Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000) - 2 * 3600;
  const to = dayStart + 4 * 86400;
  /** @type {Map<string, SitooZReport>} */
  const seen = new Map();
  let from = dayStart;
  for (let page = 0; ; page++) {
    if (page === 10) throw new HttpError(400, `${BRAND} returned too many POS Z-reports around ${date} to read in one fetch.`);
    const url = `${base.origin}/v2/accounts/${accountId}/pos-z-reports?dateaddedfrom=${from}&dateaddedto=${to}`;
    const data = await fetchJson(url, { headers: { authorization: auth, accept: 'application/json' } }, BRAND, fetchImpl);
    const items = /** @type {SitooZReport[]} */ (Array.isArray(data) ? data : []);
    for (const r of items) seen.set(`${r.registerid}|${r.zreportid}`, r);
    const last = items.at(-1)?.dateadded;
    if (items.length < 500 || typeof last !== 'number' || last <= from) break;
    from = last;
  }
  const reports = [...seen.values()].filter((r) => typeof r.datecreated === 'number' && osloDate(r.datecreated) === date);
  if (reports.length === 0) throw new HttpError(400, `${BRAND} returned no POS Z-reports closed on ${date}.`);
  return buildVoucher(reports, date);
}

/** @returns {SitooVoucher} */
function sampleVoucher() {
  return buildVoucher(
    [
      {
        zreportid: 418,
        registerid: '{3CCB9848-155A-49E1-7CA8-5F7F78FC3067}',
        registernumber: 1,
        datecreated: 1761332400,
        currencycode: 'NOK',
        vatgroupssales: [{ vatvalue: 25, moneytotal: '40448.75' }, { vatvalue: 15, moneytotal: '1150.00' }],
        vatgroupsrefund: [{ vatvalue: 25, moneytotal: '499.00' }],
        paymentssales: [{ name: 'Cash', moneytotal: '3450.00' }, { name: 'Card', moneytotal: '32998.75' }, { name: 'Vipps', moneytotal: '4850.00' }, { name: 'Gift Card', moneytotal: '300.00' }],
        paymentsrefund: [{ name: 'Card', moneytotal: '499.00' }],
        moneyroundoff: '0.00',
      },
    ],
    SAMPLE_DATE,
  );
}

/** @param {SitooLine} l */
function vatPartMinor(l) {
  if (l.vatRate <= 0 || l.vatCode === '0') return 0;
  return l.signedMinor - Math.round((l.signedMinor * 100) / (100 + l.vatRate));
}

/** @param {SitooVoucher} v @param {boolean} isSample */
function renderPreview(v, isSample) {
  const debit = v.lines.filter((l) => l.signedMinor > 0).reduce((s, l) => s + l.signedMinor, 0);
  const credit = v.lines.filter((l) => l.signedMinor < 0).reduce((s, l) => s - l.signedMinor, 0);
  const diff = debit - credit;
  const balanced = diff === 0 && debit > 0;
  const outputVat = -v.lines.reduce((s, l) => s + vatPartMinor(l), 0);
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI REVIEW VOUCHER`,
    title: `${v.date} · ${v.reports} Z-report${v.reports === 1 ? '' : 's'}`,
    badge: balanced ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }) : reaiBadge({ text: `Diff ${formatMinor(Math.abs(diff))} NOK`, tone: 'danger' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Payments (debit)', value: `${formatMinor(debit)} NOK` })}
        ${reaiMetric({ label: 'Sales incl. VAT (credit)', value: `${formatMinor(credit)} NOK` })}
        ${reaiMetric({ label: 'Estimated output VAT', value: `${formatMinor(outputVat)} NOK`, detail: 'ReAI calculates VAT from the VAT code' })}
      </div>
      <p class="muted-note">${v.ref}</p>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>VAT code</th><th>Posting</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${v.lines.map((l) => html`<tr><td class="mono">${l.account}</td><td class="mono">${l.vatCode}</td><td>${l.description}</td><td class="num">${l.signedMinor > 0 ? formatMinor(l.signedMinor) : ''}</td><td class="num">${l.signedMinor < 0 ? formatMinor(-l.signedMinor) : ''}</td></tr>`)}</tbody>
      </table></div>
      ${balanced && !isSample
        ? html`<form class="stack-sm confirm-box" hx-post="${BASE_PATH}/book" hx-target="#sitoo-book" hx-swap="innerHTML">
            <input type="hidden" name="voucherJson" value="${JSON.stringify(v)}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I checked these totals against the ${BRAND} Z-reports and will attach them in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="sitoo-book" class="stack-sm"></div>`
        : isSample
          ? reaiCallout({ tone: 'info', body: `Synthetic ${BRAND} Z-report loaded. Connect to ReAI and fetch a real day to book.` })
          : reaiCallout({ tone: 'warn', body: 'The Z-reports do not balance (payments versus sales). Check the day in Sitoo Backoffice before booking.' })}
    `,
  });
}

/**
 * Verifies the VAT codes used exist in ReAI with the expected rate and gross (vat_inclusive) basis.
 * @param {import('../../lib/types.d.ts').Env} env @param {{ accessToken: string, tenantId: number }} session @param {SitooLine[]} lines
 */
async function assertVatCodes(env, session, lines) {
  const codes = /** @type {Array<{ code: string, rate: number, amountBasis: string, reverseCharge: boolean }>} */ (
    await reaiRequest(env, '/api/vat-codes', { token: session.accessToken, tenantId: session.tenantId })
  );
  for (const l of lines) {
    if (l.vatCode === '0') continue;
    const c = codes.find((x) => x.code === l.vatCode);
    if (!c || Math.round(c.rate) !== l.vatRate || c.reverseCharge || (l.vatRate > 0 && c.amountBasis !== 'vat_inclusive')) {
      throw new HttpError(400, `ReAI VAT code ${l.vatCode} (${l.vatRate}%) is not available as a gross output VAT code for this company.`);
    }
  }
}

/**
 * Handles /app/sitoo/* routes.
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
      <section class="app-intro"><p class="eyebrow">RETAIL POS · NORDIC</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-sitoo-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({
          basePath: BASE_PATH,
          targetId: 'sitoo-output',
          brand: BRAND,
          hint: 'In Sitoo Backoffice open Settings / Sitoo REST API (Administrator, API extension enabled), generate a password and copy the API ID, password, base URL and account ID.',
          fields: [
            { name: 'baseUrl', label: 'API base URL', type: 'url', defaultValue: 'https://api.mysitoo.com' },
            { name: 'accountId', label: 'Account ID', placeholder: '1500' },
            { name: 'apiId', label: 'API ID', placeholder: '10020-140' },
            { name: 'apiPassword', label: 'API password', type: 'password' },
            { name: 'date', label: 'Z-report date', type: 'date', defaultValue: '$TODAY' },
          ],
          sampleAction: true,
        })}
        <div id="sitoo-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderPreview(sampleVoucher(), true));
  try {
    const form = await request.formData();
    if (pathname === `${BASE_PATH}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderPreview(await fetchApi(creds), false));
    }
    if (pathname === `${BASE_PATH}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('confirm') !== 'on') throw new HttpError(400, 'Confirm that you checked the Z-reports first.');
      const v = /** @type {SitooVoucher} */ (JSON.parse(String(form.get('voucherJson') ?? '{}')));
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v.date ?? '') || !Array.isArray(v.lines) || v.lines.length === 0) throw new HttpError(400, 'Invalid voucher.');
      if (!v.lines.every((l) => /^[0-9]{4}$/.test(l.account) && /^[0-9]{1,2}$/.test(l.vatCode) && Number.isInteger(l.signedMinor))) throw new HttpError(400, 'Invalid voucher line.');
      if (v.lines.reduce((s, l) => s + l.signedMinor, 0) !== 0) throw new HttpError(400, 'Voucher must balance to 0.00.');
      await assertVatCodes(env, session, v.lines);
      const marker = `${BRAND} Z-reports ${v.date}`;
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (await reaiAll(env, '/api/vouchers', { token: session.accessToken, tenantId: session.tenantId, query: { startDate: v.date, endDate: v.date, includeReversed: 'true' } }));
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      const created = /** @type {{ id: number, number: string, webUrl?: string }} */ (await reaiRequest(env, '/api/manual-vouchers', {
        token: session.accessToken,
        tenantId: session.tenantId,
        method: 'POST',
        body: {
          date: v.date,
          description: `${marker} (${v.ref})`.slice(0, 250),
          reviewReason: `${BRAND} POS Z-reports imported via apps.reai.no. Check against the Z-report PDFs.`,
          postings: pairVoucherRows(v.lines.map((l) => ({ accountNumber: l.account, postingDate: v.date, currencyCode: 'NOK', amount: Number((l.signedMinor / 100).toFixed(2)), vatCode: l.vatCode, description: l.description }))),
        },
      }));
      const href = created.webUrl ?? `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${href}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
