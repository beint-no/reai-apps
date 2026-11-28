// @ts-check
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiRequest } from '../../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone } from '../../lib/ui.js';
import { decodeCsvBytes, parseCsv } from '../../lib/csv.js';

/**
 * @typedef {{ accountNumber: string, amounts: number[] }} BudgetAccount
 */

/** @param {FormDataEntryValue | null} raw */
function parseYear(raw) {
  const year = Number(String(raw ?? '').trim());
  if (!Number.isInteger(year) || year < 1900 || year > 2100) throw new HttpError(400, 'Choose a fiscal year between 1900 and 2100.');
  return year;
}

/**
 * Parses Norwegian or international decimal text ("1 234,50", "1.234,50", "1234.50"); empty is zero.
 * @param {string} raw
 * @param {string} where
 * @returns {number}
 */
function parseAmount(raw, where) {
  let s = raw.replace(/[\s\u00a0']/g, '').replace(/(NOK|kr)$/i, '');
  if (s === '' || s === '-') return 0;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    s = s.replace(',', '.');
  }
  if (!/^-?[0-9]+(\.[0-9]+)?$/.test(s)) throw new HttpError(400, `${where}: '${raw.slice(0, 30)}' is not a number.`);
  const value = Math.round(Number(s) * 100) / 100;
  if (Math.abs(value) > 999_999_999_999.99) throw new HttpError(400, `${where}: amount is too large.`);
  return value;
}

/**
 * Maps a CSV (Account, Jan..Dec) to ReAI budget accounts. ReAI accepts only result accounts (3000-8999).
 * @param {import('../../lib/csv.js').CsvDocument} doc
 * @returns {BudgetAccount[]}
 */
export function parseBudget(doc) {
  if (doc.headers.length < 13) throw new HttpError(400, 'The CSV needs an Account column followed by twelve month columns (January to December).');
  /** @type {Map<string, BudgetAccount>} */
  const byAccount = new Map();
  doc.rows.forEach((r, i) => {
    const accountNumber = (r[0] ?? '').trim();
    if (!accountNumber) return;
    if (!/^[3-8][0-9]{3}$/.test(accountNumber)) throw new HttpError(400, `Row ${i + 2}: account '${accountNumber.slice(0, 10)}' is not a result account (3000 to 8999).`);
    if (byAccount.has(accountNumber)) throw new HttpError(400, `Account ${accountNumber} appears more than once. Combine the rows.`);
    byAccount.set(accountNumber, { accountNumber, amounts: Array.from({ length: 12 }, (_, m) => parseAmount(r[m + 1] ?? '', `Row ${i + 2}, month ${m + 1}`)) });
  });
  if (byAccount.size === 0) throw new HttpError(400, 'No accounts found in the first column.');
  if (byAccount.size > 500) throw new HttpError(400, 'ReAI accepts at most 500 budget accounts per year.');
  return [...byAccount.values()];
}

/**
 * Reads the budget version needed for an optimistic PUT; a never-saved year has version null.
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {import('../../lib/types.d.ts').SessionData} session
 * @param {number} year
 * @returns {Promise<number | null>}
 */
async function currentVersion(env, session, year) {
  try {
    const cur = /** @type {{ version?: number | null }} */ (await reaiRequest(env, `/api/company-budgets/${year}`, { token: session.accessToken, tenantId: session.tenantId }));
    return cur.version ?? null;
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Handles /app/budget/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/budget';
  const title = 'Company Budget Importer';
  const lead = 'Upload a monthly budget per result account from a CSV into ReAI company budgets and review the saved budget by quarter.';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const year = new Date().getUTCFullYear();
    const body = html`
      <section class="app-intro"><p class="eyebrow">NS 4102 MONTHLY BUDGET → REAI</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-budget-web', clientName: 'ReAI Company Budget (Web)' })}
        ${reaiCard({
          eyebrow: 'MONTHLY BUDGET CSV',
          title: 'Upload a budget or load the saved one',
          body: html`<form class="stack" hx-post="${basePath}/upload" hx-encoding="multipart/form-data" hx-target="#pw-output" hx-swap="innerHTML">
            <div class="field"><label for="bg-y">Fiscal year</label><input id="bg-y" name="year" type="number" min="1900" max="2100" value="${year}" required></div>
            ${reaiDropzone({ inputId: 'bg-csv', name: 'file', accept: '.csv,text/csv', label: 'Choose 12-month budget CSV', hint: 'Columns: Account, Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec. Result accounts 3000 to 8999, income and costs as positive amounts.' })}
            <p class="muted-note">Saving replaces the whole year in ReAI: accounts not in the file get a zero budget.</p>
            <div class="inline-row">
              <button type="submit" class="button primary">Replace budget in ReAI</button>
              <button type="button" class="button secondary" hx-post="${basePath}/live" hx-include="#bg-y" hx-target="#pw-output" hx-swap="innerHTML">Load live ReAI budget</button>
              <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#pw-output" hx-swap="innerHTML">Load sample budget</button>
            </div>
          </form>`,
        })}
        <div id="pw-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${basePath}/sample`) {
    return htmlResponse(reaiCard({
      eyebrow: 'COMPANY BUDGET SAMPLE', title: 'Budget preview by quarter', badge: reaiBadge({ text: 'Synthetic sample', tone: 'accent' }),
      body: html`<div class="table-wrap"><table class="data-table"><thead><tr><th>Account</th><th class="num">Q1</th><th class="num">Q2</th><th class="num">Q3</th><th class="num">Q4</th><th class="num">Full year</th></tr></thead>
        <tbody><tr><td class="mono">3000</td><td class="num">900000</td><td class="num">1050000</td><td class="num">750000</td><td class="num">1200000</td><td class="num"><strong>3900000</strong></td></tr>
        <tr><td class="mono">5000</td><td class="num">360000</td><td class="num">360000</td><td class="num">360000</td><td class="num">360000</td><td class="num"><strong>1440000</strong></td></tr>
        <tr><td class="mono">6300</td><td class="num">45000</td><td class="num">45000</td><td class="num">45000</td><td class="num">45000</td><td class="num"><strong>180000</strong></td></tr></tbody></table></div>`,
    }));
  }

  try {
    const form = await request.formData();
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    if (pathname === `${basePath}/live`) {
      const year = parseYear(form.get('year'));
      const b = /** @type {{ year: number, currencyCode: string, accounts?: Array<{ accountNumber: string, amounts: number[] }> }} */ (await reaiRequest(env, `/api/company-budgets/${year}`, { token: session.accessToken, tenantId: session.tenantId }));
      const accts = b.accounts ?? [];
      return htmlResponse(reaiCard({
        eyebrow: `REAI BUDGET ${b.year} (${b.currencyCode})`, title: `${accts.length} budgeted accounts`, badge: reaiBadge({ text: 'Live API', tone: 'success' }),
        body: html`<div class="table-wrap"><table class="data-table"><thead><tr><th>Account</th><th class="num">Q1</th><th class="num">Q2</th><th class="num">Q3</th><th class="num">Q4</th><th class="num">Full year</th></tr></thead>
          <tbody>${accts.slice(0, 100).map((a) => {
            const m = a.amounts ?? [];
            const sum = (/** @type {number} */ s, /** @type {number} */ e) => m.slice(s, e).reduce((acc, v) => acc + Number(v || 0), 0);
            return html`<tr><td class="mono">${a.accountNumber}</td><td class="num">${sum(0, 3).toFixed(0)}</td><td class="num">${sum(3, 6).toFixed(0)}</td><td class="num">${sum(6, 9).toFixed(0)}</td><td class="num">${sum(9, 12).toFixed(0)}</td><td class="num"><strong>${sum(0, 12).toFixed(0)}</strong></td></tr>`;
          })}</tbody></table></div>`,
      }));
    }
    if (pathname === `${basePath}/upload`) {
      const year = parseYear(form.get('year'));
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a 12-month budget CSV.');
      const accounts = parseBudget(parseCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer()))));
      const version = await currentVersion(env, session, year);
      const saved = /** @type {{ accounts: unknown[], currencyCode: string }} */ (await reaiRequest(env, `/api/company-budgets/${year}`, { token: session.accessToken, tenantId: session.tenantId, method: 'PUT', body: { version, accounts } }));
      return htmlResponse(reaiCallout({ tone: 'success', title: `Saved the ${year} budget`, body: `ReAI now holds ${saved.accounts.length} budget accounts for ${year} in ${saved.currencyCode}. Accounts not in the file were set to zero.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Company Budget error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
