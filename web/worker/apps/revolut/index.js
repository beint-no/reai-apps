// @ts-check
import { assertPublicHttpsUrl, isoDate, num, renderApiFetchCard } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';
import { pairVoucherRows } from '../../lib/voucher-rows.js';

/** @typedef {{ date: string, merchant: string, account: string, amountMinor: number }} ExpenseLine amountMinor is positive for an expense, negative for a card refund */
/** @typedef {{ lines: ExpenseLine[], skippedForeign: number }} ExpenseBatch */

const BRAND = 'Revolut Business';
const TITLE = 'Revolut Business Card Expenses';
const LEAD = 'Fetch completed Revolut Business card payments, card refunds and fees for a period and create one review voucher in ReAI against your Revolut bank account.';
const DEFAULT_CLEARING = '1925';
const DEFAULT_EXPENSE = '6800';
const FEE_ACCOUNT = '7770';
const API = 'https://b2b.revolut.com/api/1.0';
const API_HINT = 'Create an API key in the Revolut API Console (developer.revolut.com/console) with the permission Accounts → Transactions → Read. Paste the key and the private signing key (private.pem) that the console generated. Only NOK transactions are imported.';

/** @type {ExpenseBatch} */
const SAMPLE = {
  skippedForeign: 0,
  lines: [
    { date: '2026-10-05', merchant: 'GitHub', account: DEFAULT_EXPENSE, amountMinor: 215000 },
    { date: '2026-10-12', merchant: 'AWS EMEA', account: DEFAULT_EXPENSE, amountMinor: 384000 },
    { date: '2026-10-12', merchant: 'AWS EMEA · Revolut fee', account: FEE_ACCOUNT, amountMinor: 1920 },
    { date: '2026-10-19', merchant: 'Figma', account: DEFAULT_EXPENSE, amountMinor: 54000 },
  ],
};

/**
 * Decodes a PKCS#8 PEM (or bare base64) Ed25519 private key.
 * @param {string} pem
 * @returns {Uint8Array<ArrayBuffer>}
 */
function pemToDer(pem) {
  const b64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  try {
    const bin = atob(b64);
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    throw new HttpError(400, 'The signing key must be the private.pem content from the Revolut API Console.');
  }
}

/**
 * Builds the Revolut signing headers: Ed25519 over timestamp + METHOD + /api path + query (no "?") + body.
 * @param {string} pem
 * @param {URL} url
 * @returns {Promise<Record<string, string>>}
 */
async function signHeaders(pem, url) {
  let key;
  try {
    key = await crypto.subtle.importKey('pkcs8', pemToDer(pem), { name: 'Ed25519' }, false, ['sign']);
  } catch {
    throw new HttpError(400, 'The signing key must be the private.pem content from the Revolut API Console.');
  }
  const timestamp = String(Date.now());
  const message = `${timestamp}GET${url.pathname}${url.search.replace(/^\?/, '')}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(message)));
  return { 'revolut-api-timestamp': timestamp, 'revolut-api-signature': btoa(String.fromCharCode(...sig)) };
}

const OSLO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * Returns the Europe/Oslo calendar day of an ISO timestamp.
 * @param {unknown} ts
 * @param {string} fallback
 */
function osloDay(ts, fallback) {
  const ms = Date.parse(String(ts ?? ''));
  return Number.isFinite(ms) ? OSLO_DAY.format(ms) : fallback;
}

/** @param {string} day @param {number} delta */
const addDays = (day, delta) => new Date(Date.parse(`${day}T00:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10);

