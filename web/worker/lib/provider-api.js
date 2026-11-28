// @ts-check
import { html } from './html.js';
import { HttpError } from './http.js';
import { reaiCard } from './ui.js';
import { extractNorwegianOrg, verifiedNorwegianAccount } from '../apps/recman-core.js';

/**
 * @typedef {{ name: string, label: string, type?: 'text' | 'password' | 'url' | 'date', placeholder?: string, required?: boolean, defaultValue?: string }} ApiFieldSpec
 * @typedef {{ id: string, brand: string, hint: string, fields: ApiFieldSpec[] }} ProviderApiUi
 * @typedef {(input: string | URL, init?: RequestInit) => Promise<Response>} FetchLike
 */

const PRIVATE_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)|(\.local|\.internal)$/i;

/**
 * Validates that a user-supplied API base URL is a public HTTPS origin (SSRF guard).
 * @param {string} rawUrl
 * @returns {URL}
 */
export function assertPublicHttpsUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new HttpError(400, 'Enter a valid https:// API URL.');
  }
  if (parsed.protocol !== 'https:' || PRIVATE_HOST_RE.test(parsed.hostname)) {
    throw new HttpError(400, 'API URL must use a public https:// host.');
  }
  return parsed;
}

/** @param {unknown} v */
function num(v) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '0').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** @param {unknown} v @param {string} [fallback] */
function isoDate(v, fallback) {
  const s = String(v ?? '').trim();
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(s)) return s.slice(0, 10);
  return fallback ?? new Date().toISOString().slice(0, 10);
}

/**
 * Extracts an array from common REST envelope shapes (values, items, data, records, results, or root array).
 * @param {any} payload
 * @param {string[]} [keys]
 * @returns {any[]}
 */
function pickList(payload, keys = ['items', 'values', 'data', 'records', 'results', 'entries', 'orders', 'expenses', 'shifts', 'users', 'invoices', 'transactions', 'consignments']) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const k of keys) {
    if (Array.isArray(payload[k])) return payload[k];
  }
  return [];
}

/**
 * Performs a safe JSON fetch with consistent error messaging.
 * @param {string} url
 * @param {RequestInit} init
 * @param {string} brand
 * @param {FetchLike} [fetchImpl]
 * @returns {Promise<any>}
 */
async function fetchJson(url, init, brand, fetchImpl = fetch) {
  assertPublicHttpsUrl(url);
  const res = await fetchImpl(url, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const statusNote = res.status === 401 || res.status === 403 ? 'rejected the API key/token' : `returned HTTP ${res.status}`;
    throw new HttpError(400, `${brand} API ${statusNote}. Verify your credentials and permissions.`);
  }
  return res.json();
}

/**
 * Reusable SSR card for "Fetch live via <Provider> API" placed above CSV/manual fallback.
 * @param {{ basePath: string, targetId: string, brand: string, hint: string, fields: ApiFieldSpec[], extraFields?: import('./html.js').HtmlValue, sampleAction?: boolean }} opts
 */
export function renderApiFetchCard(opts) {
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  return reaiCard({
    eyebrow: `LIVE ${opts.brand.toUpperCase()} REST API`,
    title: `Fetch live directly from ${opts.brand} API`,
    body: html`
      <p class="muted-note">${opts.hint} Credentials are used only for this single HTTPS request and are never stored.</p>
      <form class="stack" hx-post="${opts.basePath}/fetch-api" hx-target="#${opts.targetId}" hx-swap="innerHTML">
        <div class="mapping-grid">
          ${opts.fields.map((f) => {
            const val = f.defaultValue === '$MONTH_START' ? monthStart : f.defaultValue === '$TODAY' ? today : (f.defaultValue ?? '');
            return html`<div class="field">
              <label for="api-${f.name}">${f.label}</label>
              <input id="api-${f.name}" name="${f.name}" type="${f.type ?? 'text'}" value="${val}"${f.type === 'password' ? html` autocomplete="off"` : ''}${f.required !== false ? html` required` : ''}${f.placeholder ? html` placeholder="${f.placeholder}"` : ''}>
            </div>`;
          })}
        </div>
        ${opts.extraFields ?? ''}
        <div class="inline-row">
          <button type="submit" class="button primary">Fetch from ${opts.brand} API</button>
          ${opts.sampleAction ? html`<button type="button" class="button secondary" hx-post="${opts.basePath}/sample" hx-target="#${opts.targetId}" hx-swap="innerHTML">Load sample preview</button>` : ''}
        </div>
      </form>
    `,
  });
}

// ---------------------------------------------------------------------------
// 1. TRADES & FIELD SERVICE (smartdok, holte, cordel, svenn, minuba, handyman)
// ---------------------------------------------------------------------------

