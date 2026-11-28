// @ts-check

/**
 * Extracts and validates a 9-digit Norwegian organization number (Mod11) from a VAT number or organization number.
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