/**
 * Fetches completed NOK card payments, card refunds and fees from the Revolut Business API.
 * Docs: https://developer.revolut.com/docs/api/business#tag-transactions (GET /transactions with from, to (exclusive), count
 * up to 1000, state; newest first, paginate by passing the last created_at as to; legs[].amount, fee, currency, description;
 * merchant.name). from/to filter on created_at, so the window is widened to cover Oslo midnight and every transaction is
 * dated by the Oslo day of created_at; consecutive periods therefore never overlap or leave gaps.
 * https://developer.revolut.com/docs/guides/api-console/create-key (API key with Accounts → Transactions → Read),
 * https://developer.revolut.com/docs/guides/api-console/make-a-request (Revolut-Api-Timestamp and Ed25519
 * Revolut-Api-Signature) and the OpenAPI spec https://github.com/revolut-engineering/revolut-openapi (yaml/business.yaml).
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<ExpenseBatch>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const apiKey = (creds.apiKey ?? '').trim();
  const signingKey = (creds.signingKey ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!apiKey) throw new HttpError(400, 'Enter your Revolut Business API key.');
  if (to < from) throw new HttpError(400, 'The end date must be on or after the start date.');
  const expenseAccount = /^[0-9]{4}$/.test((creds.expenseAccount ?? '').trim()) ? (creds.expenseAccount ?? '').trim() : DEFAULT_EXPENSE;

  /** @type {ExpenseLine[]} */ const lines = [];
  let skippedForeign = 0;
  let cursor = `${addDays(to, 1)}T00:00:00Z`;
  for (let page = 0; page < 20; page++) {
    const url = new URL(`${API}/transactions`);
    url.searchParams.set('from', `${addDays(from, -1)}T22:00:00Z`);
    url.searchParams.set('to', cursor);
    url.searchParams.set('count', '1000');
    url.searchParams.set('state', 'completed');
    assertPublicHttpsUrl(url.toString());
    const res = await fetchImpl(url.toString(), {
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json', ...(signingKey ? await signHeaders(signingKey, url) : {}) },
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      throw new HttpError(400, res.status === 401 || res.status === 403
        ? 'Revolut rejected the API key or signature. Check the key permission and the signing key.'
        : `Revolut returned HTTP ${res.status}.`);
    }
    const txs = /** @type {any[]} */ (await res.json());
    if (!Array.isArray(txs) || txs.length === 0) break;
    for (const tx of txs) {
      if (tx.state !== 'completed' || (tx.type !== 'card_payment' && tx.type !== 'card_refund' && tx.type !== 'fee')) continue;
      const date = osloDay(tx.created_at, to);
      if (date < from || date > to) continue;
      for (const leg of Array.isArray(tx.legs) ? tx.legs : []) {
        const amountMinor = Math.round(num(leg.amount) * 100);
        const feeMinor = Math.round(Math.abs(num(leg.fee)) * 100);
        const refund = tx.type === 'card_refund' && amountMinor > 0;
        if (amountMinor >= 0 && feeMinor === 0 && !refund) continue;
        if (String(leg.currency ?? '').toUpperCase() !== 'NOK') { skippedForeign += 1; continue; }
        const merchant = String(tx.merchant?.name ?? leg.description ?? (tx.type === 'fee' ? 'Revolut fee' : 'Card payment')).trim().slice(0, 120);
        if (amountMinor < 0) lines.push({ date, merchant, account: tx.type === 'fee' ? FEE_ACCOUNT : expenseAccount, amountMinor: -amountMinor });
        if (refund) lines.push({ date, merchant: `${merchant} · refund`, account: expenseAccount, amountMinor: -amountMinor });
        if (feeMinor > 0) lines.push({ date, merchant: `${merchant} · Revolut fee`, account: FEE_ACCOUNT, amountMinor: feeMinor });
      }
    }
    const last = txs[txs.length - 1];
    if (txs.length < 1000 || !last?.created_at) break;
    cursor = String(last.created_at);
  }
  if (lines.length === 0) {
    throw new HttpError(400, skippedForeign > 0
      ? `Revolut returned no NOK card payments for ${from} to ${to}. Transactions in other currencies are not imported.`
      : `Revolut returned no completed card payments for ${from} to ${to}.`);
  }
  lines.sort((a, b) => a.date.localeCompare(b.date));
  return { lines, skippedForeign };
}

