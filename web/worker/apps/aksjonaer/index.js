// @ts-check
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../../lib/ui.js';
import { decodeCsvBytes, parseCsv, parseDay } from '../../lib/csv.js';

/**
 * @typedef {'listed_share' | 'unlisted_share' | 'fund' | 'bond' | 'other'} InstrumentType
 * @typedef {{ name: string, ticker: string, isin: string, orgNr: string, type: InstrumentType | null, account: string, qty: number | null, cost: number | null, date: string, exemption: boolean | null }} HoldingRow
 * @typedef {{ id: number, name: string, isin: string | null, ticker: string | null, instrumentType: string, assetAccountNumber: string, quantity: number, costPrice: number, currencyCode: string, withinExemptionMethod: boolean | null }} ShareInvestment
 */

const PREVIEW_LIMIT = 80;

/** @type {Array<[RegExp, InstrumentType]>} */
const TYPE_WORDS = [
  [/^(listed|listed_share|børsnotert|notert|aksje)/i, 'listed_share'],
  [/^(unlisted|unlisted_share|unotert|ikke børsnotert)/i, 'unlisted_share'],
  [/^(fund|fond|aksjefond|rentefond)/i, 'fund'],
  [/^(bond|obligasjon)/i, 'bond'],
  [/^(other|annet|annen)/i, 'other'],
];

/**
 * Parses Norwegian or international decimal text ("1 234,50", "1.234,50", "1234.50").
 * @param {string} raw
 * @returns {number | null} null for an empty cell
 */
