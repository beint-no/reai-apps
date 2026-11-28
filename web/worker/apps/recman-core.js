// @ts-check
import { HttpError } from '../lib/http.js';

/**
 * @typedef {'invoice' | 'creditNote'} RecManDocKind
 * @typedef {{ productId: number, description: string, qty: number, price: number, sumExclVat: number, sumVat: number, sumInclVat: number, vatPercent: number, creditAccount: string, vatCode: string }} RecManInvoiceLine
 * @typedef {{ id: number, kind: RecManDocKind, key: string, number: number, date: string, dueDate: string, companyId: number, departmentId: number, kid: string, paid: number, total: number, lines: RecManInvoiceLine[] }} RecManDocument
 * @typedef {{ address1: string, postalCode: string, city: string, label: string }} RecManAddress
 * @typedef {{ companyId: number, name: string, number: string, vatNumber: string, orgnr: string, visitAddress: RecManAddress | null }} RecManCompany
 * @typedef {{ productId: number, name: string, creditAccount: string, vatCode: string }} RecManProduct
 * @typedef {{ projectId: number, companyId: number, name: string }} RecManProject
 * @typedef {{ workId: number, candidateId: number, projectId: number, jobId: number }} RecManWork
 * @typedef {{ employmentId: number, startDate: string, endDate: string, positionPercent: number, bankAccount: string, iban: string }} RecManEmployment
 * @typedef {{ candidateId: number, name: string, email: string, employments: RecManEmployment[] }} RecManCandidate
 * @typedef {{ paycheckLineId: number, articleId: number, articleName: string, articleType: string, employmentId: number, workId: number, qty: number, amount: number, total: number, startDate: string, endDate: string }} RecManPaycheckLine
 * @typedef {{ paycheckId: number, number: number, candidateId: number, departmentId: number, exported: number, lines: RecManPaycheckLine[] }} RecManPaycheck
 * @typedef {{ code: string, name: string, label: string }} MunicipalityMatch
 */

export const REAI_WAGE_CODES = [
  ['hourly_salary', 'Hourly salary (Timelønn)'],
  ['fixed_salary', 'Fixed salary (Månedslønn)'],
  ['overtime_salary', 'Overtime salary (Overtid m/timer)'],
  ['overtime_premium', 'Overtime premium (Overtidstillegg)'],
  ['evening_supplement', 'Evening supplement (Kveldstillegg)'],
  ['night_supplement', 'Night supplement (Nattillegg)'],
  ['weekend_supplement', 'Weekend supplement (Helgetillegg)'],
  ['public_holiday_supplement', 'Public holiday supplement (Helligdagstillegg)'],
  ['irregular_non_worked_time_supplement', 'Standby / on-call (Bakvakt)'],
  ['bonus', 'Bonus'],
  ['commission', 'Commission (Provisjon)'],
  ['hourly_salary_adjustment', 'Hourly salary adjustment'],
  ['overtime_adjustment', 'Overtime adjustment'],
  ['holiday_allowance', 'Holiday allowance (Feriepenger)'],
  ['vacation_deduction', 'Vacation deduction (Ferietrekk)'],
  ['tax_free_mileage_allowance', 'Tax-free mileage (Kilometergodtgjørelse)'],
  ['employees_travel_expense', 'Travel expense reimbursement'],
];

/**
 * Returns a YYYY-MM-DD date or an empty string for values such as "ongoing".
 * @param {unknown} v
 */
function isoDay(v) {
  const d = String(v ?? '').slice(0, 10);
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(d) && d !== '0000-00-00' ? d : '';
}

/**
 * Normalizes RecMan API v2 `data` / `lines` which may be either an array or an ID-keyed object.
 * @param {unknown} raw
 * @returns {any[]}
 */
export function recmanRows(raw) {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw)
      .sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))
      .map(([, v]) => v);
  }
  return [];
}