/** @param {{ batch: ExpenseBatch, clearingAccount: string, isSample?: boolean }} state */
function renderPreview(state) {
  const { lines, skippedForeign } = state.batch;
  const totalMinor = lines.reduce((s, l) => s + l.amountMinor, 0);
  const lastDate = lines.map((l) => l.date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
  return reaiCard({
    eyebrow: 'REVOLUT BUSINESS → REAI REVIEW VOUCHER',
    title: `${lines.length} expense lines · ${lastDate.slice(0, 7)}`,
    badge: state.isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Expense lines', value: String(lines.length) })}
        ${reaiMetric({ label: 'Net expenses', value: `${formatMinor(totalMinor)} NOK` })}
        ${reaiMetric({ label: 'Credit Revolut account', value: state.clearingAccount })}
      </div>
      ${skippedForeign > 0 ? reaiCallout({ tone: 'warn', body: `${skippedForeign} transactions in other currencies were skipped. Book them from the bank statement in ReAI.` }) : ''}
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Merchant</th><th>Account</th><th class="num">Amount</th></tr></thead>
        <tbody>${lines.map((l) => html`<tr><td class="mono">${l.date}</td><td>${l.merchant}</td><td class="mono">${l.account}</td><td class="num">${formatMinor(l.amountMinor)} NOK</td></tr>`)}</tbody>
      </table></div>
      <p class="muted-note">Every line is posted without VAT. Set the right VAT code in ReAI when you attach the receipt, for example reverse charge for services bought abroad.</p>
      ${!state.isSample ? html`<form class="stack-sm confirm-box" hx-post="/app/revolut/book" hx-target="#cd-book" hx-swap="innerHTML">
        <input type="hidden" name="linesJson" value="${JSON.stringify(lines)}"><input type="hidden" name="clearingAccount" value="${state.clearingAccount}">
        <label class="check-row"><input type="checkbox" name="c_receipts" required> I verified these ${BRAND} expenses and will attach receipts in ReAI.</label>
        <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
      </form><div id="cd-book" class="stack-sm"></div>` : reaiCallout({ tone: 'info', body: `Sample ${BRAND} batch loaded. Connect to ReAI and fetch a real period above to book it.` })}
    `,
  });
}

/**
 * Handles /app/revolut/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/revolut';
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">CORPORATE CARDS & EXPENSES</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-revolut-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({
          basePath,
          targetId: 'card-output',
          brand: BRAND,
          hint: API_HINT,
          fields: [
            { name: 'apiKey', label: 'API key', type: 'password', placeholder: 'Revolut API key' },
            { name: 'signingKey', label: 'Signing private key (private.pem)', type: 'password', placeholder: '-----BEGIN PRIVATE KEY-----…', required: false },
            { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
            { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
            { name: 'expenseAccount', label: 'Expense account for card payments', defaultValue: DEFAULT_EXPENSE },
            { name: 'clearingAccount', label: 'ReAI account for the Revolut bank account', defaultValue: DEFAULT_CLEARING },
          ],
          sampleAction: true,
        })}
        <div id="card-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${basePath}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) return htmlResponse(renderPreview({ batch: SAMPLE, clearingAccount: DEFAULT_CLEARING, isSample: true }));
  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      const clearingAccount = (creds.clearingAccount ?? '').trim();
      if (!/^[0-9]{4}$/.test(clearingAccount)) throw new HttpError(400, 'Enter the four digit ReAI account for the Revolut bank account.');
      return htmlResponse(renderPreview({ batch: await fetchApi(creds), clearingAccount }));
    }
    if (pathname === `${basePath}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('c_receipts') !== 'on') throw new HttpError(400, 'Confirm verification checkbox first.');
      const lines = /** @type {ExpenseLine[]} */ (JSON.parse(String(form.get('linesJson') ?? '[]')));
      const clearingAccount = String(form.get('clearingAccount') ?? DEFAULT_CLEARING).trim();
      if (!Array.isArray(lines) || lines.length === 0 || !/^[0-9]{4}$/.test(clearingAccount)) throw new HttpError(400, 'Voucher is empty.');
      for (const l of lines) {
        if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(l.date)) || !/^[0-9]{4}$/.test(String(l.account)) || !Number.isInteger(l.amountMinor) || l.amountMinor === 0) throw new HttpError(400, 'Voucher lines are invalid.');
      }
      const lastDate = lines.map((l) => l.date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
      const totalMinor = lines.reduce((s, l) => s + l.amountMinor, 0);
      const marker = `${BRAND} expenses ${lastDate.slice(0, 7)} (${lines.length} lines, ${totalMinor})`;
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (await reaiAll(env, '/api/vouchers', { ...auth, query: { startDate: lastDate, endDate: lastDate, includeReversed: 'true' } }));
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      // Each line is paired with its own counter posting on the Revolut account on the same date (one debit + one credit per rowNumber).
      /** @type {Array<{ accountNumber: string, postingDate: string, currencyCode: string, amount: number, vatCode: string, description: string, rowNumber: number }>} */
      const postings = [];
      for (const l of lines) {
        const pair = pairVoucherRows([
          { accountNumber: l.account, postingDate: l.date, currencyCode: 'NOK', amount: l.amountMinor / 100, vatCode: '0', description: l.merchant },
          { accountNumber: clearingAccount, postingDate: l.date, currencyCode: 'NOK', amount: -l.amountMinor / 100, vatCode: '0', description: 'Revolut Business' },
        ]);
        const offset = postings.length / 2;
        for (const p of pair) postings.push({ ...p, description: l.merchant.slice(0, 200), rowNumber: p.rowNumber + offset });
      }
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', { ...auth, method: 'POST', body: { date: lastDate, description: marker, reviewReason: `${BRAND} card expenses imported via apps.reai.no. Attach receipts and set VAT codes.`, postings } }));
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
