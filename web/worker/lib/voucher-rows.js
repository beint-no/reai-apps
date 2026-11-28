// @ts-check
import { HttpError } from './http.js';

/**
 * Pairs a balanced list of signed postings into ReAI voucher rows.
 *
 * ReAI's manual-voucher contract allows at most one debit and one credit per rowNumber, with the
 * same absolute amount, date and description. Settlement vouchers (Z-reports, invoice batches)
 * have many debits and credits of different sizes, so this splits them greedily into equal pairs.
 * Postings with VAT codes keep their code on every split part. Both sides of a row must share a
 * date, so postings are paired within each `postingDate`, and each date must balance on its own.
 *
 * @template {{ amount: number, description: string, postingDate?: string }} P
 * @param {P[]} postings Signed postings: positive is debit, negative is credit.
 * @returns {Array<P & { rowNumber: number }>}
 */
export function pairVoucherRows(postings) {
  /** @type {Map<string, P[]>} */
  const byDate = new Map();
  for (const p of postings) {
    const key = p.postingDate ?? '';
    byDate.set(key, [...(byDate.get(key) ?? []), p]);
  }
  /** @type {Array<P & { rowNumber: number }>} */
  const rows = [];
  for (const [date, group] of byDate) {
    const pairs = pairOneDate(group, date);
    for (let k = 0; k < pairs.length; k += 2) {
      const rowNumber = rows.length / 2 + 1;
      rows.push({ .../** @type {P & { rowNumber: number }} */ (pairs[k]), rowNumber }, { .../** @type {P & { rowNumber: number }} */ (pairs[k + 1]), rowNumber });
    }
  }
  return rows;
}

/**
 * @template {{ amount: number, description: string }} P
 * @param {P[]} postings
 * @param {string} date
 * @returns {Array<P & { rowNumber: number }>}
 */
function pairOneDate(postings, date) {
  /** @param {P} p */
  const minor = (p) => Math.round(p.amount * 100);
  const debits = postings.filter((p) => minor(p) > 0).map((p) => ({ p, left: minor(p) }));
  const credits = postings.filter((p) => minor(p) < 0).map((p) => ({ p, left: -minor(p) }));
  const debitTotal = debits.reduce((s, d) => s + d.left, 0);
  const creditTotal = credits.reduce((s, c) => s + c.left, 0);
  if (debitTotal === 0 || debitTotal !== creditTotal) {
    throw new HttpError(400, `The voucher does not balance${date ? ` on ${date}` : ''}, so it was not sent to ReAI.`);
  }
  /** @type {Array<P & { rowNumber: number }>} */
  const rows = [];
  let row = 1;
  let i = 0;
  let j = 0;
  while (i < debits.length && j < credits.length) {
    const d = /** @type {{ p: P, left: number }} */ (debits[i]);
    const c = /** @type {{ p: P, left: number }} */ (credits[j]);
    const amount = Math.min(d.left, c.left);
    const description = `${d.p.description} / ${c.p.description}`.slice(0, 200);
    rows.push({ ...d.p, amount: amount / 100, rowNumber: row, description });
    rows.push({ ...c.p, amount: -amount / 100, rowNumber: row, description });
    row += 1;
    d.left -= amount;
    c.left -= amount;
    if (d.left === 0) i += 1;
    if (c.left === 0) j += 1;
  }
  return rows;
}
