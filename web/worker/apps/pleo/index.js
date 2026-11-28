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
 * @typedef {{ account: string, description: string, signedMinor: number, taxRate: number, taxType: string }} ExpensePosting
 * @typedef {{ accountingEntryId: string, date: string, label: string, currency: string, postings: ExpensePosting[] }} ExportItem
 * @typedef {{ jobId: string, jobStatus: string, items: ExportItem[], skipped: string[] }} ExportBatch
 * @typedef {{ code: string, rate: number, vatType: string, amountBasis: string, reverseCharge: boolean }} VatCode
 */

const BRAND = 'Pleo';
const BASE_PATH = '/app/pleo';
const TITLE = 'Pleo Export to ReAI';
const LEAD = 'Book the oldest Pleo export job as one ReAI review voucher and report the result back to Pleo, using the accounts, VAT and contra account set up in Pleo.';
const API = 'https://external.pleo.io';

/** @type {ExportBatch} */
const SAMPLE = {
  jobId: '00000000-0000-0000-0000-000000000000',
  jobStatus: 'pending',
  skipped: [],
  items: [
    { accountingEntryId: 'a1', date: '2026-10-04', label: 'Cloudflare Inc', currency: 'NOK', postings: [{ account: '6540', description: 'Cloudflare Inc', signedMinor: 42000, taxRate: 0, taxType: 'inclusive' }, { account: '2380', description: 'Pleo contra', signedMinor: -42000, taxRate: 0, taxType: '' }] },
    { accountingEntryId: 'a2', date: '2026-10-16', label: 'Clas Ohlson', currency: 'NOK', postings: [{ account: '6800', description: 'Kontorrekvisita', signedMinor: 64900, taxRate: 25, taxType: 'inclusive' }, { account: '2380', description: 'Pleo contra', signedMinor: -64900, taxRate: 0, taxType: '' }] },
  ],
};

/** @param {string} apiKey */
function pleoHeaders(apiKey) {
  return { authorization: `Basic ${btoa(`${apiKey}:`)}`, accept: 'application/json;charset=UTF-8' };
}