/**
 * Extracts and validates a 9-digit Norwegian organization number (Mod11) from RecMan `vatNumber`.
 * @param {string} vatNumber
 * @returns {string}
 */
export function extractNorwegianOrg(vatNumber) {
  const cleaned = vatNumber.toUpperCase().replace(/\s+/g, '').replace(/^NO/, '').replace(/MVA$/g, '');
  if (!/^[0-9]{9}$/.test(cleaned) || cleaned === '000000000') {
    return '';
  }
  const w = [3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += Number(cleaned[i]) * (w[i] ?? 0);
  }
  const check = (11 - (sum % 11)) % 11;
  return check < 10 && check === Number(cleaned[8]) ? cleaned : '';
}

/**
 * Validates an 11-digit Norwegian bank account number (Mod11).
 * @param {string} raw
 * @returns {string}
 */
export function verifiedNorwegianAccount(raw) {
  const digits = raw.replace(/[\s.]/g, '');
  if (!/^[0-9]{11}$/.test(digits) || /^0+$/.test(digits)) {
    return '';
  }
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += Number(digits[i]) * (w[i] ?? 0);
  }
  const check = (11 - (sum % 11)) % 11;
  return check < 10 && check === Number(digits[10]) ? digits : '';
}

/**
 * Validates a Norwegian IBAN (NO + 13 digits, Mod97) and returns its 11-digit BBAN.
 * @param {string} raw
 * @returns {string}
 */
export function verifiedNorwegianIban(raw) {
  const iban = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^NO[0-9]{13}$/.test(iban)) {
    return '';
  }
  const rearranged = `${iban.slice(4)}2324${iban.slice(2, 4)}`;
  let rem = 0;
  for (const ch of rearranged) {
    rem = (rem * 10 + Number(ch)) % 97;
  }
  if (rem !== 1) {
    return '';
  }
  return verifiedNorwegianAccount(iban.slice(4));
}

/**
 * Suggests a ReAI wage specification code for a RecMan paycheck article.
 * @param {string} articleType
 * @param {string} articleName
 * @returns {string}
 */
export function suggestWageCode(articleType, articleName) {
  const type = articleType.trim().toLowerCase();
  const name = articleName.trim().toLowerCase();
  if ((type === 'hour' && (name === 'timelønn' || name === 'hourly salary')) || name.startsWith('timelønn')) {
    return 'hourly_salary';
  }
  if ((type === 'month' && (name === 'månedslønn' || name === 'monthly salary')) || name.startsWith('månedslønn')) {
    return 'fixed_salary';
  }
  if (name.includes('kveldstillegg')) {
    return 'evening_supplement';
  }
  if (name.includes('nattillegg')) {
    return 'night_supplement';
  }
  if (name.includes('helgetillegg')) {
    return 'weekend_supplement';
  }
  if (name.includes('helligdag')) {
    return 'public_holiday_supplement';
  }
  if (name.includes('bakvakt') || name.includes('baktvakt')) {
    return 'irregular_non_worked_time_supplement';
  }
  if (name.includes('overtid')) {
    return 'overtime_salary';
  }
  if (name.includes('bonus')) {
    return 'bonus';
  }
  return '';
}

/**
 * Creates a quota-tracked RecMan API v2 read-only client for a single request.
 * @param {string} apiKey
 */
