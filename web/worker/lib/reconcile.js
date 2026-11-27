// @ts-check
import { HttpError } from './http.js';
import { reaiRequest } from './reai.js';

/**
 * @typedef {{ id: string, date: string, amountMinor: number, currency: string, feeMinor?: number, reference: string, detail: string }} PayoutItem
 * @typedef {{ id: number, amount: number, currencyCode: string, transactionDate: string, description: string | null, paymentReference: string | null }} BankTx
 * @typedef {{ payout: PayoutItem, match: BankTx | null, status: string }} ReconcileRow
 */

const TWO_DECIMAL_CURRENCIES = new Set(['NOK', 'SEK', 'DKK', 'EUR', 'GBP', 'USD']);

/**
 * Returns YYYY-MM for the current UTC month.
 * @returns {string}
 */
export function currentMonthIso() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Validates YYYY-MM and returns { start, end, lastDay }.
 * @param {string} month
 * @returns {{ month: string, start: string, end: string, lastDay: string }}
 */
export function monthBounds(month) {
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new HttpError(400, 'Choose a valid month in YYYY-MM format.');
  }
  const [yStr, mStr] = month.split('-');
  const year = Number(yStr);
  const m = Number(mStr);
  const nextDate = new Date(Date.UTC(year, m, 1));
  const lastDayNum = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const end = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const lastDay = `${yStr}-${mStr}-${String(lastDayNum).padStart(2, '0')}`;
  return { month, start: `${month}-01`, end, lastDay };
}

/**
 * @param {string} currency
 */
export function assertTwoDecimalCurrency(currency) {
  if (!TWO_DECIMAL_CURRENCIES.has(currency.toUpperCase())) {
    throw new HttpError(400, 'Only two-decimal currencies (NOK, SEK, DKK, EUR, GBP, USD) are supported.');
  }
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function dayDiff(a, b) {
  const ta = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const tb = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) {
    return 9999;
  }
  return Math.abs(ta - tb) / 86_400_000;
}

/**
 * Matches provider payouts against pending ReAI bank transactions within ±8 days.
 * @param {PayoutItem[]} payouts
 * @param {BankTx[]} bankTransactions
 * @returns {ReconcileRow[]}
 */
export function matchPayouts(payouts, bankTransactions) {
  return payouts.map((payout) => {
    const candidates = bankTransactions.filter(
      (tx) =>
        tx.currencyCode === payout.currency &&
        Math.round(tx.amount * 100) === payout.amountMinor &&
        dayDiff(tx.transactionDate, payout.date) <= 8,
    );
    const needle = payout.reference.trim().toLowerCase();
    const exact = needle
      ? candidates.filter(
          (tx) =>
            (tx.paymentReference?.toLowerCase().includes(needle) ?? false) ||
            (tx.description?.toLowerCase().includes(needle) ?? false),
        )
      : [];

    if (exact.length === 1 && exact[0]) {
      return { payout, match: exact[0], status: 'Reference + amount' };
    }
    if (candidates.length === 1 && candidates[0]) {
      const candidate = candidates[0];
      const competing = payouts.filter(
        (other) =>
          other.id !== payout.id &&
          other.currency === payout.currency &&
          other.amountMinor === payout.amountMinor &&
          dayDiff(other.date, candidate.transactionDate) <= 8,
      );
      if (competing.length === 0) {
        return { payout, match: candidate, status: 'Amount/date candidate' };
      }
      return { payout, match: null, status: 'Several payouts fit' };
    }
    return {
      payout,
      match: null,
      status: candidates.length > 1 ? 'Several candidates' : 'No pending bank match',
    };
  });
}

/**
 * Fetches active banks for the current session company matching its currency.
 * @param {import('./types.d.ts').Env} env
 * @param {import('./types.d.ts').SessionData} session
 * @returns {Promise<Array<{ id: number, displayName: string, currencyCode: string, ledgerAccountNumber: string }>>}
 */
export async function loadActiveBanks(env, session) {
  const company = session.tenants.find((t) => t.id === session.tenantId);
  if (!company) {
    return [];
  }
  const all = /** @type {Array<{ id: number, displayName: string, currencyCode: string, ledgerAccountNumber: string, archived: boolean }>} */ (
    await reaiRequest(env, '/api/company-banks', {
      token: session.accessToken,
      tenantId: company.id,
    })
  );
  return all.filter((b) => !b.archived && b.currencyCode === company.currencyCode);
}

/**
 * Fetches pending ReAI bank transactions for one bank account and month.
 * @param {import('./types.d.ts').Env} env
 * @param {import('./types.d.ts').SessionData} session
 * @param {number} bankId
 * @param {string} month
 * @returns {Promise<BankTx[]>}
 */
export async function loadPendingBankTransactions(env, session, bankId, month) {
  const result = /** @type {{ pendingTransactions?: BankTx[] }} */ (
    await reaiRequest(env, `/api/bank-reconciliations/${bankId}`, {
      token: session.accessToken,
      tenantId: session.tenantId,
      query: { month, include: 'pending_transactions' },
    })
  );
  return Array.isArray(result.pendingTransactions) ? result.pendingTransactions : [];
}

/**
 * Escapes a CSV cell safely against formula injection (=, +, -, @).
 * @param {string} value
 * @returns {string}
 */
export function safeCsvCell(value) {
  const trimmed = value.trimStart();
  const guarded = trimmed.length > 0 && '=+-@'.includes(trimmed[0] ?? '') ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/**
 * Builds a downloadable CSV attachment Response.
 * @param {string} filename
 * @param {string[][]} rows
 * @returns {Response}
 */
export function csvAttachment(filename, rows) {
  const body = rows.map((r) => r.map(safeCsvCell).join(',')).join('\r\n') + '\r\n';
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

/**
 * Formats integer minor units as decimal string.
 * @param {number} minor
 * @returns {string}
 */
export function formatMinor(minor) {
  return new Intl.NumberFormat('nb-NO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}