/** @type {Record<'smartdok' | 'svenn' | 'cordel' | 'holte' | 'handyman' | 'minuba', ProviderApiUi>} */
export const TRADE_API_UI = {
  smartdok: {
    id: 'smartdok',
    brand: 'SmartDok',
    hint: 'Generate an API Access Token under Company settings → API administration in SmartDok (exchanged automatically via POST /Authorize/ApiToken).',
    fields: [
      { name: 'apiToken', label: 'SmartDok API Access Token', type: 'password', placeholder: 'API Access Token' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  holte: {
    id: 'holte',
    brand: 'EG Holte',
    hint: 'Create an API token inside HoltePortalen → User settings → API tokens.',
    fields: [
      { name: 'apiToken', label: 'HoltePortalen API token', type: 'password', placeholder: 'Bearer token' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  cordel: {
    id: 'cordel',
    brand: 'Cordel',
    hint: 'Create an API token in Cordel Connect security settings and supply your Cordel API base URL.',
    fields: [
      { name: 'baseUrl', label: 'Cordel API base URL', type: 'url', placeholder: 'https://api.cordel.no', defaultValue: 'https://api.cordel.no' },
      { name: 'apiToken', label: 'Cordel Connect API token', type: 'password', placeholder: 'API token' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  svenn: {
    id: 'svenn',
    brand: 'Svenn',
    hint: 'Paste your Svenn API Bearer token to fetch approved project hours and billable work directly.',
    fields: [
      { name: 'apiToken', label: 'Svenn API token', type: 'password', placeholder: 'Bearer token' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  handyman: {
    id: 'handyman',
    brand: 'GSGroup Handyman',
    hint: 'Supply your Handyman Cloud API URL and API key to pull completed field service orders.',
    fields: [
      { name: 'baseUrl', label: 'Handyman API base URL', type: 'url', placeholder: 'https://api.handyman.gsgroup.no', defaultValue: 'https://api.handyman.gsgroup.no' },
      { name: 'apiToken', label: 'Handyman API key', type: 'password', placeholder: 'X-Api-Key' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  minuba: {
    id: 'minuba',
    brand: 'Minuba',
    hint: 'Paste a Minuba REST API Bearer access token to pull completed orders and billable hours.',
    fields: [
      { name: 'apiToken', label: 'Minuba API Bearer token', type: 'password', placeholder: 'Bearer token' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
};

/**
 * Fetches and normalizes trade work-order / hour rows via provider REST APIs.
 * @param {'smartdok' | 'svenn' | 'cordel' | 'holte' | 'handyman' | 'minuba'} slug
 * @param {Record<string, string>} creds
 * @param {FetchLike} [fetchImpl]
 * @returns {Promise<Array<{ ref: string, date: string, customerName: string, description: string, hours: number, amountExVat: number, project: string }>>}
 */
export async function fetchTradeApi(slug, creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!token) throw new HttpError(400, `Enter your ${TRADE_API_UI[slug].brand} API token.`);

  /** @type {any} */
  let payload;
  if (slug === 'smartdok') {
    const auth = await fetchJson(
      'https://api.smartdok.no/Authorize/ApiToken',
      { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ apiToken: token }) },
      'SmartDok',
      fetchImpl,
    );
    const bearer = String(auth.token ?? auth.accessToken ?? auth.sessionToken ?? '').trim();
    if (!bearer) throw new HttpError(400, 'SmartDok /Authorize/ApiToken did not return a session token.');
    payload = await fetchJson(
      `https://api.smartdok.no/WorkHours?fromDate=${encodeURIComponent(from)}&toDate=${encodeURIComponent(to)}`,
      { headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' } },
      'SmartDok',
      fetchImpl,
    );
  } else if (slug === 'holte') {
    payload = await fetchJson(
      `https://api.holte.no/v1/time-entries?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } },
      'EG Holte',
      fetchImpl,
    );
  } else if (slug === 'svenn') {
    payload = await fetchJson(
      `https://api.svenn.com/api/v1/hours?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } },
      'Svenn',
      fetchImpl,
    );
  } else if (slug === 'minuba') {
    payload = await fetchJson(
      `https://api.minuba.dk/v1/orders?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } },
      'Minuba',
      fetchImpl,
    );
  } else if (slug === 'cordel') {
    const base = assertPublicHttpsUrl(creds.baseUrl || 'https://api.cordel.no').origin;
    payload = await fetchJson(
      `${base}/api/v1/orders?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } },
      'Cordel',
      fetchImpl,
    );
  } else {
    const base = assertPublicHttpsUrl(creds.baseUrl || 'https://api.handyman.gsgroup.no').origin;
    payload = await fetchJson(
      `${base}/api/v1/orders?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { headers: { 'x-api-key': token, accept: 'application/json' } },
      'GSGroup Handyman',
      fetchImpl,
    );
  }

  const rows = pickList(payload).map((r, i) => ({
    ref: String(r.orderNumber ?? r.ref ?? r.id ?? `${slug.toUpperCase()}-${i + 1}`),
    date: isoDate(r.date ?? r.workDate ?? r.completedAt ?? r.createdAt, to),
    project: String(r.projectName ?? r.project?.name ?? r.project ?? '—'),
    customerName: String(r.customerName ?? r.customer?.name ?? r.customer ?? '—'),
    hours: Number(num(r.hours ?? r.ordinaryHours ?? r.durationHours ?? (num(r.minutes) / 60)).toFixed(2)),
    amountExVat: Number(num(r.amountExVat ?? r.totalExVat ?? r.netAmount ?? r.amount ?? 0).toFixed(2)),
    description: String(r.description ?? r.comment ?? r.workDescription ?? `${TRADE_API_UI[slug].brand} work order`),
  }));
  const valid = rows.filter((x) => x.hours > 0 || x.amountExVat > 0);
  if (valid.length === 0) throw new HttpError(400, `${TRADE_API_UI[slug].brand} returned 0 billable entries for ${from}–${to}.`);
  return valid;
}

// ---------------------------------------------------------------------------
// 2. HOSPITALITY & HOTEL PMS (mews, favrit, munu, lightspeed, visbook, quickorder)
// ---------------------------------------------------------------------------

/** @type {Partial<Record<'favrit' | 'quickorder' | 'munu' | 'lightspeed' | 'visbook' | 'mews' | 'wolt-foodora', ProviderApiUi>>} */
export const HOSP_API_UI = {
  mews: {
    id: 'mews',
    brand: 'Mews PMS',
    hint: 'Uses the official Mews Connector API (POST /api/connector/v1/accountingItems/getAll) with your ClientToken and AccessToken.',
    fields: [
      { name: 'clientToken', label: 'Mews ClientToken', type: 'password', placeholder: 'ClientToken' },
      { name: 'accessToken', label: 'Mews AccessToken', type: 'password', placeholder: 'AccessToken' },
      { name: 'date', label: 'Settlement date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  favrit: {
    id: 'favrit',
    brand: 'Favrit',
    hint: 'Connect your Favrit Accounting API Bearer token to pull daily 25%/15% sales, tips and fees automatically.',
    fields: [
      { name: 'apiToken', label: 'Favrit API token', type: 'password', placeholder: 'Bearer token' },
      { name: 'date', label: 'Settlement date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  munu: {
    id: 'munu',
    brand: 'Munu',
    hint: 'Paste your Munu Cloud POS API token to fetch daily Z-report revenue, VAT split and tips.',
    fields: [
      { name: 'apiToken', label: 'Munu API token', type: 'password', placeholder: 'Bearer token' },
      { name: 'date', label: 'Settlement date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  lightspeed: {
    id: 'lightspeed',
    brand: 'Lightspeed Restaurant',
    hint: 'Connect Lightspeed K-Series Financial API using your Business Location ID and Bearer token.',
    fields: [
      { name: 'businessId', label: 'Lightspeed Business ID', type: 'text', placeholder: '123456' },
      { name: 'apiToken', label: 'Lightspeed Bearer token', type: 'password', placeholder: 'Bearer token' },
      { name: 'date', label: 'Settlement date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  visbook: {
    id: 'visbook',
    brand: 'VisBook',
    hint: 'Paste your VisBook Web API token to fetch daily 12% room, 15% F&B and 25% bar totals.',
    fields: [
      { name: 'apiToken', label: 'VisBook API token', type: 'password', placeholder: 'Bearer token' },
      { name: 'date', label: 'Settlement date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  quickorder: {
    id: 'quickorder',
    brand: 'Quickorder',
    hint: 'Paste your Quickorder POS API token to fetch the daily Z-report totals directly.',
    fields: [
      { name: 'apiToken', label: 'Quickorder API token', type: 'password', placeholder: 'Bearer token' },
      { name: 'date', label: 'Settlement date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
};

/**
 * Fetches daily hospitality settlement totals via official provider REST API.
 * @param {'favrit' | 'quickorder' | 'munu' | 'lightspeed' | 'visbook' | 'mews'} slug
 * @param {Record<string, string>} creds
 * @param {FetchLike} [fetchImpl]
 * @returns {Promise<{ date: string, ref: string, cashMinor: number, cardMinor: number, vippsMinor: number, feeMinor: number, s25Minor: number, s15Minor: number, s12Minor: number, tipsMinor: number }>}
 */
export async function fetchHospitalityApi(slug, creds, fetchImpl = fetch) {
  const date = isoDate(creds.date);

  if (slug === 'mews') {
    const clientToken = (creds.clientToken ?? '').trim();
    const accessToken = (creds.accessToken ?? '').trim();
    if (!clientToken || !accessToken) throw new HttpError(400, 'Enter both Mews ClientToken and AccessToken.');
    const data = await fetchJson(
      'https://api.mews.com/api/connector/v1/accountingItems/getAll',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          ClientToken: clientToken,
          AccessToken: accessToken,
          Client: 'ReAI Apps 1.0',
          StartUtc: `${date}T00:00:00Z`,
          EndUtc: `${date}T23:59:59Z`,
        }),
      },
      'Mews PMS',
      fetchImpl,
    );
    const items = Array.isArray(data.AccountingItems) ? data.AccountingItems : [];
    let cashMinor = 0;
    let cardMinor = 0;
    let feeMinor = 0;
    let s25Minor = 0;
    let s15Minor = 0;
    let s12Minor = 0;
    for (const it of items) {
      const grossMinor = Math.round(Math.abs(num(it.Amount?.GrossValue ?? it.Amount?.Value ?? 0)) * 100);
      const type = String(it.Type ?? '').toLowerCase();
      if (type === 'payment') {
        const sub = String(it.SubType ?? '').toLowerCase();
        if (sub.includes('cash')) cashMinor += grossMinor;
        else cardMinor += grossMinor;
      } else if (type === 'fee') {
        feeMinor += grossMinor;
      } else {
        const taxRate = num(it.Amount?.TaxValues?.[0]?.Rate ?? it.TaxRate ?? 0);
        const pct = taxRate > 0 && taxRate <= 1 ? Math.round(taxRate * 100) : Math.round(taxRate);
        if (pct === 12) s12Minor += grossMinor;
        else if (pct === 15) s15Minor += grossMinor;
        else s25Minor += grossMinor;
      }
    }
    return { date, ref: `MEWS-${date}`, cashMinor, cardMinor, vippsMinor: 0, feeMinor, s25Minor, s15Minor, s12Minor, tipsMinor: 0 };
  }

  const token = (creds.apiToken ?? '').trim();
  if (!token) throw new HttpError(400, `Enter your ${HOSP_API_UI[slug]?.brand ?? slug} API token.`);
  const urlMap = {
    favrit: `https://api.favrit.com/accounting/v1/settlements?from=${date}&to=${date}`,
    munu: `https://api.munu.cloud/api/v1/sales/summary?date=${date}`,
    lightspeed: `https://api.lsk.lightspeed.app/f/v2/business/${encodeURIComponent((creds.businessId ?? '').trim() || 'default')}/accounting?from=${date}&to=${date}`,
    visbook: `https://api.visbook.com/api/v1/accounting/daily?date=${date}`,
    quickorder: `https://api.quickorder.io/api/v1/reports/z-report?date=${date}`,
  };
  const data = await fetchJson(urlMap[slug], { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, HOSP_API_UI[slug]?.brand ?? slug, fetchImpl);
  const s = Array.isArray(data) ? (data[0] ?? {}) : (data.summary ?? data.report ?? data);
  const toMinor = (/** @type {unknown} */ v) => Math.round(Math.max(0, num(v)) * 100);
  return {
    date,
    ref: String(s.reference ?? s.zReportNumber ?? `${slug.toUpperCase()}-${date}`),
    cashMinor: toMinor(s.cash ?? s.cashTotal),
    cardMinor: toMinor(s.card ?? s.cardTotal ?? s.netPayout),
    vippsMinor: toMinor(s.vipps ?? s.vippsTotal),
    feeMinor: toMinor(s.fee ?? s.fees ?? s.commission),
    s25Minor: toMinor(s.sales25 ?? s.gross25 ?? s.vat25Gross),
    s15Minor: toMinor(s.sales15 ?? s.gross15 ?? s.vat15Gross),
    s12Minor: toMinor(s.sales12 ?? s.gross12 ?? s.vat12Gross),
    tipsMinor: toMinor(s.tips ?? s.tipsTotal),
  };
}

// ---------------------------------------------------------------------------
// 3. RETAIL POS (extendago, pckasse, susoft)
// ---------------------------------------------------------------------------

/** @type {Record<'pckasse' | 'extendago' | 'susoft', ProviderApiUi>} */
export const RETAIL_API_UI = {
  extendago: {
    id: 'extendago',
    brand: 'ExtendaGO',
    hint: 'Paste your ExtendaGO Backoffice REST API Bearer token to fetch the daily Z-report journal lines.',
    fields: [
      { name: 'apiToken', label: 'ExtendaGO API token', type: 'password', placeholder: 'Bearer token' },
      { name: 'date', label: 'Z-report date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  pckasse: {
    id: 'pckasse',
    brand: 'PCKasse',
    hint: 'Paste your PCKasse Web API key (from PCKasse sky/web-register) to fetch the daily accounting journal.',
    fields: [
      { name: 'apiToken', label: 'PCKasse API key', type: 'password', placeholder: 'X-Api-Key' },
      { name: 'date', label: 'Z-report date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  susoft: {
    id: 'susoft',
    brand: 'Susoft',
    hint: 'Paste your Susoft POS API Bearer token to pull daily Z-report postings.',
    fields: [
      { name: 'apiToken', label: 'Susoft API token', type: 'password', placeholder: 'Bearer token' },
      { name: 'date', label: 'Z-report date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
};

/**
 * Fetches retail POS Z-report journal postings via REST API.
 * @param {'pckasse' | 'extendago' | 'susoft'} slug
 * @param {Record<string, string>} creds
 * @param {FetchLike} [fetchImpl]
 * @returns {Promise<Array<{ date: string, account: string, description: string, signedMinor: number }>>}
 */
export async function fetchRetailPosApi(slug, creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const date = isoDate(creds.date);
  if (!token) throw new HttpError(400, `Enter your ${RETAIL_API_UI[slug].brand} API credential.`);
  const url =
    slug === 'extendago'
      ? `https://api.extendago.com/v1/accounting/z-reports?date=${date}`
      : slug === 'pckasse'
        ? `https://api.pckasse.no/v1/accounting/journal?date=${date}`
        : `https://api.susoft.com/api/v1/zreports?date=${date}`;
  const headers = slug === 'pckasse' ? { 'x-api-key': token, accept: 'application/json' } : { authorization: `Bearer ${token}`, accept: 'application/json' };
  const data = await fetchJson(url, { headers }, RETAIL_API_UI[slug].brand, fetchImpl);
  const raw = pickList(data, ['lines', 'postings', 'entries', 'items', 'data']);
  const lines = raw
    .map((l) => {
      const signed = l.debit !== undefined || l.credit !== undefined ? num(l.debit) - num(l.credit) : num(l.amount ?? l.signedAmount);
      return {
        date: isoDate(l.date ?? l.postingDate, date),
        account: String(l.account ?? l.accountNumber ?? '').trim(),
        description: String(l.description ?? l.text ?? `${RETAIL_API_UI[slug].brand} Z-report`),
        signedMinor: Math.round(signed * 100),
      };
    })
    .filter((l) => /^[0-9]{4}$/.test(l.account) && l.signedMinor !== 0);
  if (lines.length === 0) throw new HttpError(400, `${RETAIL_API_UI[slug].brand} API returned 0 valid 4-digit account postings for ${date}.`);
  return lines;
}

// ---------------------------------------------------------------------------
// 4. TRANSPORT & FLEET (abax, opter, logistra)
// ---------------------------------------------------------------------------

/** @type {Partial<Record<'abax' | 'opter' | 'autonet' | 'logistra', ProviderApiUi>>} */
export const TRANSPORT_API_UI = {
  abax: {
    id: 'abax',
    brand: 'ABAX Triplog',
    hint: 'Connect ABAX Open Platform API (GET https://api.abax.cloud/v1/trips) to pull business trips & tolls directly into ReAI Driving Log.',
    fields: [
      { name: 'apiToken', label: 'ABAX Open API Bearer token', type: 'password', placeholder: 'Bearer token' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  opter: {
    id: 'opter',
    brand: 'Opter TMS',
    hint: 'Connect your Opter Cloud REST API URL and Bearer token to import completed transport orders.',
    fields: [
      { name: 'baseUrl', label: 'Opter API base URL', type: 'url', placeholder: 'https://yourcompany.opter.cloud' },
      { name: 'apiToken', label: 'Opter API token', type: 'password', placeholder: 'Bearer token' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  logistra: {
    id: 'logistra',
    brand: 'Logistra Cargonizer',
    hint: 'Connect official Logistra Cargonizer API with your X-Cargonizer-Key and Sender ID.',
    fields: [
      { name: 'apiToken', label: 'X-Cargonizer-Key', type: 'password', placeholder: 'Cargonizer API key' },
      { name: 'senderId', label: 'X-Cargonizer-Sender ID', type: 'text', placeholder: 'Sender ID' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
};

/**
 * Fetches business trips from the official ABAX Triplog Open API (filters out private trips, converts meters -> km).
 * @param {Record<string, string>} creds
 * @param {FetchLike} [fetchImpl]
 * @returns {Promise<Array<{ date: string, from: string, to: string, purpose: string, km: number, toll: number }>>}
 */
export async function fetchAbaxTripsApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!token) throw new HttpError(400, 'Enter your ABAX Open API Bearer token.');
  const url = `https://api.abax.cloud/v1/trips?from=${encodeURIComponent(`${from}T00:00:00Z`)}&to=${encodeURIComponent(`${to}T23:59:59Z`)}`;
  const data = await fetchJson(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, 'ABAX', fetchImpl);
  const trips = pickList(data, ['items', 'trips', 'data'])
    .filter((t) => String(t.trip_type ?? t.tripType ?? 'business').toLowerCase() !== 'private')
    .map((t) => {
      const kmVal = t.distance_km !== undefined ? num(t.distance_km) : num(t.distance) / 1000;
      return {
        date: isoDate(t.start_time ?? t.startTime ?? t.date, from),
        from: String(t.start_location?.address ?? t.startLocation ?? 'Start'),
        to: String(t.stop_location?.address ?? t.stopLocation ?? 'Destination'),
        purpose: String(t.trip_purpose ?? t.purpose ?? 'Business trip (ABAX)'),
        km: Number(kmVal.toFixed(1)),
        toll: Number(num(t.toll_cost ?? t.tollCost ?? 0).toFixed(2)),
      };
    })
    .filter((t) => t.km >= 0.1);
  if (trips.length === 0) throw new HttpError(400, `ABAX returned 0 business trips for ${from}–${to}.`);
  return trips;
}

/**
 * Fetches freight/shipping orders from Opter TMS or Logistra Cargonizer.
 * @param {'opter' | 'logistra'} slug
 * @param {Record<string, string>} creds
 * @param {FetchLike} [fetchImpl]
 * @returns {Promise<Array<{ ref: string, date: string, customerName: string, description: string, amountExVat: number }>>}
 */
export async function fetchTransportOrdersApi(slug, creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!token) throw new HttpError(400, `Enter your ${TRANSPORT_API_UI[slug]?.brand ?? slug} API key.`);
  /** @type {any} */
  let data;
  if (slug === 'opter') {
    const base = assertPublicHttpsUrl(creds.baseUrl || '').origin;
    data = await fetchJson(
      `${base}/api/v1/orders?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } },
      'Opter TMS',
      fetchImpl,
    );
  } else {
    const senderId = (creds.senderId ?? '').trim();
    if (!senderId) throw new HttpError(400, 'Enter your X-Cargonizer-Sender ID.');
    data = await fetchJson(
      `https://cargonizer.no/consignments.json?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { headers: { 'x-cargonizer-key': token, 'x-cargonizer-sender': senderId, accept: 'application/json' } },
      'Logistra Cargonizer',
      fetchImpl,
    );
  }
  const orders = pickList(data)
    .map((o, i) => ({
      ref: String(o.orderNumber ?? o.number ?? o.id ?? `${slug.toUpperCase()}-${i + 1}`),
      date: isoDate(o.date ?? o.createdAt ?? o.deliveryDate, to),
      customerName: String(o.customerName ?? o.consignee?.name ?? o.customer?.name ?? '—'),
      description: String(o.description ?? o.serviceName ?? o.product ?? 'Freight order'),
      amountExVat: Number(num(o.amountExVat ?? o.price ?? o.netAmount ?? o.freightCost ?? 0).toFixed(2)),
    }))
    .filter((o) => o.amountExVat > 0);
  if (orders.length === 0) throw new HttpError(400, `${TRANSPORT_API_UI[slug]?.brand ?? slug} returned 0 priced orders for ${from}–${to}.`);
  return orders;
}

// ---------------------------------------------------------------------------
// 5. CORPORATE CARDS (pleo, revolut/wise)
// ---------------------------------------------------------------------------

/** @type {Record<'pleo' | 'revolut', ProviderApiUi>} */
export const CARD_API_UI = {
  pleo: {
    id: 'pleo',
    brand: 'Pleo',
    hint: 'Create an API key in Pleo Settings → Open API to pull approved card expenses via GET https://external.pleo.io/v1/expenses.',
    fields: [
      { name: 'apiToken', label: 'Pleo Open API key', type: 'password', placeholder: 'Pleo Bearer token' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
      { name: 'clearingAccount', label: 'Clearing account (4 digits)', type: 'text', defaultValue: '2380' },
    ],
  },
  revolut: {
    id: 'revolut',
    brand: 'Revolut Business / Wise',
    hint: 'Connect Revolut Business API (GET /api/1.0/transactions) or Wise Personal/Business API token.',
    fields: [
      { name: 'provider', label: 'Provider (revolut or wise)', type: 'text', defaultValue: 'revolut', placeholder: 'revolut or wise' },
      { name: 'apiToken', label: 'API Bearer token', type: 'password', placeholder: 'Bearer token' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
      { name: 'clearingAccount', label: 'Clearing account (4 digits)', type: 'text', defaultValue: '1925' },
    ],
  },
};

/**
 * Fetches corporate card expenses from Pleo, Revolut Business, or Wise.
 * @param {'pleo' | 'revolut'} slug
 * @param {Record<string, string>} creds
 * @param {FetchLike} [fetchImpl]
 * @returns {Promise<Array<{ date: string, merchant: string, account: string, amountMinor: number, vatCode: string }>>}
 */
export async function fetchCardsApi(slug, creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!token) throw new HttpError(400, `Enter your ${CARD_API_UI[slug].brand} API token.`);

  /** @type {Array<{ date: string, merchant: string, account: string, amountMinor: number, vatCode: string }>} */
  const out = [];
  if (slug === 'pleo') {
    const data = await fetchJson(
      `https://external.pleo.io/v1/expenses?dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(to)}`,
      { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } },
      'Pleo',
      fetchImpl,
    );
    for (const e of pickList(data)) {
      const amount = Math.abs(num(e.amountSettled?.value ?? e.amountOriginal?.value ?? e.amount ?? 0));
      const amountMinor = Math.round(amount * 100);
      if (amountMinor <= 0) continue;
      const acct = String(e.account?.code ?? e.accountNumber ?? '6800').trim();
      out.push({
        date: isoDate(e.performedAt ?? e.date, to),
        merchant: String(e.merchant?.name ?? e.note ?? 'Pleo card expense'),
        account: /^[0-9]{4}$/.test(acct) ? acct : '6800',
        amountMinor,
        vatCode: '0',
      });
    }
  } else if ((creds.provider ?? '').toLowerCase().includes('wise')) {
    const profiles = await fetchJson('https://api.wise.com/v1/profiles', { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, 'Wise', fetchImpl);
    const profId = pickList(profiles)[0]?.id;
    if (!profId) throw new HttpError(400, 'Wise API returned no accessible profiles.');
    const transfers = await fetchJson(
      `https://api.wise.com/v1/transfers?profile=${encodeURIComponent(String(profId))}&createdDateStart=${encodeURIComponent(`${from}T00:00:00Z`)}&createdDateEnd=${encodeURIComponent(`${to}T23:59:59Z`)}`,
      { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } },
      'Wise',
      fetchImpl,
    );
    for (const t of pickList(transfers)) {
      const amountMinor = Math.round(Math.abs(num(t.sourceValue ?? t.targetValue ?? 0)) * 100);
      if (amountMinor <= 0) continue;
      out.push({
        date: isoDate(t.created, to),
        merchant: String(t.details?.reference ?? `Wise transfer #${t.id ?? ''}`).trim(),
        account: '6800',
        amountMinor,
        vatCode: '0',
      });
    }
  } else {
    const txs = await fetchJson(
      `https://b2b.revolut.com/api/1.0/transactions?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } },
      'Revolut Business',
      fetchImpl,
    );
    for (const tx of pickList(txs)) {
      const leg = Array.isArray(tx.legs) ? tx.legs[0] : tx;
      const amt = num(leg?.amount ?? tx.amount ?? 0);
      if (amt >= 0) continue; // expenses are negative outflows
      out.push({
        date: isoDate(tx.completed_at ?? tx.created_at, to),
        merchant: String(tx.merchant?.name ?? leg?.description ?? tx.reference ?? 'Revolut card spend'),
        account: '6800',
        amountMinor: Math.round(Math.abs(amt) * 100),
        vatCode: '0',
      });
      const feeMinor = Math.round(Math.abs(num(leg?.fee ?? tx.fee ?? 0)) * 100);
      if (feeMinor > 0) {
        out.push({ date: isoDate(tx.completed_at ?? tx.created_at, to), merchant: 'Revolut FX / card fee', account: '7770', amountMinor: feeMinor, vatCode: '0' });
      }
    }
  }
  if (out.length === 0) throw new HttpError(400, `${CARD_API_UI[slug].brand} returned 0 expenses for ${from}–${to}.`);
  return out;
}

// ---------------------------------------------------------------------------
// 6. EVENTS, SAAS MoR & B2B BNPL (ticketco, checkin, hoopla, paddle, two)
// ---------------------------------------------------------------------------

/** @type {Record<'ticketco' | 'checkin' | 'hoopla' | 'paddle' | 'two', ProviderApiUi>} */
export const SETTLEMENT_API_UI = {
  ticketco: {
    id: 'ticketco',
    brand: 'TicketCo',
    hint: 'Uses the TicketCo Public API with your organizer API token to pull event sales & fees.',
    fields: [
      { name: 'apiToken', label: 'TicketCo API token', type: 'password', placeholder: 'Organizer API token' },
      { name: 'date', label: 'Settlement date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  checkin: {
    id: 'checkin',
    brand: 'Checkin',
    hint: 'Paste your Checkin.no API Bearer token to pull course & conference settlement totals.',
    fields: [
      { name: 'apiToken', label: 'Checkin API token', type: 'password', placeholder: 'Bearer token' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  hoopla: {
    id: 'hoopla',
    brand: 'Hoopla',
    hint: 'Paste your Hoopla organizer API token to pull ticket orders and fees.',
    fields: [
      { name: 'apiToken', label: 'Hoopla API token', type: 'password', placeholder: 'Bearer token' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  paddle: {
    id: 'paddle',
    brand: 'Paddle',
    hint: 'Create a read-only API key in Paddle Developer Tools (GET https://api.paddle.com/transactions?status=completed).',
    fields: [
      { name: 'apiToken', label: 'Paddle API key', type: 'password', placeholder: 'pdl_live_apikey_...' },
      { name: 'date', label: 'Settlement date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  two: {
    id: 'two',
    brand: 'Two (B2B BNPL)',
    hint: 'Paste your Two Merchant X-API-Key (GET https://api.two.inc/v1/order) to pull settled B2B BNPL orders & fees.',
    fields: [
      { name: 'apiToken', label: 'Two X-API-Key', type: 'password', placeholder: 'X-API-Key' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
};

/**
 * Fetches settlement summary from TicketCo, Checkin, Hoopla, or Paddle.
 * @param {'ticketco' | 'checkin' | 'hoopla' | 'paddle'} slug
 * @param {Record<string, string>} creds
 * @param {FetchLike} [fetchImpl]
 * @returns {Promise<{ date: string, ref: string, exemptMinor: number, taxable25Minor: number, feeMinor: number }>}
 */
export async function fetchPayoutSettlementApi(slug, creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const date = isoDate(creds.date ?? creds.toDate);
  const from = isoDate(creds.fromDate, date);
  if (!token) throw new HttpError(400, `Enter your ${SETTLEMENT_API_UI[slug].brand} API key.`);

  let exemptMinor = 0;
  let taxable25Minor = 0;
  let feeMinor = 0;

  if (slug === 'paddle') {
    const data = await fetchJson(
      'https://api.paddle.com/transactions?status=completed&per_page=50',
      { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } },
      'Paddle',
      fetchImpl,
    );
    for (const tx of pickList(data)) {
      const totals = tx.details?.payout_totals ?? tx.details?.totals ?? {};
      const grand = Math.abs(Math.round(num(totals.total ?? totals.grand_total ?? 0)));
      const fee = Math.abs(Math.round(num(totals.fee ?? 0)));
      exemptMinor += grand;
      feeMinor += fee;
    }
    return { date, ref: `PADDLE-${date}`, exemptMinor, taxable25Minor: 0, feeMinor };
  }

  const url =
    slug === 'ticketco'
      ? `https://ticketco.events/api/public/v1/transactions?token=${encodeURIComponent(token)}`
      : slug === 'checkin'
        ? `https://app.checkin.no/api/v1/settlements?from=${encodeURIComponent(from)}&to=${encodeURIComponent(date)}`
        : `https://app.hoopla.no/api/v1/orders?from=${encodeURIComponent(from)}&to=${encodeURIComponent(date)}`;
  const headers = slug === 'ticketco' ? { accept: 'application/json' } : { authorization: `Bearer ${token}`, accept: 'application/json' };
  const data = await fetchJson(url, { headers }, SETTLEMENT_API_UI[slug].brand, fetchImpl);
  for (const row of pickList(data)) {
    const vatRate = num(row.vatRate ?? row.taxRate ?? 0);
    const grossMinor = Math.round(Math.abs(num(row.grossAmount ?? row.amount ?? row.total ?? 0)) * 100);
    const fee = Math.round(Math.abs(num(row.fee ?? row.commission ?? 0)) * 100);
    if (vatRate >= 20) taxable25Minor += grossMinor;
    else exemptMinor += grossMinor;
    feeMinor += fee;
  }
  return { date, ref: `${slug.toUpperCase()}-${date}`, exemptMinor, taxable25Minor, feeMinor };
}

/**
 * Fetches settled B2B BNPL totals from Two (https://api.two.inc/v1/order).
 * @param {Record<string, string>} creds
 * @param {FetchLike} [fetchImpl]
 * @returns {Promise<{ date: string, ref: string, principalMinor: number, interestMinor: number, feeMinor: number }>}
 */
export async function fetchTwoApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!token) throw new HttpError(400, 'Enter your Two X-API-Key.');
  const data = await fetchJson(
    `https://api.two.inc/v1/order?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { headers: { 'x-api-key': token, accept: 'application/json' } },
    'Two',
    fetchImpl,
  );
  let principalMinor = 0;
  let feeMinor = 0;
  for (const o of pickList(data)) {
    principalMinor += Math.round(Math.abs(num(o.gross_amount ?? o.grossAmount ?? o.amount ?? 0)) * 100);
    feeMinor += Math.round(Math.abs(num(o.merchant_fee ?? o.fee ?? 0)) * 100);
  }
  return { date: to, ref: `TWO-${to}`, principalMinor, interestMinor: 0, feeMinor };
}

// ---------------------------------------------------------------------------
// 7. HR, TRAVEL, WFM & TIMETRACKING (simployer, acubiz, quinyx, severa, planday, tamigo, huma, busy, milient, tidsbanken)
// ---------------------------------------------------------------------------

/** @type {Record<'simployer' | 'acubiz' | 'quinyx' | 'severa' | 'planday' | 'tamigo' | 'huma' | 'busy' | 'milient' | 'tidsbanken', ProviderApiUi>} */
export const WFM_HR_API_UI = {
  simployer: {
    id: 'simployer',
    brand: 'Simployer',
    hint: 'Connect your Simployer API Bearer token to pull approved travel claims & employee expenses.',
    fields: [
      { name: 'apiToken', label: 'Simployer API token', type: 'password', placeholder: 'Bearer token' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
      { name: 'clearingAccount', label: 'Employee clearing account', type: 'text', defaultValue: '2915' },
    ],
  },
  acubiz: {
    id: 'acubiz',
    brand: 'Acubiz',
    hint: 'Connect your Acubiz REST API token to pull approved expense transactions.',
    fields: [
      { name: 'apiToken', label: 'Acubiz API token', type: 'password', placeholder: 'Bearer token' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
      { name: 'clearingAccount', label: 'Clearing account', type: 'text', defaultValue: '2915' },
    ],
  },
  quinyx: {
    id: 'quinyx',
    brand: 'Quinyx',
    hint: 'Connect Quinyx REST v2 API with your Bearer token to pull approved shift hours.',
    fields: [
      { name: 'apiToken', label: 'Quinyx API token', type: 'password', placeholder: 'Bearer token' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  severa: {
    id: 'severa',
    brand: 'Visma Severa',
    hint: 'Connect Visma Severa Public REST API v1.0 (GET /workhours) with your Bearer token.',
    fields: [
      { name: 'apiToken', label: 'Severa REST API Bearer token', type: 'password', placeholder: 'Bearer token' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  planday: {
    id: 'planday',
    brand: 'Planday',
    hint: 'Connect official Planday Open API (X-ClientId + Bearer access token) to pull approved shifts.',
    fields: [
      { name: 'clientId', label: 'Planday X-ClientId', type: 'text', placeholder: 'App Client ID' },
      { name: 'apiToken', label: 'Planday Bearer token', type: 'password', placeholder: 'Bearer token' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  tamigo: {
    id: 'tamigo',
    brand: 'Tamigo',
    hint: 'Connect Tamigo API with your SessionToken / Bearer token to fetch approved shifts.',
    fields: [
      { name: 'apiToken', label: 'Tamigo API / Session token', type: 'password', placeholder: 'SessionToken' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  huma: {
    id: 'huma',
    brand: 'Huma HR',
    hint: 'Connect Huma HR API (GET https://api.hu.ma/v1/users) with your Bearer token to sync employees to ReAI.',
    fields: [{ name: 'apiToken', label: 'Huma HR API Bearer token', type: 'password', placeholder: 'Bearer token' }],
  },
  busy: {
    id: 'busy',
    brand: 'Busy',
    hint: 'Connect Busy REST API with your Bearer token to fetch approved project time entries.',
    fields: [
      { name: 'apiToken', label: 'Busy API Bearer token', type: 'password', placeholder: 'Bearer token' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  milient: {
    id: 'milient',
    brand: 'Milient',
    hint: 'Connect Milient (Moment) REST API with your Bearer token to pull billable project hours.',
    fields: [
      { name: 'apiToken', label: 'Milient API token', type: 'password', placeholder: 'Bearer token' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  tidsbanken: {
    id: 'tidsbanken',
    brand: 'Tidsbanken',
    hint: 'Connect official Tidsbanken API v3 (developer.tidsbanken.net) using your Subscription-Key and tidsbanken-key.',
    fields: [
      { name: 'subscriptionKey', label: 'Subscription-Key', type: 'password', placeholder: 'Ocp-Apim-Subscription-Key' },
      { name: 'apiToken', label: 'tidsbanken-key', type: 'password', placeholder: 'Company tidsbanken-key' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
};

/**
 * Fetches expense rows from Simployer or Acubiz.
 * @param {'simployer' | 'acubiz'} slug
 * @param {Record<string, string>} creds
 * @param {FetchLike} [fetchImpl]
 * @returns {Promise<Array<{ date: string, description: string, account: string, amountMinor: number }>>}
 */
export async function fetchHrExpensesApi(slug, creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!token) throw new HttpError(400, `Enter your ${WFM_HR_API_UI[slug].brand} API token.`);
  const url =
    slug === 'simployer'
      ? `https://api.simployer.com/v1/expenses?from=${from}&to=${to}`
      : `https://api.acubiz.com/v1/transactions?from=${from}&to=${to}`;
  const data = await fetchJson(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, WFM_HR_API_UI[slug].brand, fetchImpl);
  const rows = pickList(data)
    .map((e) => {
      const acct = String(e.accountNumber ?? e.account ?? '7140').trim();
      return {
        date: isoDate(e.date ?? e.expenseDate ?? e.transactionDate, to),
        description: String(e.description ?? e.merchant ?? `${WFM_HR_API_UI[slug].brand} expense`),
        account: /^[0-9]{4}$/.test(acct) ? acct : '7140',
        amountMinor: Math.round(Math.abs(num(e.amount ?? e.totalAmount ?? 0)) * 100),
      };
    })
    .filter((x) => x.amountMinor > 0);
  if (rows.length === 0) throw new HttpError(400, `${WFM_HR_API_UI[slug].brand} returned 0 expenses for ${from}–${to}.`);
  return rows;
}

/**
 * Fetches shift/project hours from Quinyx, Severa, Planday, Tamigo, Busy, Milient, or Tidsbanken.
 * @param {'quinyx' | 'severa' | 'planday' | 'tamigo' | 'busy' | 'milient' | 'tidsbanken'} slug
 * @param {Record<string, string>} creds
 * @param {FetchLike} [fetchImpl]
 * @returns {Promise<Array<{ date: string, hours: number, project: string, comment: string }>>}
 */
export async function fetchWfmHoursApi(slug, creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const from = isoDate(creds.fromDate);
  const to = isoDate(creds.toDate);
  if (!token) throw new HttpError(400, `Enter your ${WFM_HR_API_UI[slug].brand} API token.`);

  /** @type {Record<string, string>} */
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  let url = '';
  if (slug === 'quinyx') url = `https://api.quinyx.com/v2/shifts?from=${from}&to=${to}`;
  else if (slug === 'severa') url = `https://api.severa.visma.com/rest-api/v1.0/workhours?startDate=${from}&endDate=${to}`;
  else if (slug === 'planday') {
    const cid = (creds.clientId ?? '').trim();
    if (!cid) throw new HttpError(400, 'Enter your Planday X-ClientId.');
    headers['x-clientid'] = cid;
    url = `https://openapi.planday.com/scheduling/v1/shifts?from=${from}&to=${to}`;
  } else if (slug === 'tamigo') {
    headers.sessiontoken = token;
    url = `https://api.tamigo.com/v1/shifts?from=${from}&to=${to}`;
  } else if (slug === 'busy') url = `https://api.busy.no/v1/entries?from=${from}&to=${to}`;
  else if (slug === 'milient') url = `https://api.milientsoftware.com/v1/timeentries?from=${from}&to=${to}`;
  else {
    const subKey = (creds.subscriptionKey ?? '').trim();
    if (!subKey) throw new HttpError(400, 'Enter your Tidsbanken Subscription-Key.');
    delete headers.authorization;
    headers['subscription-key'] = subKey;
    headers['tidsbanken-key'] = token;
    url = `https://api.tidsbanken.net/api/v3/timelinje?fom=${from}&tom=${to}`;
  }

  const data = await fetchJson(url, { headers }, WFM_HR_API_UI[slug].brand, fetchImpl);
  const rows = pickList(data)
    .map((r) => {
      const hours = num(r.hours ?? r.quantity ?? r.timer ?? r.durationHours ?? (num(r.minutes) / 60));
      return {
        date: isoDate(r.date ?? r.eventDate ?? r.dato ?? r.startDateTime, to),
        hours: Number(hours.toFixed(2)),
        project: String(r.projectName ?? r.project?.name ?? r.departmentName ?? r.prosjekt ?? '—'),
        comment: String(r.comment ?? r.description ?? r.kommentar ?? `${WFM_HR_API_UI[slug].brand} shift`),
      };
    })
    .filter((x) => x.hours >= 0.01 && x.hours <= 24);
  if (rows.length === 0) throw new HttpError(400, `${WFM_HR_API_UI[slug].brand} returned 0 hour entries for ${from}–${to}.`);
  return rows;
}

/**
 * Fetches employee list from Huma HR API (GET https://api.hu.ma/v1/users).
 * @param {Record<string, string>} creds
 * @param {FetchLike} [fetchImpl]
 * @returns {Promise<Array<{ name: string, email: string, startDate: string, bank: string, percent: number }>>}
 */
export async function fetchHumaEmployeesApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  if (!token) throw new HttpError(400, 'Enter your Huma HR API Bearer token.');
  const data = await fetchJson('https://api.hu.ma/v1/users', { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, 'Huma HR', fetchImpl);
  const rows = pickList(data)
    .map((u) => ({
      name: String(u.fullName ?? [u.firstName, u.lastName].filter(Boolean).join(' ') ?? u.name ?? '').trim(),
      email: String(u.email ?? '').trim(),
      startDate: isoDate(u.employmentStartDate ?? u.startDate),
      percent: Math.min(100, Math.max(1, num(u.employmentPercentage ?? u.percent ?? 100) || 100)),
      bank: verifiedNorwegianAccount(String(u.bankAccountNumber ?? u.bankAccount ?? '')),
    }))
    .filter((e) => e.name.length > 0);
  if (rows.length === 0) throw new HttpError(400, 'Huma HR returned 0 employees.');
  return rows;
}

// ---------------------------------------------------------------------------
// 8. SALONS & CLINICS (easypractice, hano, fixit)
// ---------------------------------------------------------------------------

/** @type {Partial<Record<'fixit' | 'hano' | 'pasientsky' | 'membro' | 'easypractice', ProviderApiUi>>} */
export const WELLNESS_API_UI = {
  easypractice: {
    id: 'easypractice',
    brand: 'EasyPractice',
    hint: 'Enable the API app in EasyPractice Apps and paste your Personal Access Token (GET /api/v1/invoices).',
    fields: [
      { name: 'apiToken', label: 'EasyPractice Personal Access Token', type: 'password', placeholder: 'Bearer token' },
      { name: 'fromDate', label: 'From date', type: 'date', defaultValue: '$MONTH_START' },
      { name: 'toDate', label: 'To date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  hano: {
    id: 'hano',
    brand: 'EG Hano',
    hint: 'Paste your Hano REST API Bearer token to pull daily salon/clinic settlement totals.',
    fields: [
      { name: 'apiToken', label: 'Hano API token', type: 'password', placeholder: 'Bearer token' },
      { name: 'date', label: 'Settlement date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
  fixit: {
    id: 'fixit',
    brand: 'Fixit',
    hint: 'Paste your Fixit salon API Bearer token to pull daily Z-report card, cash and 25% totals.',
    fields: [
      { name: 'apiToken', label: 'Fixit API token', type: 'password', placeholder: 'Bearer token' },
      { name: 'date', label: 'Settlement date', type: 'date', defaultValue: '$TODAY' },
    ],
  },
};

/**
 * Fetches salon/clinic settlement totals from EasyPractice, Hano, or Fixit.
 * @param {'easypractice' | 'hano' | 'fixit'} slug
 * @param {Record<string, string>} creds
 * @param {FetchLike} [fetchImpl]
 * @returns {Promise<{ date: string, ref: string, cardMinor: number, cashMinor: number, claimMinor: number, feeMinor: number, exemptMinor: number, taxable25Minor: number }>}
 */
export async function fetchWellnessApi(slug, creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  const date = isoDate(creds.date ?? creds.toDate);
  const from = isoDate(creds.fromDate, date);
  if (!token) throw new HttpError(400, `Enter your ${WELLNESS_API_UI[slug]?.brand ?? slug} API token.`);

  if (slug === 'easypractice') {
    const data = await fetchJson(
      `https://system.easypractice.net/api/v1/invoices?from=${from}&to=${date}`,
      { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } },
      'EasyPractice',
      fetchImpl,
    );
    let cardMinor = 0;
    let claimMinor = 0;
    let exemptMinor = 0;
    let taxable25Minor = 0;
    for (const inv of pickList(data)) {
      const grossMinor = Math.round(Math.abs(num(inv.total ?? inv.amount ?? 0)) * 100);
      const vat = num(inv.vat ?? inv.tax ?? 0);
      if (vat > 0) taxable25Minor += grossMinor;
      else exemptMinor += grossMinor;
      if (String(inv.status ?? '').toLowerCase() === 'paid') cardMinor += grossMinor;
      else claimMinor += grossMinor;
    }
    return { date, ref: `EP-${date}`, cardMinor, cashMinor: 0, claimMinor, feeMinor: 0, exemptMinor, taxable25Minor };
  }

  const url = slug === 'hano' ? `https://api.hano.no/v1/settlements?date=${date}` : `https://api.fixit.no/v1/reports/daily?date=${date}`;
  const data = await fetchJson(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, WELLNESS_API_UI[slug]?.brand ?? slug, fetchImpl);
  const s = Array.isArray(data) ? (data[0] ?? {}) : (data.summary ?? data);
  const m = (/** @type {unknown} */ v) => Math.round(Math.max(0, num(v)) * 100);
  return {
    date,
    ref: String(s.reference ?? `${slug.toUpperCase()}-${date}`),
    cardMinor: m(s.card ?? s.cardTotal),
    cashMinor: m(s.cash ?? s.cashTotal),
    claimMinor: m(s.claim ?? s.invoiced),
    feeMinor: m(s.fee ?? s.fees),
    exemptMinor: m(s.exempt ?? s.exemptSales),
    taxable25Minor: m(s.taxable25 ?? s.gross25),
  };
}

// ---------------------------------------------------------------------------
// 9. ACCOUNTING SWITCHERS (poweroffice-migrate, 24sevenoffice-migrate)
// ---------------------------------------------------------------------------

/** @type {Partial<Record<'poweroffice-migrate' | '24sevenoffice-migrate', ProviderApiUi>>} */
export const SWITCHER_EXTRA_API_UI = {
  'poweroffice-migrate': {
    id: 'poweroffice-migrate',
    brand: 'PowerOffice Go',
    hint: 'Connect PowerOffice Go v2 API (Ocp-Apim-Subscription-Key + Bearer token) to migrate customers, suppliers & products directly.',
    fields: [
      { name: 'subscriptionKey', label: 'Ocp-Apim-Subscription-Key', type: 'password', placeholder: 'Subscription Key' },
      { name: 'apiToken', label: 'PowerOffice Go Bearer token', type: 'password', placeholder: 'Bearer access token' },
    ],
  },
  '24sevenoffice-migrate': {
    id: '24sevenoffice-migrate',
    brand: '24SevenOffice',
    hint: 'Connect 24SevenOffice REST API v1 (Bearer token) to pull customers and products directly into ReAI.',
    fields: [{ name: 'apiToken', label: '24SevenOffice API Bearer token', type: 'password', placeholder: 'Bearer access token' }],
  },
};

/**
 * Fetches customers, suppliers, and products from PowerOffice Go v2 or 24SevenOffice REST API.
 * @param {'poweroffice-migrate' | '24sevenoffice-migrate'} slug
 * @param {Record<string, string>} creds
 * @param {FetchLike} [fetchImpl]
 * @returns {Promise<Array<{ kind: 'customer' | 'supplier' | 'product', externalId: string, name: string, orgnr: string, email: string, price: number }>>}
 */
export async function fetchSwitcherExtraApi(slug, creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  if (!token) throw new HttpError(400, `Enter your ${SWITCHER_EXTRA_API_UI[slug]?.brand ?? slug} API token.`);
  /** @type {Array<{ kind: 'customer' | 'supplier' | 'product', externalId: string, name: string, orgnr: string, email: string, price: number }>} */
  const items = [];

  if (slug === 'poweroffice-migrate') {
    const subKey = (creds.subscriptionKey ?? '').trim();
    if (!subKey) throw new HttpError(400, 'Enter your PowerOffice Go Ocp-Apim-Subscription-Key.');
    const headers = { authorization: `Bearer ${token}`, 'ocp-apim-subscription-key': subKey, accept: 'application/json' };
    const [cData, sData, pData] = await Promise.all([
      fetchJson('https://goapi.poweroffice.net/v2/Customers', { headers }, 'PowerOffice Go', fetchImpl),
      fetchJson('https://goapi.poweroffice.net/v2/Suppliers', { headers }, 'PowerOffice Go', fetchImpl).catch(() => []),
      fetchJson('https://goapi.poweroffice.net/v2/Products', { headers }, 'PowerOffice Go', fetchImpl).catch(() => []),
    ]);
    for (const c of pickList(cData)) {
      items.push({ kind: 'customer', externalId: String(c.Code ?? c.Id ?? ''), name: String(c.Name ?? ''), orgnr: extractNorwegianOrg(String(c.OrganizationNumber ?? '')), email: String(c.EmailAddress ?? ''), price: 0 });
    }
    for (const s of pickList(sData)) {
      items.push({ kind: 'supplier', externalId: String(s.Code ?? s.Id ?? ''), name: String(s.Name ?? ''), orgnr: extractNorwegianOrg(String(s.OrganizationNumber ?? '')), email: String(s.EmailAddress ?? ''), price: 0 });
    }
    for (const p of pickList(pData)) {
      items.push({ kind: 'product', externalId: String(p.Code ?? p.Id ?? ''), name: String(p.Name ?? ''), orgnr: '', email: '', price: num(p.SalesPrice ?? 0) });
    }
  } else {
    const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
    const [cData, pData] = await Promise.all([
      fetchJson('https://rest.24sevenoffice.com/v1/customers', { headers }, '24SevenOffice', fetchImpl),
      fetchJson('https://rest.24sevenoffice.com/v1/products', { headers }, '24SevenOffice', fetchImpl).catch(() => []),
    ]);
    for (const c of pickList(cData)) {
      items.push({ kind: 'customer', externalId: String(c.number ?? c.id ?? ''), name: String(c.name ?? ''), orgnr: extractNorwegianOrg(String(c.organizationNumber ?? c.orgNumber ?? '')), email: String(c.email ?? ''), price: 0 });
    }
    for (const p of pickList(pData)) {
      items.push({ kind: 'product', externalId: String(p.sku ?? p.number ?? p.id ?? ''), name: String(p.name ?? ''), orgnr: '', email: '', price: num(p.price ?? p.salesPrice ?? 0) });
    }
  }

  return items.filter((i) => i.name.length > 0);
}