/**
 * Reads the oldest pending or started Pleo export job and its export items.
 * Docs: https://developers.pleo.io/docs/current/authentication/standalone-api-keys-overview.md (Basic auth with the key as username),
 * https://developers.pleo.io/reference/export-api/export-api-v3/get-a-list-of-export-jobs.md (GET /v3/export-jobs?statuses=),
 * https://developers.pleo.io/reference/export-api/export-items-v3/get-export-items.md (GET /v3/export-items?job_id=, cursor pagination, values in cents)
 * and https://developers.pleo.io/docs/current/integration-design/exports/integration-design-exports-bookkeeping-method-journal-entry.md
 * (one debit per accountingEntryLines entry, credit to contraAccount for the item total).
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<ExportBatch>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const apiKey = (creds.apiKey ?? '').trim();
  if (!apiKey) throw new HttpError(400, 'Enter your Pleo API key.');
  const headers = pleoHeaders(apiKey);
  const wanted = (creds.jobId ?? '').trim();
  const jobsQuery = new URLSearchParams({ limit: '100' });
  jobsQuery.append('statuses', 'pending');
  jobsQuery.append('statuses', 'in_progress');
  const jobsPage = await fetchJson(`${API}/v3/export-jobs?${jobsQuery}`, { headers }, BRAND, fetchImpl);
  /** @type {any[]} */ const jobs = Array.isArray(jobsPage?.data) ? jobsPage.data : [];
  const job = wanted
    ? jobs.find((j) => j.id === wanted)
    : jobs.toSorted((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
  if (!job) throw new HttpError(400, wanted ? 'That Pleo export job is no longer pending.' : 'Pleo has no pending export job. In Pleo, add expenses to the export queue and click Export first.');

  /** @type {any[]} */ const raw = [];
  let after = '';
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams({ job_id: String(job.id), limit: '100', ...(after ? { after } : {}) });
    const res = await fetchJson(`${API}/v3/export-items?${q}`, { headers }, BRAND, fetchImpl);
    if (Array.isArray(res?.data)) raw.push(...res.data);
    after = res?.pagination?.hasNextPage && typeof res.pagination.endCursor === 'string' ? res.pagination.endCursor : '';
    if (!after) break;
  }

  /** @type {ExportItem[]} */ const items = [];
  /** @type {string[]} */ const skipped = [];
  for (const it of raw) {
    const method = it?.bookkeeping?.method ?? 'none';
    const label = String(it?.supplier?.name ?? it?.vendor?.name ?? it?.note ?? 'Pleo expense').trim() || 'Pleo expense';
    if (method !== 'journal' && method !== 'none') {
      skipped.push(`${label}: bookkeeping method ${method} is not supported here`);
      continue;
    }
    const contra = String(it?.contraAccount?.code ?? '').trim();
    if (!/^[0-9]{4}$/.test(contra)) throw new HttpError(400, `Pleo has no four digit contra account for "${label}". Set the contra account in Pleo under Settings → Accounting → Contra accounts.`);
    /** @type {any[]} */ const lines = Array.isArray(it?.accountingEntryLines) ? it.accountingEntryLines : [];
    /** @type {ExpensePosting[]} */ const postings = [];
    let total = 0;
    for (const l of lines) {
      const account = String(l?.account?.code ?? '').trim();
      if (!/^[0-9]{4}$/.test(account)) throw new HttpError(400, `"${label}" has no four digit expense account in Pleo. Choose the account on the expense in Pleo.`);
      const cents = Math.round(Number(l?.lineAmount?.inWalletCurrency?.value ?? 0));
      if (!Number.isFinite(cents) || cents === 0) continue;
      total += cents;
      postings.push({ account, description: String(l?.account?.name ? `${label} · ${l.account.name}` : label).slice(0, 200), signedMinor: cents, taxRate: Math.round(Number(l?.tax?.rate ?? 0) * 10000) / 100, taxType: String(l?.tax?.type ?? '') });
    }
    if (total !== Math.round(Number(it?.amount?.inWalletCurrency?.value ?? total))) throw new HttpError(400, `The lines of "${label}" do not add up to the expense total in Pleo.`);
    if (postings.length === 0) continue;
    postings.push({ account: contra, description: `${label} · ${String(it?.contraAccount?.name ?? 'Pleo contra')}`.slice(0, 200), signedMinor: -total, taxRate: 0, taxType: '' });
    items.push({ accountingEntryId: String(it.accountingEntryId), date: isoDate(it.date), label, currency: String(it?.amount?.inWalletCurrency?.currency ?? 'NOK'), postings });
  }
  if (items.length === 0) throw new HttpError(400, skipped.length ? `The Pleo export job has no items this integration can book. ${skipped.join('; ')}.` : 'The Pleo export job is empty.');
  return { jobId: String(job.id), jobStatus: String(job.status), items, skipped };
}

/**
 * Picks the ReAI input VAT code for a VAT-inclusive Pleo expense line.
 * @param {VatCode[]} codes
 * @param {ExpensePosting} p
 */
function inputVatCode(codes, p) {
  if (p.signedMinor < 0 && p.taxType === '') return '0';
  if (p.taxRate <= 0) return '0';
  if (p.taxType !== 'inclusive') throw new HttpError(400, `Pleo tax type "${p.taxType}" on ${p.description} is not supported. Use a VAT inclusive tax code in Pleo.`);
  const match = codes.find((c) => c.vatType === 'input_vat' && !c.reverseCharge && c.amountBasis === 'vat_inclusive' && Math.abs(c.rate - p.taxRate) < 0.001);
  if (!match) throw new HttpError(400, `ReAI has no input VAT code for ${p.taxRate}% in this company.`);
  return match.code;
}

/**
 * Sends a batch of Pleo export job item updates (at most 100 per request).
 * Docs: https://developers.pleo.io/reference/export-api/export-api-v3/update-export-job-items.md
 * @param {string} jobId
 * @param {Array<Record<string, string>>} updates
 * @param {Record<string, string>} headers
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 */
async function updateItems(jobId, updates, headers, fetchImpl) {
  for (let i = 0; i < updates.length; i += 100) {
    await fetchJson(`${API}/v3/export-jobs/${encodeURIComponent(jobId)}/items`, { method: 'PUT', headers: { ...headers, 'content-type': 'application/json;charset=UTF-8' }, body: JSON.stringify(updates.slice(i, i + 100)) }, BRAND, fetchImpl);
  }
}

