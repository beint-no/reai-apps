// @ts-check
import { num } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/**
 * @typedef {{ date: string, description: string, account: string, amountMinor: number, currency: string, vatCode: string, vatRate: number, reverseVat: boolean, person: string, project: string, note: string }} ExpenseLine
 */

const BRAND = 'Mynt';
const BASE = '/app/mynt';
const TITLE = 'Mynt Card Expenses';
const LEAD = 'Import a Mynt expense export (CSV) into one balanced ReAI review voucher: each card purchase on its expense account, against a separate Mynt card account.';
const DEFAULT_CLEARING = '1925';
const DEFAULT_EXPENSE = '6800';

/*
 * Mynt has no customer API (its Partner API at https://docs.mynt.com/get-started-with-mynt-platform issues tokens only to
 * partners). Customers without a direct accounting integration export CSV/SIE/Excel:
 * https://help.mynt.com/en/articles/612739-export-via-excel and https://help.mynt.com/en/articles/612759-reports-for-csv-and-sie-exports
 * Documented fields: Transaction date, Settlement date, Amount, Currency, Original amount, Original currency, VAT amount,
 * VAT rate, Reverse VAT, Description, Account, Category, Comment, Filename, Settlement status, Person, Team, Card number,
 * Card name, Accounting status, Cost center, Project, Type, VAT code, Cost center ID, Export date override.
 */
const SAMPLE_CSV = 'Transaction date;Amount;Currency;VAT amount;VAT rate;Reverse VAT;Description;Account;Category;Comment;Person;Project\n'
  + '2026-10-03;-1250,00;NOK;250,00;25;No;Clas Ohlson;6800;Office supplies;Printer paper and toner;Kari Nordmann;\n'
  + '2026-10-08;-899,00;NOK;96,32;12;No;Vy;7140;Travel;Train Oslo to Bergen;Ola Nordmann;Prosjekt Vest\n'
  + '2026-10-15;-420,00;NOK;0,00;0;Yes;Cloudflare Inc;6540;Software;Monthly subscription;Kari Nordmann;';

/** Maps a Norwegian input VAT rate to the ReAI deductible input VAT code (amounts are VAT inclusive). */
/** @type {Record<string, string>} */
const INPUT_VAT_CODE = { '25': '1', '15': '11', '12': '13' };

/** @param {string} h */
function key(h) {
  return h.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** @param {string} v */
function day(v) {
  const s = v.trim();
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(s)) return s.slice(0, 10);
  const m = /^([0-9]{1,2})[./]([0-9]{1,2})[./]([0-9]{4})/.exec(s);
  return m ? `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}` : '';
}

/** @param {string} v */
function truthy(v) {
  return /^(yes|ja|true|1|x)$/i.test(v.trim());
}

/**
 * Parses a Mynt CSV export (documented column names) into expense lines.
 * Purchases and refunds keep their direction: the dominant sign in the file is treated as purchases.
 * @param {string} text
 * @param {{ bookVat?: boolean }} [opts]
 * @returns {ExpenseLine[]}
 */
