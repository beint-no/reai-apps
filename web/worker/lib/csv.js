// @ts-check
import { HttpError } from './http.js';

/** @typedef {{ headers: string[], rows: string[][] }} CsvDocument */

/**
 * Decodes UTF-8 (strict) or falls back to Windows-1252, matching Hybel CSV exports.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function decodeCsvBytes(bytes) {
  if (bytes.byteLength > 10_000_000) {
    throw new HttpError(400, 'Choose a CSV smaller than 10 MB.');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/**
 * Parses a semicolon- or comma-separated CSV document.
 * @param {string} text
 * @returns {CsvDocument}
 */
export function parseCsv(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const firstLineEnd = normalized.indexOf('\n');
  const firstLine = firstLineEnd === -1 ? normalized : normalized.slice(0, firstLineEnd);
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  const sep = semicolons > commas ? ';' : ',';

  /** @type {string[][]} */
  const result = [];
  /** @type {string[]} */
  let row = [];
  let field = '';
  let quoted = false;
  let closed = false;

  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (quoted) {
      if (c === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
          closed = true;
        }
      } else {
        field += c;
      }
    } else if (c === sep) {
      row.push(field);
      field = '';
      closed = false;
    } else if (c === '\n') {
      row.push(field);
      field = '';
      closed = false;
      if (row.some((cell) => cell.trim() !== '')) {
        result.push(row);
      }
      row = [];
    } else if (c === '"' && field === '' && !closed) {
      quoted = true;
    } else {
      if (closed || c === '"') {
        throw new HttpError(400, 'Malformed CSV quoting. Export the original CSV again.');
      }
      field += c;
    }
  }
  if (quoted) {
    throw new HttpError(400, 'The CSV ends inside a quoted field.');
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== '')) {
      result.push(row);
    }
  }
  const headers = result[0];
  if (!headers || headers.length <= 1 || headers.length > 100 || result.length <= 1 || result.length > 5001) {
    throw new HttpError(400, 'Choose a CSV with a header row and 1–5,000 journal lines.');
  }
  const rows = result.slice(1);
  if (!rows.every((r) => r.length === headers.length)) {
    throw new HttpError(400, 'Every CSV row must have the same number of columns as the header.');
  }
  return { headers: headers.map((h) => h.trim()), rows };
}

/**
 * Parses yyyy-MM-dd, dd.MM.yyyy or dd/MM/yyyy strictly into ISO yyyy-MM-dd.
 * @param {string} input
 * @returns {string}
 */
export function parseDay(input) {
  const trimmed = input.trim();
  let year = 0;
  let month = 0;
  let day = 0;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const eu = /^(\d{2})[./](\d{2})[./](\d{4})$/.exec(trimmed);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (eu) {
    day = Number(eu[1]);
    month = Number(eu[2]);
    year = Number(eu[3]);
  } else {
    throw new HttpError(400, `Invalid date '${trimmed.slice(0, 40)}'. Use yyyy-MM-dd, dd.MM.yyyy or dd/MM/yyyy.`);
  }
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    throw new HttpError(400, `Invalid calendar date '${trimmed.slice(0, 40)}'.`);
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