function parseNumber(raw) {
  let s = raw.replace(/[\s ']/g, '').replace(/(NOK|kr)$/i, '');
  if (s === '' || s === '-') return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    s = s.replace(',', '.');
  }
  if (!/^-?[0-9]+(\.[0-9]+)?$/.test(s)) throw new HttpError(400, `'${raw.slice(0, 30)}' is not a number. Use digits with comma or point as decimal separator.`);
  return Number(s);
}

/** @param {string} raw @returns {boolean | null} */
function parseExemption(raw) {
  const v = raw.trim().toLowerCase();
  if (['ja', 'yes', 'true', '1', 'innenfor', 'within'].includes(v)) return true;
  if (['nei', 'no', 'false', '0', 'utenfor', 'outside'].includes(v)) return false;
  return null;
}

/** @param {string} raw @returns {InstrumentType | null} */
function parseType(raw) {
  const v = raw.trim();
  if (!v) return null;
  for (const [re, type] of TYPE_WORDS) if (re.test(v)) return type;
  throw new HttpError(400, `Unknown instrument type '${v.slice(0, 30)}'. Use listed, unlisted, fund, bond or other.`);
}

/**
 * Maps a portfolio CSV to holding rows.
 * @param {import('../../lib/csv.js').CsvDocument} doc
 * @returns {HoldingRow[]}
 */
export function parseHoldings(doc) {
  const h = doc.headers.map((x) => x.toLowerCase().trim());
  /** @param {RegExp} re */
  const col = (re) => h.findIndex((x) => re.test(x));
  const idx = {
    name: col(/name|navn|selskap|verdipapir/),
    ticker: col(/tick/),
    isin: col(/isin/),
    org: col(/^org|organi[sz]ation/),
    type: col(/^type|instrument/),
    account: col(/account|konto/),
    qty: col(/qty|antall|quantity|beholdning/),
    cost: col(/cost|kost|anskaff/),
    date: col(/date|dato/),
    exemption: col(/exempt|fritak/),
  };
  if (idx.name < 0) throw new HttpError(400, 'The CSV needs a Name or Navn column.');
  /** @param {string[]} r @param {number} i */
  const cell = (r, i) => (i >= 0 ? (r[i] ?? '').trim() : '');
  return doc.rows
    .map((r, line) => {
      const name = cell(r, idx.name);
      if (!name) return null;
      try {
        const account = cell(r, idx.account);
        const date = cell(r, idx.date);
        const isin = cell(r, idx.isin).toUpperCase();
        if (isin && !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) throw new HttpError(400, `ISIN '${isin.slice(0, 20)}' is not valid.`);
        if (account && !/^[0-9]{4}$/.test(account)) throw new HttpError(400, `Account '${account.slice(0, 10)}' must be a 4 digit account such as 1350 or 1810.`);
        return /** @type {HoldingRow} */ ({
          name: name.slice(0, 150),
          ticker: cell(r, idx.ticker).slice(0, 20),
          isin,
          orgNr: cell(r, idx.org).replace(/\s+/g, '').slice(0, 9),
          type: parseType(cell(r, idx.type)),
          account,
          qty: parseNumber(cell(r, idx.qty)),
          cost: parseNumber(cell(r, idx.cost)),
          date: date ? parseDay(date) : '',
          exemption: parseExemption(cell(r, idx.exemption)),
        });
      } catch (err) {
        throw new HttpError(400, `Row ${line + 2} (${name.slice(0, 40)}): ${err instanceof Error ? err.message : 'invalid value'}`);
      }
    })
    .filter((x) => x !== null);
}

/**
 * Finds an existing ReAI holding for a CSV row (ISIN first, otherwise case-insensitive name).
 * @param {HoldingRow} row
 * @param {ShareInvestment[]} existing
 * @returns {ShareInvestment | undefined}
 */
export function findExisting(row, existing) {
  if (row.isin) return existing.find((x) => (x.isin ?? '').toUpperCase() === row.isin);
  const n = row.name.toLowerCase();
  return existing.find((x) => !x.isin && x.name.toLowerCase() === n);
}

/**
 * Builds the POST /api/share-investments body. A catalogue match sends securityId instead of local metadata.
 * @param {HoldingRow} r
 * @param {number | null} securityId
 */
export function holdingBody(r, securityId) {
  const round2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;
  return {
    ...(securityId
      ? { securityId }
      : {
          name: r.name,
          instrumentType: r.type,
          ...(r.ticker ? { ticker: r.ticker } : {}),
          ...(r.isin ? { isin: r.isin } : {}),
          ...(/^[0-9]{9}$/.test(r.orgNr) ? { organizationNumber: r.orgNr } : {}),
        }),
    ...(r.account ? { assetAccountNumber: r.account } : {}),
    ...(r.qty ? { openingQuantity: r.qty } : {}),
    ...(r.cost !== null && r.qty ? { openingCostAmount: round2(r.cost) } : {}),
    ...(r.date && r.qty ? { openingDate: r.date } : {}),
    withinExemptionMethod: r.exemption,
  };
}

/**
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {import('../../lib/types.d.ts').SessionData} session
 * @returns {Promise<ShareInvestment[]>}
 */
async function loadHoldings(env, session) {
  const list = await reaiRequest(env, '/api/share-investments', { token: session.accessToken, tenantId: session.tenantId });
  return Array.isArray(list) ? /** @type {ShareInvestment[]} */ (list) : [];
}

/**
 * Handles /app/aksjonaer/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/aksjonaer';
  const title = 'Share Investment Importer';
  const lead = 'Register share holdings from a portfolio CSV in ReAI Share Investments, matched to the ReAI securities catalogue by ISIN, and review the holdings already in ReAI.';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">PORTFOLIO CSV → REAI SHARE INVESTMENTS</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-aksjonaer-web', clientName: 'ReAI Aksjonær & Investments (Web)' })}
        ${reaiCard({
          eyebrow: 'UPLOAD PORTFOLIO CSV OR LOAD HOLDINGS',
          title: 'Register holdings in ReAI',
          body: html`<p class="muted-note">One row per holding. Name is required; ISIN, Ticker, Type (listed, unlisted, fund, bond, other), Account, Quantity, Cost, Date and Exemption (yes or no) are optional. Exemption left empty means not assessed. Nordnet transactions are imported in ReAI itself under Share investments.</p>
          <form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#pw-output" hx-swap="innerHTML">
            ${reaiDropzone({ inputId: 'ak-csv', name: 'file', accept: '.csv,text/csv', label: 'Choose portfolio CSV', hint: 'Columns: Name, ISIN, Ticker, Type, Account, Quantity, Cost, Date, Exemption.' })}
            <div class="inline-row">
              <button type="submit" class="button primary">Preview portfolio CSV</button>
              <button type="button" class="button secondary" hx-post="${basePath}/live" hx-target="#pw-output" hx-swap="innerHTML">Load ReAI holdings</button>
              <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#pw-output" hx-swap="innerHTML">Load sample portfolio</button>
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
      eyebrow: 'SAMPLE PORTFOLIO',
      title: 'Holdings preview',
      badge: reaiBadge({ text: 'Synthetic sample', tone: 'accent' }),
      body: html`<div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>ISIN</th><th>Type</th><th>Account</th><th class="num">Qty</th><th class="num">Cost</th><th>Exemption</th></tr></thead>
        <tbody>
          <tr><td><strong>Equinor ASA</strong></td><td class="mono">NO0010096985</td><td>listed_share</td><td class="mono">1350</td><td class="num">1200</td><td class="num">312 000,00</td><td>Within</td></tr>
          <tr><td><strong>Fjordinvest AS</strong></td><td class="mono">—</td><td>unlisted_share</td><td class="mono">1350</td><td class="num">500</td><td class="num">50 000,00</td><td>Not assessed</td></tr>
        </tbody></table></div>`,
    }));
  }

  try {
    const form = await request.formData();
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');

    if (pathname === `${basePath}/live`) {
      const list = await loadHoldings(env, session);
      const currencies = [...new Set(list.map((x) => x.currencyCode))];
      const totalMinor = list.reduce((s, x) => s + Math.round(Number(x.costPrice ?? 0) * 100), 0);
      return htmlResponse(reaiCard({
        eyebrow: 'REAI SHARE INVESTMENTS',
        title: `${list.length} holdings in ReAI`,
        badge: reaiBadge({ text: 'Live API', tone: 'success' }),
        body: html`<div class="metric-grid">${reaiMetric({ label: 'Holdings', value: String(list.length), detail: 'GET /api/share-investments' })}${reaiMetric({ label: 'Carrying amount', value: currencies.length === 1 ? `${formatMinor(totalMinor)} ${currencies[0]}` : currencies.length === 0 ? '0,00' : 'Several currencies', detail: 'Book value after write-downs' })}</div>
          <div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Ticker / ISIN</th><th>Account</th><th class="num">Qty</th><th class="num">Carrying amount</th><th>Exemption</th></tr></thead>
          <tbody>${list.slice(0, 100).map((x) => html`<tr><td><strong>${x.name}</strong></td><td class="mono">${x.ticker || x.isin || '—'}</td><td class="mono">${x.assetAccountNumber || '—'}</td><td class="num">${x.quantity}</td><td class="num">${formatMinor(Math.round(Number(x.costPrice ?? 0) * 100))} ${x.currencyCode}</td><td>${x.withinExemptionMethod === null ? 'Not assessed' : x.withinExemptionMethod ? 'Within' : 'Outside'}</td></tr>`)}</tbody></table></div>`,
      }));
    }
    if (pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a portfolio CSV file.');
      const rows = parseHoldings(parseCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer()))));
      const existing = await loadHoldings(env, session);
      return htmlResponse(reaiCard({
        eyebrow: 'PORTFOLIO CSV PREVIEW',
        title: `${rows.length} holdings parsed`,
        body: html`${rows.length > PREVIEW_LIMIT ? reaiCallout({ tone: 'warn', body: `Showing the first ${PREVIEW_LIMIT} rows. Split the file to import the rest.` }) : ''}
          <div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>ISIN</th><th>Type</th><th class="num">Qty</th><th class="num">Cost</th><th>Exemption</th><th>Action</th></tr></thead>
          <tbody>${rows.slice(0, PREVIEW_LIMIT).map((r, idx) => {
            const dup = findExisting(r, existing);
            return html`<tr id="ak-r-${idx}"><td><strong>${r.name}</strong></td><td class="mono">${r.isin || '—'}</td><td>${r.type ?? (r.isin ? 'From catalogue' : 'Missing')}</td><td class="num">${r.qty ?? '—'}</td><td class="num">${r.cost === null ? '—' : r.cost.toFixed(2)}</td><td>${r.exemption === null ? 'Not assessed' : r.exemption ? 'Within' : 'Outside'}</td>
            <td>${dup
              ? reaiBadge({ text: `Already in ReAI #${dup.id}`, tone: 'neutral' })
              : html`<form hx-post="${basePath}/import-one" hx-target="#ak-r-${idx}" hx-swap="outerHTML"><input type="hidden" name="rowJson" value="${JSON.stringify(r)}"><button type="submit" class="button primary">Register</button></form>`}</td></tr>`;
          })}</tbody></table></div>`,
      }));
    }
    if (pathname === `${basePath}/import-one`) {
      const r = /** @type {HoldingRow} */ (JSON.parse(String(form.get('rowJson') ?? '{}')));
      if (typeof r.name !== 'string' || !r.name) throw new HttpError(400, 'The row has no name.');
      const existing = await loadHoldings(env, session);
      const dup = findExisting(r, existing);
      if (dup) return htmlResponse(html`<tr><td colspan="6"><strong>${r.name}</strong></td><td>${reaiBadge({ text: `Already in ReAI #${dup.id}`, tone: 'neutral' })}</td></tr>`);
      /** @type {number | null} */
      let securityId = null;
      if (r.isin) {
        const hits = /** @type {Array<{ id: number, isin: string | null }>} */ (await reaiRequest(env, '/api/securities', { token: session.accessToken, tenantId: session.tenantId, query: { query: r.isin, limit: '5', includeInactive: 'true' } }));
        securityId = (Array.isArray(hits) ? hits : []).find((s) => (s.isin ?? '').toUpperCase() === r.isin)?.id ?? null;
      }
      if (!securityId && !r.type) throw new HttpError(400, `${r.name} is not in the ReAI securities catalogue. Add a Type column (listed, unlisted, fund, bond or other).`);
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/share-investments', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: holdingBody(r, securityId) }));
      return htmlResponse(html`<tr><td colspan="6"><strong>${r.name}</strong></td><td>${reaiBadge({ text: `Registered #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Share investment error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