/**
 * Sends an export job event. Docs: https://developers.pleo.io/reference/export-api/export-api-v3/create-an-export-job-event.md
 * @param {Record<string, string>} body
 * @param {Record<string, string>} headers
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 */
async function jobEvent(body, headers, fetchImpl) {
  await fetchJson(`${API}/v3/export-job-events`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json;charset=UTF-8' }, body: JSON.stringify(body) }, BRAND, fetchImpl);
}

/**
 * Books one Pleo export job in ReAI and reports the outcome to Pleo, following
 * https://developers.pleo.io/docs/current/guides/export-integration-workflow-guide.md
 * (started event, items in_progress, items successful or failed, completed or failed event).
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {{ token: string, tenantId: number }} auth
 * @param {string} apiKey
 * @param {ExportBatch} batch
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 */
export async function bookBatch(env, auth, apiKey, batch, fetchImpl = fetch) {
  const headers = pleoHeaders(apiKey);
  if (batch.items.some((i) => i.currency !== 'NOK')) throw new HttpError(400, 'Only Pleo wallets in NOK can be booked here.');
  const dates = batch.items.map((i) => i.date).sort();
  const first = /** @type {string} */ (dates[0]);
  const last = /** @type {string} */ (dates.at(-1));
  const marker = `${BRAND} export ${batch.jobId}`;
  const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (await reaiAll(env, '/api/vouchers', { ...auth, query: { startDate: first, endDate: last, includeReversed: 'true' } }));
  const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
  if (dup) return { duplicate: true, id: dup.id, number: dup.number };

  const vatCodes = /** @type {VatCode[]} */ (await reaiRequest(env, '/api/vat-codes', auth));
  /** @type {Array<Record<string, unknown>>} */ const postings = [];
  let rowOffset = 0;
  for (const item of batch.items) {
    const rows = pairVoucherRows(item.postings.map((p) => ({ accountNumber: p.account, postingDate: item.date, currencyCode: 'NOK', amount: Number((p.signedMinor / 100).toFixed(2)), vatCode: inputVatCode(vatCodes, p), description: p.description })));
    for (const r of rows) postings.push({ ...r, rowNumber: r.rowNumber + rowOffset });
    rowOffset += Math.max(0, ...rows.map((r) => r.rowNumber));
  }

  if (batch.jobStatus === 'pending') await jobEvent({ jobId: batch.jobId, event: 'started' }, headers, fetchImpl);
  const ids = batch.items.map((i) => i.accountingEntryId);
  await updateItems(batch.jobId, ids.map((accountingEntryId) => ({ accountingEntryId, status: 'in_progress' })), headers, fetchImpl);
  let created;
  try {
    created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', {
      ...auth,
      method: 'POST',
      body: { date: last, description: `${marker} (${batch.items.length} expenses)`, reviewReason: `${BRAND} export job imported via apps.reai.no. Check the receipts in Pleo.`, postings },
    }));
  } catch (err) {
    const reason = (err instanceof Error ? err.message : 'ReAI rejected the voucher.').slice(0, 500);
    await updateItems(batch.jobId, ids.map((accountingEntryId) => ({ accountingEntryId, status: 'failed', failureReasonType: 'accounting_system_validation_failure', failureReason: reason })), headers, fetchImpl);
    await jobEvent({ jobId: batch.jobId, event: 'failed', failureReasonType: 'validation_failure', failureReason: reason }, headers, fetchImpl);
    throw err;
  }
  const exportedAt = new Date().toISOString().replace(/\.[0-9]{3}Z$/, 'Z');
  const externalUrl = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${auth.tenantId}`;
  await updateItems(batch.jobId, ids.map((accountingEntryId) => ({ accountingEntryId, status: 'successful', externalId: String(created.number), externalUrl, exportedAt })), headers, fetchImpl);
  await jobEvent({ jobId: batch.jobId, event: 'completed' }, headers, fetchImpl);
  return { duplicate: false, id: created.id, number: created.number };
}

/** @param {ExportBatch} b @param {string} apiKey @param {boolean} isSample */
function renderPreview(b, apiKey, isSample) {
  const lines = b.items.flatMap((i) => i.postings.map((p) => ({ ...p, date: i.date })));
  const debit = lines.filter((l) => l.signedMinor > 0).reduce((t, l) => t + l.signedMinor, 0);
  const credit = lines.filter((l) => l.signedMinor < 0).reduce((t, l) => t - l.signedMinor, 0);
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} EXPORT JOB → REAI REVIEW VOUCHER`,
    title: `${b.items.length} expenses`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : debit === credit ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }) : reaiBadge({ text: 'Not balanced', tone: 'danger' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Expenses (debit)', value: `${formatMinor(debit)} NOK` })}
        ${reaiMetric({ label: 'Contra account (credit)', value: `${formatMinor(credit)} NOK` })}
        ${reaiMetric({ label: 'Export job', value: b.jobId.slice(0, 8), detail: b.jobStatus })}
      </div>
      ${b.skipped.length ? reaiCallout({ tone: 'warn', body: `Left in Pleo: ${b.skipped.join('; ')}.` }) : ''}
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Account</th><th>Posting</th><th>VAT</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${lines.map((l) => html`<tr><td class="mono">${l.date}</td><td class="mono">${l.account}</td><td>${l.description}</td><td>${l.taxRate > 0 ? `${l.taxRate}%` : ''}</td><td class="num">${l.signedMinor > 0 ? formatMinor(l.signedMinor) : ''}</td><td class="num">${l.signedMinor < 0 ? formatMinor(-l.signedMinor) : ''}</td></tr>`)}</tbody>
      </table></div>
      <p class="muted-note">Expense lines are posted including VAT with the matching ReAI input VAT code. When you create the voucher, the export job is marked as exported in Pleo with a link to the voucher.</p>
      ${isSample
        ? reaiCallout({ tone: 'info', body: `Sample ${BRAND} export job loaded. Connect to ReAI and fetch a real export job above to book it.` })
        : html`<form class="stack-sm confirm-box" hx-post="${BASE_PATH}/book" hx-target="#pleo-book" hx-swap="innerHTML">
            <input type="hidden" name="jobId" value="${b.jobId}">
            <input type="hidden" name="apiKey" value="${apiKey}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I checked these expenses against Pleo.</label>
            <div><button type="submit" class="button primary">Create review voucher and mark exported in Pleo</button></div>
          </form><div id="pleo-book" class="stack-sm"></div>`}
    `,
  });
}

/**
 * Handles /app/pleo/* routes.
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
      <section class="app-intro"><p class="eyebrow">CORPORATE CARDS & EXPENSES</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-pleo-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${reaiCard({
          eyebrow: 'LIVE PLEO EXPORT API',
          title: 'Fetch the oldest Pleo export job',
          body: html`<p class="muted-note">Create the key in Pleo under Settings → API Keys with the export-jobs:read, export-jobs:write and export-items:read permissions. If API Keys is missing, ask Pleo Support to enable it. The key is used only for these requests and is never stored.</p>
            <form class="stack" hx-post="${BASE_PATH}/fetch-api" hx-target="#pleo-output" hx-swap="innerHTML">
              <div class="mapping-grid"><div class="field"><label for="pleo-key">Pleo API key</label><input id="pleo-key" name="apiKey" type="password" autocomplete="off" required placeholder="pls_..."></div></div>
              <div class="inline-row">
                <button type="submit" class="button primary">Fetch export job</button>
                <button type="button" class="button secondary" hx-post="${BASE_PATH}/sample" hx-target="#pleo-output" hx-swap="innerHTML">Load sample preview</button>
              </div>
            </form>`,
        })}
        <div id="pleo-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderPreview(SAMPLE, '', true));
  try {
    const form = await request.formData();
    const apiKey = String(form.get('apiKey') ?? '').trim();
    if (pathname === `${BASE_PATH}/fetch-api`) return htmlResponse(renderPreview(await fetchApi({ apiKey }), apiKey, false));
    if (pathname === `${BASE_PATH}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('confirm') !== 'on') throw new HttpError(400, 'Confirm the verification checkbox first.');
      const batch = await fetchApi({ apiKey, jobId: String(form.get('jobId') ?? '') });
      const result = await bookBatch(env, { token: session.accessToken, tenantId: session.tenantId }, apiKey, batch);
      const link = html`<a href="${reaiOrigin(env)}/voucher/${result.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${result.number} ↗</a>`;
      return htmlResponse(result.duplicate
        ? reaiCallout({ tone: 'warn', title: `Already booked (${result.number})`, body: html`This export job is already in ReAI: ${link}. Finish the job in Pleo if it is still pending.` })
        : reaiCallout({ tone: 'success', title: `Created review voucher ${result.number}`, body: html`The export job is marked as exported in Pleo. ${link}.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