export function createRecManClient(apiKey) {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    throw new HttpError(400, 'Enter your RecMan read-only (SELECT) API key.');
  }
  let calls = 0;

  /**
   * @param {string} scope
   * @param {Record<string, string>} [params]
   */
  async function get(scope, params = {}) {
    calls += 1;
    if (calls > 45) {
      throw new HttpError(400, 'Stopped at 45 RecMan API calls to protect your daily RecMan quota. Narrow your filters (fromDate, minInvoiceId or minPaycheckId).');
    }
    const url = new URL('https://api.recman.io/v2/get/');
    url.searchParams.set('scope', scope);
    url.searchParams.set('key', cleanKey);
    for (const [k, v] of Object.entries(params)) {
      if (v !== '') {
        url.searchParams.set(k, v);
      }
    }
    let res;
    try {
      res = await fetch(url.toString(), {
        headers: { accept: 'application/json', 'accept-language': 'en' },
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      // Never leak URL containing the RecMan API key.
      throw new HttpError(502, 'Could not reach RecMan API. Check connectivity and try again.');
    }
    if (res.status === 429) {
      throw new HttpError(429, 'RecMan daily API request limit reached. Try again later.');
    }
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(400, `RecMan denied access to "${scope}". Check your API key and SELECT permissions.`);
    }
    if (!res.ok) {
      throw new HttpError(502, `RecMan returned HTTP ${res.status} for scope "${scope}".`);
    }
    const body = /** @type {{ success?: boolean, data?: unknown, numRows?: number, nextPage?: boolean | number | string, error?: unknown }} */ (await res.json());
    if (!body.success) {
      throw new HttpError(400, `RecMan rejected scope "${scope}". Verify SELECT permission on this API key.`);
    }
    return body;
  }

  /**
   * @param {string} scope
   * @param {Record<string, string>} [params]
   * @param {number} [maxPages]
   */
  async function fetchAll(scope, params = {}, maxPages = 6) {
    /** @type {any[]} */
    const out = [];
    for (let page = 1; page <= maxPages; page++) {
      const body = await get(scope, { ...params, page: String(page) });
      const batch = recmanRows(body.data);
      out.push(...batch);
      const hasNext = body.nextPage === true || body.nextPage === 1 || body.nextPage === '1';
      if (!hasNext || batch.length === 0) {
        return out;
      }
    }
    return out;
  }

  /**
   * Tests RecMan API key health using 1–2 minimal calls.
   */
  async function health() {
    try {
      const corps = await fetchAll('corporation', { fields: 'name' }, 1);
      const names = corps.map((c) => String(c.name ?? '').trim()).filter(Boolean);
      if (names.length > 0) {
        return `Connected to RecMan · ${names.join(', ')}`;
      }
    } catch {
      // Fall back to candidate scope when corporation directory is not enabled.
    }
    const res = await get('candidate', { fields: 'firstName', isEmployee: '1', page: '1' });
    const count = recmanRows(res.data).length;
    return `Connected to RecMan · Verified SELECT access (${count} employees on page 1)`;
  }

  /**
   * Fetches the original base64 PDF for an invoice or credit note and verifies %PDF- header.
   * @param {RecManDocKind} kind
   * @param {number} id
   * @returns {Promise<string>}
   */
  async function fetchPdfBase64(kind, id) {
    const scope = kind === 'creditNote' ? 'creditNotePdf' : 'invoicePdf';
    const param = kind === 'creditNote' ? 'creditNoteId' : 'invoiceId';
    const res = await get(scope, { [param]: String(id) });
    const b64 = typeof (/** @type {any} */ (res.data))?.base64 === 'string' ? String((/** @type {any} */ (res.data)).base64) : '';
    if (!b64 || !b64.startsWith('JVBERi0')) {
      throw new HttpError(400, `RecMan did not return a valid PDF for ${kind} #${id}.`);
    }
    return b64;
  }

  return {
    get,
    fetchAll,
    health,
    fetchPdfBase64,
    getCalls: () => calls,
  };
}

/**
 * Parses raw RecMan invoice or creditNote rows into normalized RecManDocument records.
 * @param {any[]} rawRows
 * @param {RecManDocKind} kind
 * @returns {RecManDocument[]}
 */
