// @ts-check
import { HttpError } from '../../lib/http.js';
import { decodeCsvBytes, parseCsv, parseDay } from '../../lib/csv.js';

/** @typedef {import('../../lib/csv.js').CsvDocument} CsvDocument */
export { decodeCsvBytes, parseCsv, parseDay };

export const SAMPLE_HYBEL_CSV = [
  'Dato;Konto;Bilagsnr;Beskrivelse;Belop;MVA',
  '2026-10-01;1509;HYB-2026-10-001;Husleie oktober Leilighet 301;16500,00;0',
  '2026-10-01;3600;HYB-2026-10-001;Husleie oktober Leilighet 301;-16500,00;0',
  '2026-10-01;1509;HYB-2026-10-002;Husleie oktober Leilighet 302;18200,00;0',
  '2026-10-01;3600;HYB-2026-10-002;Husleie oktober Leilighet 302;-18200,00;0',
  '2026-10-03;1920;HYB-2026-10-003;Innbetaling husleie Leilighet 301;16500,00;0',
  '2026-10-03;1509;HYB-2026-10-003;Innbetaling husleie Leilighet 301;-16500,00;0',
  '2026-10-04;1920;HYB-2026-10-004;Innbetaling husleie Leilighet 302;18200,00;0',
  '2026-10-04;1509;HYB-2026-10-004;Innbetaling husleie Leilighet 302;-18200,00;0',
  '2026-10-15;6340;HYB-2026-10-005;Felles strom og oppvarming;2450,50;0',
  '2026-10-15;1920;HYB-2026-10-005;Felles strom og oppvarming;-2450,50;0',
].join('\n');

/**
 * @typedef {{ date: number, account: number, reference: number, amount: number, debit: number, credit: number, description: number, vat: number }} ColumnMap
 * @typedef {{ date: string, account: string, minor: number, reference: string, description: string }} ParsedEntry
 * @typedef {{ entries: ParsedEntry[], month: string, lastDate: string, debitMinor: number, groupCount: number, fingerprint: string }} ParsedJournal
 */



/**
 * Heuristically maps Norwegian and English Hybel CSV column headers.
 * @param {string[]} headers
 * @returns {ColumnMap}
 */
export function guessColumnMap(headers) {
  const norm = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9øæå]+/g, ''));
  /**
   * @param {string[]} candidates
   * @param {Set<number>} used
   * @returns {number}
   */
  const find = (candidates, used) => {
    for (const c of candidates) {
      const idx = norm.findIndex((h, i) => !used.has(i) && (h === c || h.includes(c)));
      if (idx >= 0) {
        used.add(idx);
        return idx;
      }
    }
    return -1;
  };
  /** @type {Set<number>} */
  const used = new Set();
  const date = find(['dato', 'bilagsdato', 'posteringsdato', 'date', 'postingdate'], used);
  const account = find(['konto', 'kontonr', 'kontonummer', 'account', 'accountnumber'], used);
  const reference = find(['bilagsnr', 'bilagsnummer', 'batchid', 'bilag', 'referanse', 'voucher', 'reference'], used);
  const debit = find(['debet', 'debit'], used);
  const credit = find(['kredit', 'credit'], used);
  const amount = debit >= 0 && credit >= 0 ? -1 : find(['belop', 'beløp', 'amount', 'sum'], used);
  const description = find(['beskrivelse', 'tekst', 'description', 'memo', 'note'], used);
  const vat = find(['mva', 'mvakode', 'vat', 'vatcode'], used);
  return { date, account, reference, amount, debit, credit, description, vat };
}


/**
 * Parses an amount string into integer minor units (øre).
 * @param {string} input
 * @returns {number}
 */
export function parseMinor(input) {
  const cleaned = input.replace(/[\s\u00A0]/g, '').replace(',', '.');
  if (cleaned === '') {
    return 0;
  }
  const match = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) {
    throw new HttpError(
      400,
      `Invalid amount '${input.slice(0, 40)}'. Use decimal comma or point with at most two decimals.`,
    );
  }
  const sign = match[1] === '-' ? -1 : 1;
  const whole = Number(match[2]);
  const frac = Number((match[3] ?? '').padEnd(2, '0'));
  const minor = sign * (whole * 100 + frac);
  if (!Number.isSafeInteger(minor) || Math.abs(minor) > 10_000_000_000) {
    throw new HttpError(400, `Amount '${input.slice(0, 40)}' exceeds the 100 million NOK per-line limit.`);
  }
  return minor;
}