export function parseMyntCsv(text, opts = {}) {
  const bookVat = opts.bookVat !== false;
  const doc = parseCsv(text);
  const cols = doc.headers.map(key);
  const cell = (/** @type {string[]} */ r, /** @type {string} */ name) => {
    const i = cols.indexOf(name);
    return i >= 0 ? (r[i] ?? '').trim() : '';
  };
  if (!cols.includes('transaction date') || !cols.includes('amount')) throw new HttpError(400, 'Mynt CSV must include the Transaction date and Amount columns.');
  const signed = doc.rows.map((r) => Math.round(num(cell(r, 'amount')) * 100));
  const negatives = signed.filter((v) => v < 0).length;
  const purchaseSign = negatives > signed.length - negatives ? -1 : 1;
  /** @type {ExpenseLine[]} */
  const out = [];
  doc.rows.forEach((r, idx) => {
    const date = day(cell(r, 'export date override')) || day(cell(r, 'transaction date'));
    const amountMinor = (signed[idx] ?? 0) * purchaseSign;
    if (!date || amountMinor === 0) return;
    const rawAcct = cell(r, 'account').replace(/\s.*$/, '');
    const rate = Math.round(num(cell(r, 'vat rate')));
    const reverseVat = truthy(cell(r, 'reverse vat'));
    const vatCode = bookVat && !reverseVat ? (INPUT_VAT_CODE[String(rate)] ?? '0') : '0';
    out.push({
      date,
      description: cell(r, 'description') || cell(r, 'category') || 'Mynt card purchase',
      account: /^[0-9]{4}$/.test(rawAcct) ? rawAcct : DEFAULT_EXPENSE,
      amountMinor,
      currency: (cell(r, 'currency') || 'NOK').toUpperCase(),
      vatCode,
      vatRate: rate,
      reverseVat,
      person: cell(r, 'person'),
      project: cell(r, 'project'),
      note: cell(r, 'comment'),
    });
  });
  if (out.length === 0) throw new HttpError(400, 'No Mynt expense rows with a date and amount found.');
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Builds balanced manual voucher postings: one row per expense (expense account vs Mynt card account).
 * Refunds (negative amounts) credit the expense account and debit the card account.
 * @param {ExpenseLine[]} lines
 * @param {string} clearingAccount
 * @param {string} currency
 */
export function buildPostings(lines, clearingAccount, currency) {
  return lines.flatMap((l, rowNumber) => {
    const amount = Number((l.amountMinor / 100).toFixed(2));
    const description = [l.description, l.person].filter(Boolean).join(' · ').slice(0, 250);
    return [
      { accountNumber: l.account, postingDate: l.date, currencyCode: currency, amount, vatCode: l.vatCode, rowNumber, description },
      { accountNumber: clearingAccount, postingDate: l.date, currencyCode: currency, amount: -amount, vatCode: '0', rowNumber, description },
    ];
  });
}

/** @param {{ lines: ExpenseLine[], clearingAccount: string, isSample?: boolean }} state */
function renderPreview(state) {
  const { lines, clearingAccount, isSample } = state;
  const totalMinor = lines.reduce((s, l) => s + l.amountMinor, 0);
  const lastDate = lines.map((l) => l.date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
  const reverse = lines.filter((l) => l.reverseVat).length;
  const currencies = [...new Set(lines.map((l) => l.currency))];
  return reaiCard({
    eyebrow: 'MYNT EXPORT → REAI REVIEW VOUCHER',
    title: `${lines.length} card lines · ${lastDate.slice(0, 7)}`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Balanced', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Lines', value: String(lines.length), detail: 'Purchases and refunds' })}
        ${reaiMetric({ label: 'Net card spend', value: `${formatMinor(totalMinor)} ${currencies.join('/')}`, detail: `Credit ${clearingAccount}` })}
        ${reaiMetric({ label: 'Reverse charge lines', value: String(reverse), detail: 'Booked with VAT code 0, set the code in review' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Description</th><th>Person / project</th><th>Account</th><th>VAT code</th><th class="num">Amount</th></tr></thead>
        <tbody>${lines.map((l) => html`<tr>
          <td class="mono">${l.date}</td><td>${l.description}${l.note ? html`<br><span class="muted-note">${l.note}</span>` : ''}</td>
          <td>${l.person || '—'}${l.project ? html`<br><span class="muted-note">${l.project}</span>` : ''}</td>
          <td class="mono">${l.account}</td><td class="mono">${l.vatCode}${l.reverseVat ? ' (reverse)' : ''}</td>
          <td class="num">${formatMinor(l.amountMinor)} ${l.currency}</td>
        </tr>`)}</tbody>
      </table></div>
      ${isSample
        ? reaiCallout({ tone: 'info', body: 'Sample Mynt export loaded. Connect to ReAI and upload your own export to create the voucher.' })
        : html`<form class="stack-sm confirm-box" hx-post="${BASE}/book" hx-target="#mynt-book" hx-swap="innerHTML">
            <input type="hidden" name="linesJson" value="${JSON.stringify(lines)}"><input type="hidden" name="clearingAccount" value="${clearingAccount}">
            <label class="check-row"><input type="checkbox" name="c_check" required> I checked accounts and VAT codes and will attach the Mynt receipts in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="mynt-book" class="stack-sm"></div>`}
    `,
  });
}

/**
 * Handles /app/mynt/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE}/`, request.url), 301);
  if (pathname === `${BASE}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">CORPORATE CARDS & EXPENSES</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-mynt-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${reaiCard({
          eyebrow: 'MYNT CSV EXPORT',
          title: 'Upload a Mynt expense report',
          body: html`<form class="stack" hx-post="${BASE}/preview" hx-encoding="multipart/form-data" hx-target="#mynt-output" hx-swap="innerHTML">
            <p class="muted-note">In Mynt: Accounting &amp; Export → Ready for Export → select expenses → Create report, then download the report as CSV from Reports. The file stays in this request and is never stored.</p>
            <div class="mapping-grid">
              <div class="field"><label for="mynt-cl">Mynt card account (4 digits)</label><input id="mynt-cl" name="clearingAccount" type="text" pattern="[0-9]{4}" value="${DEFAULT_CLEARING}" required></div>
            </div>
            <label class="check-row"><input type="checkbox" name="bookVat" checked> Book input VAT from the Mynt VAT rate (25 %, 15 %, 12 %)</label>
            ${reaiDropzone({ inputId: 'mynt-csv', name: 'file', accept: '.csv,text/csv,text/plain', label: 'Choose Mynt CSV', hint: 'Mynt export with Transaction date, Amount, Currency, VAT rate, Description and Account.' })}
            <div class="inline-row">
              <button type="submit" class="button primary">Preview balanced voucher</button>
              <button type="button" class="button secondary" hx-post="${BASE}/sample" hx-target="#mynt-output" hx-swap="innerHTML">Load sample preview</button>
            </div>
          </form>`,
        })}
        <div id="mynt-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE}/sample`) return htmlResponse(renderPreview({ lines: parseMyntCsv(SAMPLE_CSV), clearingAccount: DEFAULT_CLEARING, isSample: true }));
  try {
    const form = await request.formData();
    if (pathname === `${BASE}/preview`) {
      const clearingAccount = String(form.get('clearingAccount') ?? DEFAULT_CLEARING).trim();
      if (!/^[0-9]{4}$/.test(clearingAccount)) throw new HttpError(400, 'Mynt card account must be 4 digits.');
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a Mynt CSV file first.');
      const lines = parseMyntCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer())), { bookVat: form.get('bookVat') === 'on' });
      return htmlResponse(renderPreview({ lines, clearingAccount }));
    }
    if (pathname === `${BASE}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('c_check') !== 'on') throw new HttpError(400, 'Confirm the checkbox first.');
      const company = session.tenants.find((t) => t.id === session.tenantId);
      if (!company) throw new HttpError(400, 'Select a valid ReAI company.');
      const clearingAccount = String(form.get('clearingAccount') ?? DEFAULT_CLEARING).trim();
      if (!/^[0-9]{4}$/.test(clearingAccount)) throw new HttpError(400, 'Mynt card account must be 4 digits.');
      const lines = /** @type {ExpenseLine[]} */ (JSON.parse(String(form.get('linesJson') ?? '[]')))
        .filter((l) => l && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(l.date) && /^[0-9]{4}$/.test(l.account) && Number.isInteger(l.amountMinor) && l.amountMinor !== 0 && ['0', '1', '11', '13'].includes(l.vatCode));
      if (lines.length === 0) throw new HttpError(400, 'No expense lines to book.');
      const other = lines.find((l) => l.currency !== company.currencyCode);
      if (other) throw new HttpError(400, `The Mynt export has ${other.currency} amounts but ${company.companyName} keeps its books in ${company.currencyCode}.`);
      const firstDate = lines.map((l) => l.date).sort()[0] ?? '';
      const lastDate = lines.map((l) => l.date).sort().at(-1) ?? firstDate;
      const totalMinor = lines.reduce((s, l) => s + l.amountMinor, 0);
      const marker = `${BRAND} expenses ${firstDate} to ${lastDate} (${lines.length} lines, ${totalMinor})`;
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (await reaiAll(env, '/api/vouchers', { token: session.accessToken, tenantId: session.tenantId, query: { startDate: lastDate, endDate: lastDate, includeReversed: 'true' } }));
      const dup = existing.find((v) => typeof v.description === 'string' && v.description.startsWith(marker));
      if (dup) return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { date: lastDate, description: marker, reviewReason: `${BRAND} export imported via apps.reai.no. Check VAT codes and attach receipts.`, postings: buildPostings(lines, clearingAccount, company.currencyCode) } }));
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`<a href="${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse(`Unknown ${BRAND} route.`, 404);
}