export function parseRecManDocuments(rawRows, kind) {
  /** @type {RecManDocument[]} */
  const docs = [];
  for (const r of rawRows) {
    const id = Number(kind === 'creditNote' ? (r.creditNoteId ?? r.id) : (r.invoiceId ?? r.id));
    const number = Number(r.number ?? 0);
    const departmentId = Number(r.departmentId ?? 1);
    const companyId = Number(r.companyId ?? 0);
    const date = String(r.date ?? '').slice(0, 10);
    if (!id || !number || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
      continue;
    }
    const lines = recmanRows(r.lines).map((l) => ({
      productId: Number(l.productId ?? 0),
      description: String(l.description ?? '').trim(),
      qty: Number(l.qty ?? 0),
      price: Number(l.price ?? 0),
      sumExclVat: Number(l.sumExclVat ?? 0),
      sumVat: Number(l.sumVat ?? 0),
      sumInclVat: Number(l.sumInclVat ?? 0),
      vatPercent: Number(l.vatPercent ?? 0),
      creditAccount: String(l.creditAccount ?? '').trim(),
      vatCode: String(l.vatCode ?? '').trim(),
    }));
    const total = Number(lines.reduce((s, l) => s + l.sumInclVat, 0).toFixed(2));
    docs.push({
      id,
      kind,
      key: `${kind}-${departmentId}-${id}`,
      number,
      date,
      dueDate: String(r.dueDate ?? '').slice(0, 10),
      companyId,
      departmentId,
      kid: String(r.identificationCode ?? '').trim(),
      paid: Number(r.paid ?? 0),
      total,
      lines,
    });
  }
  return docs;
}

/**
 * Parses raw RecMan company rows.
 * @param {any[]} rawRows
 * @returns {RecManCompany[]}
 */
export function parseRecManCompanies(rawRows) {
  return rawRows
    .map((c) => {
      const va = c.visitAddress && typeof c.visitAddress === 'object' ? c.visitAddress : null;
      const address1 = String(va?.address1 ?? '').trim();
      const postalCode = String(va?.postalCode ?? '').trim();
      const city = String(va?.city ?? '').trim();
      const label = [address1, postalCode, city].filter(Boolean).join(' ');
      const vatNumber = String(c.vatNumber ?? '').trim();
      return {
        companyId: Number(c.companyId ?? c.id ?? 0),
        name: String(c.name ?? '').trim(),
        number: String(c.number ?? '').trim(),
        vatNumber,
        orgnr: extractNorwegianOrg(vatNumber),
        visitAddress: label ? { address1, postalCode, city, label } : null,
      };
    })
    .filter((c) => c.companyId > 0);
}

/**
 * Parses raw RecMan product rows.
 * @param {any[]} rawRows
 * @returns {Map<number, RecManProduct>}
 */
export function parseRecManProducts(rawRows) {
  /** @type {Map<number, RecManProduct>} */
  const map = new Map();
  for (const p of rawRows) {
    const productId = Number(p.productId ?? p.id ?? 0);
    if (productId > 0) {
      map.set(productId, {
        productId,
        name: String(p.name ?? '').trim(),
        creditAccount: String(p.creditAccount ?? '').trim(),
        vatCode: String(p.vatCode ?? '').trim(),
      });
    }
  }
  return map;
}

/**
 * Parses raw RecMan candidate (isEmployee=1) rows.
 * @param {any[]} rawRows
 * @returns {RecManCandidate[]}
 */
export function parseRecManCandidates(rawRows) {
  return rawRows
    .map((c) => {
      const candidateId = Number(c.candidateId ?? c.id ?? 0);
      const name = [String(c.firstName ?? '').trim(), String(c.lastName ?? '').trim()].filter(Boolean).join(' ');
      const employments = recmanRows(c.employment).map((e) => ({
        employmentId: Number(e.employmentId ?? 0),
        // RecMan sends endDate "ongoing" for open employments (Postman collection, Get Candidate's Fields).
        startDate: isoDay(e.startDate),
        endDate: isoDay(e.endDate),
        positionPercent: Number(e.positionPercent ?? 0),
        bankAccount: String(e.bankAccount ?? '').trim(),
        iban: String(e.iban ?? '').trim(),
      }));
      return {
        candidateId,
        name,
        email: String(c.email ?? '').trim(),
        employments,
      };
    })
    .filter((c) => c.candidateId > 0);
}