/**
 * Validates and builds a balanced monthly Hybel journal with SHA-256 fingerprint.
 * @param {CsvDocument} csv
 * @param {ColumnMap} map
 * @returns {Promise<ParsedJournal>}
 */
export async function buildJournal(csv, map) {
  const hasSigned = map.amount >= 0;
  const hasSplit = map.debit >= 0 && map.credit >= 0;
  if (map.date < 0 || map.account < 0 || map.reference < 0 || (!hasSigned && !hasSplit)) {
    throw new HttpError(400, 'Map date, account, reference and signed amount (or both debit and credit amounts).');
  }
  const selectedCols = [map.date, map.account, map.reference, map.amount, map.debit, map.credit, map.description, map.vat]
    .filter((c) => c >= 0);
  if (new Set(selectedCols).size !== selectedCols.length) {
    throw new HttpError(400, 'Choose a separate source column for each mapped field.');
  }

  /** @type {ParsedEntry[]} */
  const entries = [];
  for (let i = 0; i < csv.rows.length; i++) {
    const row = csv.rows[i] ?? [];
    /** @param {number} col */
    const cell = (col) => (col < 0 ? '' : (row[col] ?? '').trim());
    const date = parseDay(cell(map.date));
    const account = cell(map.account);
    if (!/^[1-8][0-9]{3}$/.test(account)) {
      throw new HttpError(400, `Line ${i + 2}: use a four-digit Norwegian general-ledger account.`);
    }
    const vat = cell(map.vat);
    if (vat !== '' && vat !== '0') {
      throw new HttpError(400, `Line ${i + 2}: only VAT code 0 is supported in this version.`);
    }
    let minor = 0;
    if (hasSigned) {
      minor = parseMinor(cell(map.amount));
    } else {
      const debit = parseMinor(cell(map.debit));
      const credit = parseMinor(cell(map.credit));
      if (debit < 0 || credit < 0 || (debit !== 0 && credit !== 0)) {
        throw new HttpError(400, `Line ${i + 2}: debit and credit must be nonnegative with at most one nonzero.`);
      }
      minor = debit - credit;
    }
    if (minor === 0) {
      continue;
    }
    const reference = cell(map.reference);
    if (!reference || reference.length > 100) {
      throw new HttpError(400, `Line ${i + 2}: include the source voucher/BatchID reference (up to 100 characters).`);
    }
    const description = cell(map.description);
    if (description.length > 500) {
      throw new HttpError(400, `Line ${i + 2}: description exceeds 500 characters.`);
    }
    entries.push({ date, account, minor, reference, description });
  }

  const first = entries[0];
  const months = new Set(entries.map((e) => e.date.slice(0, 7)));
  if (!first || months.size !== 1) {
    throw new HttpError(400, 'Choose one complete calendar month with nonzero postings.');
  }

  /** @type {Map<string, ParsedEntry[]>} */
  const groups = new Map();
  for (const entry of entries) {
    const key = `${entry.date}|${entry.reference}`;
    const list = groups.get(key);
    if (list) {
      list.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }
  for (const rows of groups.values()) {
    const sum = rows.reduce((acc, r) => acc + r.minor, 0);
    if (sum !== 0) {
      const head = rows[0];
      throw new HttpError(
        400,
        `Source reference ${head?.reference ?? ''} (${head?.date ?? ''}) does not balance. Include both sides of every entry.`,
      );
    }
  }

  const canonical = entries
    .map((e) => `${e.date}|${e.account}|${e.minor}|${e.reference}|${e.description}`)
    .sort()
    .join('\n');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)));
  const fingerprint = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
  const debitMinor = entries.filter((e) => e.minor > 0).reduce((acc, e) => acc + e.minor, 0);
  const lastDate = entries.reduce((max, e) => (e.date > max ? e.date : max), first.date);

  return {
    entries,
    month: first.date.slice(0, 7),
    lastDate,
    debitMinor,
    groupCount: groups.size,
    fingerprint,
  };
}

/**
 * Formats minor units (øre) as Norwegian NOK string.
 * @param {number} minor
 * @returns {string}
 */
export function formatNok(minor) {
  return new Intl.NumberFormat('nb-NO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}