/**
 * Parses raw RecMan paycheck rows.
 * @param {any[]} rawRows
 * @returns {RecManPaycheck[]}
 */
export function parseRecManPaychecks(rawRows) {
  return rawRows
    .map((p) => ({
      paycheckId: Number(p.paycheckId ?? p.id ?? 0),
      number: Number(p.number ?? 0),
      candidateId: Number(p.candidateId ?? 0),
      departmentId: Number(p.departmentId ?? 1),
      exported: Number(p.exported ?? 0),
      lines: recmanRows(p.lines).map((l) => ({
        paycheckLineId: Number(l.paycheckLineId ?? l.id ?? 0),
        articleId: Number(l.articleId ?? 0),
        articleName: String(l.articleName ?? '').trim(),
        articleType: String(l.articleType ?? '').trim(),
        employmentId: Number(l.employmentId ?? 0),
        workId: Number(l.workId ?? 0),
        qty: Number(l.qty ?? 0),
        amount: Number(l.amount ?? 0),
        total: Number(l.total ?? 0),
        startDate: String(l.startDate ?? '').slice(0, 10),
        endDate: String(l.endDate ?? '').slice(0, 10),
      })),
    }))
    .filter((p) => p.paycheckId > 0 && p.lines.length > 0);
}

/**
 * Resolves Norwegian workplace addresses to 4-digit municipality codes via Kartverket API.
 * Mirrors Saman's WorkplaceMunicipalities.swift exact street + postcode matching.
 * @param {RecManAddress[]} addresses
 * @returns {Promise<Map<string, MunicipalityMatch>>}
 */
export async function lookupWorkplaceMunicipalities(addresses) {
  /** @type {Map<string, RecManAddress>} */
  const unique = new Map();
  for (const addr of addresses) {
    if (addr.address1 && /^[0-9]{4}$/.test(addr.postalCode) && !unique.has(addr.label)) {
      unique.set(addr.label, addr);
    }
  }
  /** @type {Map<string, MunicipalityMatch>} */
  const out = new Map();
  const entries = [...unique.entries()].slice(0, 25);

  /**
   * @param {string} street
   * @param {string} postcode
   */
  async function queryKartverket(street, postcode) {
    const url = new URL('https://api.kartverket.no/adresser/v1/sok');
    url.searchParams.set('adressetekst', street);
    url.searchParams.set('postnummer', postcode);
    url.searchParams.set('treffPerSide', '20');
    try {
      const res = await fetch(url.toString(), {
        headers: { accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(4_500),
      });
      if (!res.ok) {
        return [];
      }
      const data = /** @type {{ adresser?: Array<{ adressetekst: string, postnummer: string, kommunenummer: string, kommunenavn: string }> }} */ (await res.json());
      return (data.adresser ?? []).filter(
        (a) => a.postnummer === postcode && a.adressetekst.toLowerCase() === street.toLowerCase(),
      );
    } catch {
      return [];
    }
  }

  await Promise.all(
    entries.map(async ([label, addr]) => {
      let matches = await queryKartverket(addr.address1, addr.postalCode);
      if (matches.length === 0) {
        const unit = /^(.*\s[0-9]+)\s*[A-Za-z]$/.exec(addr.address1);
        if (unit?.[1]) {
          matches = await queryKartverket(unit[1], addr.postalCode);
        }
      }
      const codes = new Set(matches.map((m) => m.kommunenummer).filter(Boolean));
      const first = matches[0];
      if (codes.size === 1 && first) {
        out.set(label, {
          code: first.kommunenummer,
          name: first.kommunenavn,
          label: `${first.kommunenavn} (${first.kommunenummer})`,
        });
      }
    }),
  );

  return out;
}

/**
 * Computes Norwegian Easter Sunday (UTC Date) for holiday-aware payout date adjustment.
 * @param {number} year
 */
function norwegianEasterUtc(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

/**
 * Calculates the draft payroll payment date for a YYYY-MM period using ReAI's payoutDayOfMonth.
 * @param {string} period
 * @param {number | null | undefined} payoutDay
 * @returns {string}
 */
export function computeDraftPaymentDate(period, payoutDay) {
  const [yStr, mStr] = period.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const pref = typeof payoutDay === 'number' && payoutDay >= 1 && payoutDay <= 31 ? payoutDay : 31;
  let targetYear = year;
  let targetMonth = month;
  if (pref <= 10) {
    targetMonth += 1;
    if (targetMonth > 12) {
      targetMonth = 1;
      targetYear += 1;
    }
  }
  const daysInMonth = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  let ts = Date.UTC(targetYear, targetMonth - 1, Math.min(pref, daysInMonth));
  if (pref !== 31) {
    return new Date(ts).toISOString().slice(0, 10);
  }
  const easter = norwegianEasterUtc(targetYear);
  const movable = new Set([-3, -2, 1, 39, 50].map((off) => new Date(easter + off * 86_400_000).toISOString().slice(0, 10)));
  const fixed = new Set(['01-01', '05-01', '05-17', '12-24', '12-25', '12-26']);
  for (let guard = 0; guard < 14; guard++) {
    const dt = new Date(ts);
    const iso = dt.toISOString().slice(0, 10);
    const wd = dt.getUTCDay();
    if (wd !== 0 && wd !== 6 && !movable.has(iso) && !fixed.has(iso.slice(5))) {
      return iso;
    }
    ts -= 86_400_000;
  }
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * 100% synthetic demo dataset (zero real client data) covering both invoices/credit notes
 * and single- vs. multi-municipality staffing paychecks.
 */
export function buildSyntheticRecManSample() {
  /** @type {RecManDocument[]} */
  const documents = [
    {
      id: 4101,
      kind: 'invoice',
      key: 'invoice-1-4101',
      number: 2027001,
      date: '2027-01-15',
      dueDate: '2027-01-29',
      companyId: 101,
      departmentId: 1,
      kid: '00020270019',
      paid: 0,
      total: 121250,
      lines: [
        { productId: 1, description: 'Timelønn helsepersonell (uke 1–2)', qty: 160, price: 680, sumExclVat: 108800, sumVat: 0, sumInclVat: 108800, vatPercent: 0, creditAccount: '3200', vatCode: '6' },
        { productId: 9, description: 'Utlegg for leie av bolig', qty: 1, price: 9960, sumExclVat: 9960, sumVat: 2490, sumInclVat: 12450, vatPercent: 25, creditAccount: '3600', vatCode: '3' },
      ],
    },
    {
      id: 4102,
      kind: 'creditNote',
      key: 'creditNote-1-4102',
      number: 2027002,
      date: '2027-01-18',
      dueDate: '',
      companyId: 101,
      departmentId: 1,
      kid: '',
      paid: 0,
      total: 5440,
      lines: [
        { productId: 1, description: 'Kreditering feilført skift (8 t)', qty: 8, price: 680, sumExclVat: 5440, sumVat: 0, sumInclVat: 5440, vatPercent: 0, creditAccount: '3200', vatCode: '6' },
      ],
    },
  ];
  /** @type {RecManCompany[]} */
  const companies = [
    {
      companyId: 101,
      name: 'Nordlys Helsekommune (Demo)',
      number: '10045',
      vatNumber: 'NO935606403MVA',
      orgnr: '935606403',
      visitAddress: { address1: 'Storgata 12', postalCode: '9405', city: 'Harstad', label: 'Storgata 12 9405 Harstad' },
    },
  ];
  return { documents, companies };
}
