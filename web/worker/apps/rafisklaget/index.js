// @ts-check
import { assertPublicHttpsUrl, isoDate } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';
import { pairVoucherRows } from '../../lib/voucher-rows.js';
import { child, children, find, parseXml, text } from './xml.js';

/**
 * @typedef {'lagsavgift' | 'levy' | 'pension' | 'membership' | 'other' | 'lien'} DeductionGroup
 * @typedef {{ key: string, label: string, group: DeductionGroup, minor: number }} Deduction
 * @typedef {{ baseMinor: number, ratePct: number, vatMinor: number }} VatPart
 * @typedef {{ vare: string, kvantum: string, pris: string, belopMinor: number }} CatchLine
 * @typedef {{ avrnr: string, seddelnr: string, salgsdato: string, utbetalingsdato: string, test: boolean, avgiftsfritt: boolean,
 *   fisker: string, fiskerNr: string, fartoy: string, kjoper: string, lines: CatchLine[], sumVareMinor: number,
 *   deductions: Deduction[], utgMva: VatPart, inngMva: VatPart, sumMvaMinor: number, payoutMinor: number }} Settlement
 * @typedef {{ avrnr: string, fiskerid: string, regmrk: string, fartoynavn: string, seddelNr: string, seddelDato: string }} ListItem
 * @typedef {Record<'sales' | 'payout' | DeductionGroup, string>} AccountMap
 * @typedef {{ account: string, description: string, signedMinor: number, vat: 'none' | 'output' | 'input', ratePct: number }} VoucherLine
 * @typedef {{ code: string, rate: number, vatType: string, amountBasis: string, reverseCharge: boolean }} VatCode
 */

const SLUG = 'rafisklaget';
const BRAND = 'Råfisklaget';
const BASE_PATH = `/app/${SLUG}`;
const TITLE = 'Råfisklaget Settlements to ReAI';
const LEAD = 'Fetch your settlements (avregninger) from Norges Råfisklag and book each one as a balanced ReAI review voucher: catch value as sales with output VAT, every levy and deduction on its own account, and the payout as a receivable.';
const ENDPOINT = 'https://ws.rafisklaget.no/seddeldata/SeddelDataService';
const SOAP_NS = 'http://seddeldatanrl.rafisklaget.no/';
const MAX_SETTLEMENTS = 20;

/** @type {AccountMap} */
const DEFAULT_ACCOUNTS = { sales: '3000', payout: '1570', lagsavgift: '7790', levy: '7790', pension: '7790', membership: '7410', other: '7790', lien: '2990' };

/** @type {Array<{ key: keyof AccountMap, label: string }>} */
const ACCOUNT_FIELDS = [
  { key: 'sales', label: 'Catch sales (credit)' },
  { key: 'payout', label: 'Payout receivable (debit)' },
  { key: 'lagsavgift', label: 'Lagsavgift' },
  { key: 'levy', label: 'Product, research, control and resource levies' },
  { key: 'pension', label: 'Pensjonstrekk' },
  { key: 'membership', label: 'Membership deductions' },
  { key: 'other', label: 'Gutting cost and own share deductions' },
  { key: 'lien', label: 'Liens (heftelser) paid to creditors' },
];

/** @type {Settlement} */
const SAMPLE = {
  avrnr: '9000123', seddelnr: '123456789', salgsdato: '2026-10-14', utbetalingsdato: '2026-10-21', test: false, avgiftsfritt: false,
  fisker: 'Eksempel Fiskeri AS', fiskerNr: '81234', fartoy: 'F 123 V Havbris', kjoper: 'Eksempel Fiskemottak AS',
  lines: [
    { vare: 'Torsk', kvantum: '1200.0', pris: '38.50', belopMinor: 4620000 },
    { vare: 'Hyse', kvantum: '400.0', pris: '22.00', belopMinor: 880000 },
  ],
  sumVareMinor: 5500000,
  deductions: [
    { key: 'lagsavgift', label: 'Lagsavgift 1.20 %', group: 'lagsavgift', minor: 66000 },
    { key: 'produktavgift', label: 'Produktavgift', group: 'levy', minor: 154000 },
    { key: 'ressursavgift', label: 'Ressursavgift', group: 'levy', minor: 21700 },
    { key: 'sloyekostnad', label: 'Sløyekostnad', group: 'other', minor: 40000 },
    { key: 'medlemstrekk-1', label: 'Fiskarlaget', group: 'membership', minor: 27500 },
  ],
  utgMva: { baseMinor: 5500000, ratePct: 15, vatMinor: 825000 },
  inngMva: { baseMinor: 40000, ratePct: 25, vatMinor: 10000 },
  sumMvaMinor: 815000,
  payoutMinor: 0,
};
SAMPLE.payoutMinor = SAMPLE.sumVareMinor + SAMPLE.utgMva.vatMinor - SAMPLE.inngMva.vatMinor - SAMPLE.deductions.reduce((t, d) => t + d.minor, 0);

/**
 * Converts an xsd:decimal in kroner to øre. Empty is zero.
 * @param {string} raw
 * @param {string} field
 */
function decMinor(raw, field) {
  const s = raw.trim();
  if (s === '') return 0;
  if (!/^[+-]?[0-9]+(\.[0-9]+)?$/.test(s)) throw new HttpError(502, `Råfisklaget sent an invalid amount in ${field}: "${s}".`);
  return Math.round(Number(s) * 100);
}

/** @param {string} raw */
function rate(raw) {
  const s = raw.trim();
  return /^[+-]?[0-9]+(\.[0-9]+)?$/.test(s) ? Math.round(Number(s) * 100) / 100 : 0;
}

/** @param {string} s */
function xmlEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Calls one SeddelData operation (SOAP 1.2, document/literal, unqualified parameters) and parses the XML
 * document carried as a string in <return>. A <feil> element in that document becomes an error.
 * @param {string} operation
 * @param {Array<[string, string]>} params
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 * @returns {Promise<import('./xml.js').XmlNode>}
 */
async function soapCall(operation, params, fetchImpl) {
  const body = `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:ns="${SOAP_NS}"><soap:Body><ns:${operation}>${params.map(([k, v]) => `<${k}>${xmlEscape(v)}</${k}>`).join('')}</ns:${operation}></soap:Body></soap:Envelope>`;
  assertPublicHttpsUrl(ENDPOINT);
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/soap+xml; charset=utf-8', accept: 'application/soap+xml' },
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  const textBody = await res.text();
  /** @type {import('./xml.js').XmlNode | undefined} */
  let envelope;
  try {
    envelope = parseXml(textBody);
  } catch {
    throw new HttpError(502, `Råfisklaget returned HTTP ${res.status} without a readable SOAP response.`);
  }
  const fault = find(envelope, 'Fault');
  if (fault) throw new HttpError(400, `Råfisklaget rejected the request: ${(find(fault, 'Text')?.text ?? 'SOAP fault').trim().slice(0, 300)}`);
  if (!res.ok) throw new HttpError(502, `Råfisklaget returned HTTP ${res.status}.`);
  const ret = find(envelope, 'return');
  if (!ret || !ret.text.trim()) throw new HttpError(502, `Råfisklaget returned no data for ${operation}.`);
  const doc = parseXml(ret.text.trim());
  const feil = find(doc, 'feil');
  if (feil && feil.text.trim()) throw new HttpError(400, `Råfisklaget: ${feil.text.trim().slice(0, 300)}`);
  return doc;
}

/** @param {Record<string, string>} creds */
function credentials(creds) {
  const brukernavn = (creds.brukernavn ?? '').trim();
  const passord = creds.passord ?? '';
  if (!brukernavn || !passord) throw new HttpError(400, 'Enter the web service username and password from Råfisklaget.');
  return { brukernavn, passord };
}

/** @param {string} iso */
const norwegianDate = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/**
 * Lists settlements (avregninger) for a fisher id or organisation number and date range.
 * Docs: https://www.rafisklaget.no/informasjon-og-veiledninger/oversikt-systemleverandoerer-og-integrasjoner
 * (hentAvregningListe: brukernavn, passord, idnr, fomdato, tomdato; response avregninglisteresp.xsd).
 * The date format is not documented: ISO dates are sent first and, if the service rejects them with a
 * date error, dd.mm.yyyy once.
 * @param {Record<string, string>} creds
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 * @returns {Promise<ListItem[]>}
 */
async function listSettlements(creds, fetchImpl) {
  const { brukernavn, passord } = credentials(creds);
  const idnr = (creds.idnr ?? '').replace(/\s+/g, '');
  if (!/^[0-9]{3,11}$/.test(idnr)) throw new HttpError(400, 'Enter the fisher number (fiskerid) or organisation number used at Råfisklaget.');
  const from = isoDate(creds.from);
  const to = isoDate(creds.to);
  if (to < from) throw new HttpError(400, 'The end date is before the start date.');
  /** @type {import('./xml.js').XmlNode} */
  let doc;
  try {
    doc = await soapCall('hentAvregningListe', [['brukernavn', brukernavn], ['passord', passord], ['idnr', idnr], ['fomdato', from], ['tomdato', to]], fetchImpl);
  } catch (err) {
    if (!(err instanceof HttpError) || !/dato/i.test(err.message)) throw err;
    doc = await soapCall('hentAvregningListe', [['brukernavn', brukernavn], ['passord', passord], ['idnr', idnr], ['fomdato', norwegianDate(from)], ['tomdato', norwegianDate(to)]], fetchImpl);
  }
  return children(child(doc, 'avrListe'), 'avregning')
    .map((a) => ({ avrnr: text(a, 'avrnr'), fiskerid: text(a, 'fiskerid'), regmrk: text(a, 'regmrk'), fartoynavn: text(a, 'fartoynavn'), seddelNr: text(a, 'seddelNr'), seddelDato: text(a, 'seddelDato').slice(0, 10) }))
    .filter((a) => /^[0-9]+$/.test(a.avrnr))
    .toSorted((a, b) => a.seddelDato.localeCompare(b.seddelDato) || a.avrnr.localeCompare(b.avrnr));
}

/**
 * Reads a trekkType element (navn, grunnlag, sats, belop).
 * @param {import('./xml.js').XmlNode | undefined} node
 * @param {string} key
 * @param {string} fallbackLabel
 * @param {DeductionGroup} group
 * @returns {Deduction | null}
 */
function trekk(node, key, fallbackLabel, group) {
  if (!node) return null;
  const minor = decMinor(text(node, 'belop'), key);
  if (minor === 0) return null;
  const navn = text(node, 'navn');
  const sats = text(node, 'sats');
  return { key, label: `${navn || fallbackLabel}${sats && rate(sats) ? ` ${sats} ${child(node, 'sats')?.attrs.enhet ?? ''}`.trimEnd() : ''}`, group, minor };
}

/** @param {import('./xml.js').XmlNode | undefined} node @param {string} field @returns {VatPart} */
function vatPart(node, field) {
  if (!node) return { baseMinor: 0, ratePct: 0, vatMinor: 0 };
  const baseMinor = decMinor(text(node, 'grunnlag'), `${field}/grunnlag`);
  const vatMinor = decMinor(text(node, 'belop'), `${field}/belop`);
  let ratePct = rate(text(node, 'sats'));
  if (!ratePct && vatMinor && baseMinor) ratePct = Math.round((vatMinor / baseMinor) * 100);
  return { baseMinor, ratePct, vatMinor };
}

/**
 * Parses one seddelavregning document (seddelavregning.xsd, urn:no:rafisklaget:seddel:avregning).
 * @param {import('./xml.js').XmlNode} doc
 * @returns {Settlement}
 */
export function parseSettlement(doc) {
  const s = find(doc, 'seddelavregning');
  if (!s) throw new HttpError(502, 'Råfisklaget returned no seddelavregning document.');
  const hode = child(s, 'hode');
  const fisker = child(hode, 'fisker');
  /** @type {Deduction[]} */
  const deductions = [];
  const lags = decMinor(text(s, 'lagsavgiftBelop'), 'lagsavgiftBelop');
  const lagsSats = text(s, 'lagsavgiftSats');
  if (lags !== 0) deductions.push({ key: 'lagsavgift', label: `Lagsavgift${lagsSats ? ` ${lagsSats} ${child(s, 'lagsavgiftSats')?.attrs.enhet ?? ''}`.trimEnd() : ''}`, group: 'lagsavgift', minor: lags });
  for (const [key, label, group] of /** @type {Array<[string, string, DeductionGroup]>} */ ([
    ['pensjonstrekk', 'Pensjonstrekk', 'pension'],
    ['produktavgift', 'Produktavgift', 'levy'],
    ['forskningsavgift', 'Forskningsavgift', 'levy'],
    ['kontrollavgift', 'Kontrollavgift', 'levy'],
    ['ressursavgift', 'Ressursavgift', 'levy'],
    ['sloyekostnad', 'Sløyekostnad', 'other'],
  ])) {
    const d = trekk(child(s, key), key, label, group);
    if (d) deductions.push(d);
  }
  children(child(s, 'medlemstrekk'), 'forbund').forEach((f, i) => {
    const minor = decMinor(text(f, 'belop'), 'medlemstrekk/forbund/belop');
    if (minor !== 0) deductions.push({ key: `medlemstrekk-${i + 1}`, label: text(f, 'navn') || 'Medlemstrekk', group: 'membership', minor });
  });
  children(child(s, 'egenandelstrekk'), 'egenandel').forEach((e, i) => {
    const d = trekk(e, `egenandel-${i + 1}`, 'Egenandel', 'other');
    if (d) deductions.push(d);
  });
  children(child(s, 'heftelser'), 'trekk').forEach((t, i) => {
    const minor = decMinor(text(t, 'belop'), 'heftelser/trekk/belop');
    if (minor !== 0) deductions.push({ key: `heftelse-${i + 1}`, label: `${text(t, 'navn') || 'Heftelse'} (trekk ${text(t, 'trekkNummer')})`, group: 'lien', minor });
  });
  const varelinjer = child(s, 'varelinjer');
  return {
    avrnr: text(hode, 'avregningsnr'),
    seddelnr: text(hode, 'sluttseddelnr'),
    salgsdato: text(hode, 'salgsdato').slice(0, 10),
    utbetalingsdato: text(hode, 'utbetalingsdato').slice(0, 10),
    test: s.attrs.test_indikator === 'TEST',
    avgiftsfritt: text(hode, 'avgiftsfritt') === 'JA',
    fisker: text(fisker, 'navn'),
    fiskerNr: text(fisker, 'nummer'),
    fartoy: [text(fisker, 'regmerke'), text(fisker, 'fartoyNavn')].filter(Boolean).join(' '),
    kjoper: text(child(hode, 'kjoper'), 'navn'),
    lines: children(varelinjer, 'linje').map((l) => ({ vare: [text(l, 'vare'), text(l, 'storrelse'), text(l, 'tilstand'), text(l, 'kvalitet')].filter(Boolean).join(' · '), kvantum: text(l, 'kvantum'), pris: text(l, 'pris'), belopMinor: decMinor(text(l, 'belop'), 'linje/belop') })),
    sumVareMinor: decMinor(text(varelinjer, 'sumVarebelop'), 'sumVarebelop'),
    deductions,
    utgMva: vatPart(child(s, 'utgMVA'), 'utgMVA'),
    inngMva: vatPart(child(s, 'inngMVA'), 'inngMVA'),
    sumMvaMinor: decMinor(text(s, 'sumMVA'), 'sumMVA'),
    payoutMinor: decMinor(text(s, 'tilUtbetaling'), 'tilUtbetaling'),
  };
}

/**
 * Fetches one settlement. Docs: hentAvregning (brukernavn, passord, avrnr) on the integrations page above,
 * response format seddelavregning.xsd.
 * @param {Record<string, string>} creds
 * @param {string} avrnr
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 */
async function fetchSettlement(creds, avrnr, fetchImpl) {
  const { brukernavn, passord } = credentials(creds);
  if (!/^[0-9]+$/.test(avrnr)) throw new HttpError(400, 'Invalid settlement number.');
  return parseSettlement(await soapCall('hentAvregning', [['brukernavn', brukernavn], ['passord', passord], ['avrnr', avrnr]], fetchImpl));
}

/**
 * Lists settlements for the period and reads up to MAX_SETTLEMENTS of them (four at a time).
 * Subrequests: one list call plus one call per settlement.
 * @param {Record<string, string>} creds `brukernavn`, `passord`, `idnr`, `from`, `to`
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<{ settlements: Settlement[], total: number }>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const list = await listSettlements(creds, fetchImpl);
  const wanted = list.slice(0, MAX_SETTLEMENTS);
  /** @type {Settlement[]} */
  const settlements = [];
  for (let i = 0; i < wanted.length; i += 4) {
    settlements.push(...(await Promise.all(wanted.slice(i, i + 4).map((a) => fetchSettlement(creds, a.avrnr, fetchImpl)))));
  }
  return { settlements, total: list.length };
}

/**
 * Builds the signed voucher lines for one settlement and checks that they balance against tilUtbetaling.
 * Input VAT (inngMVA) is placed on the one deduction whose amount equals its base.
 * @param {Settlement} s
 * @param {AccountMap} accounts
 * @returns {{ lines: VoucherLine[], problems: string[] }}
 */
export function buildVoucher(s, accounts) {
  /** @type {string[]} */
  const problems = [];
  const pfx = `${BRAND} avr. ${s.avrnr}`;
  /** @type {VoucherLine[]} */
  const lines = [{ account: accounts.payout, description: `${pfx} · Til utbetaling ${s.utbetalingsdato}`, signedMinor: s.payoutMinor, vat: 'none', ratePct: 0 }];
  const taxedBase = s.utgMva.vatMinor !== 0 ? s.utgMva.baseMinor : 0;
  if (taxedBase !== 0) lines.push({ account: accounts.sales, description: `${pfx} · Fangst ${s.utgMva.ratePct} % MVA`, signedMinor: -(taxedBase + s.utgMva.vatMinor), vat: 'output', ratePct: s.utgMva.ratePct });
  const untaxed = s.sumVareMinor - taxedBase;
  if (untaxed !== 0) lines.push({ account: accounts.sales, description: `${pfx} · Fangst uten MVA`, signedMinor: -untaxed, vat: 'output', ratePct: 0 });
  if (taxedBase !== 0 && (Math.sign(untaxed) === -Math.sign(s.sumVareMinor))) problems.push('The output VAT base is larger than the catch value.');
  const matches = s.inngMva.vatMinor !== 0 ? s.deductions.filter((d) => d.minor === s.inngMva.baseMinor) : [];
  if (s.inngMva.vatMinor !== 0 && matches.length === 0) problems.push(`Input VAT of ${formatMinor(s.inngMva.vatMinor)} has a base of ${formatMinor(s.inngMva.baseMinor)} that matches no deduction. Book this settlement manually.`);
  const vatOn = matches[0];
  for (const d of s.deductions) {
    const withVat = d === vatOn;
    lines.push({ account: accounts[d.group], description: `${pfx} · ${d.label}`, signedMinor: d.minor + (withVat ? s.inngMva.vatMinor : 0), vat: withVat ? 'input' : 'none', ratePct: withVat ? s.inngMva.ratePct : 0 });
  }
  const lineSum = s.lines.reduce((t, l) => t + l.belopMinor, 0);
  if (s.lines.length && lineSum !== s.sumVareMinor) problems.push(`The catch lines add up to ${formatMinor(lineSum)}, not the catch value ${formatMinor(s.sumVareMinor)}.`);
  if (s.sumMvaMinor !== s.utgMva.vatMinor - s.inngMva.vatMinor) problems.push(`sumMVA ${formatMinor(s.sumMvaMinor)} is not output VAT minus input VAT.`);
  const diff = lines.reduce((t, l) => t + l.signedMinor, 0);
  if (diff !== 0) problems.push(`Catch value, VAT and deductions differ from the payout by ${formatMinor(Math.abs(diff))} NOK.`);
  if (s.test) problems.push('This is a test settlement (test_indikator TEST).');
  for (const l of lines) if (!/^[0-9]{4}$/.test(l.account)) problems.push(`Account "${l.account}" is not a four digit account.`);
  return { lines: lines.filter((l) => l.signedMinor !== 0), problems };
}

/**
 * Picks a VAT-inclusive ReAI code for a rate (output or input).
 * @param {VatCode[]} codes
 * @param {'output' | 'input'} kind
 * @param {number} ratePct
 */
function vatCodeFor(codes, kind, ratePct) {
  const usable = codes.filter((c) => !c.reverseCharge && c.amountBasis === 'vat_inclusive' && Math.abs(c.rate - ratePct) < 0.001);
  const match = kind === 'input'
    ? usable.find((c) => c.vatType === 'input_vat')
    : ratePct > 0
      ? usable.find((c) => c.vatType === 'output_vat')
      : (usable.find((c) => c.vatType === 'output_vat') ?? usable.find((c) => c.vatType === 'exempt') ?? usable.find((c) => c.vatType === 'outside_scope'));
  if (!match) throw new HttpError(400, `ReAI has no ${kind} VAT code for ${ratePct} % in this company.`);
  return match.code;
}

/**
 * VAT that ReAI will split from a VAT-inclusive amount, to compare with Råfisklaget's figure.
 * @param {number} grossMinor @param {number} ratePct
 */
function reaiVatSplit(grossMinor, ratePct) {
  return ratePct > 0 ? grossMinor - Math.round((grossMinor * 100) / (100 + ratePct)) : 0;
}

/** @param {FormData | Record<string, string>} src @returns {AccountMap} */
function readAccounts(src) {
  const get = (/** @type {string} */ k) => (src instanceof FormData ? String(src.get(`acc_${k}`) ?? '') : String(src[`acc_${k}`] ?? '')).trim();
  /** @type {AccountMap} */
  const out = { ...DEFAULT_ACCOUNTS };
  for (const { key } of ACCOUNT_FIELDS) {
    const v = get(key);
    if (v) out[key] = v;
  }
  return out;
}

/** @param {Settlement} s @param {AccountMap} accounts @param {Record<string, string>} hidden @param {boolean} isSample */
function renderSettlement(s, accounts, hidden, isSample) {
  const { lines, problems } = buildVoucher(s, accounts);
  const warnings = [];
  if (s.utgMva.vatMinor !== 0 && reaiVatSplit(s.utgMva.baseMinor + s.utgMva.vatMinor, s.utgMva.ratePct) !== s.utgMva.vatMinor) warnings.push('ReAI splits the output VAT from the gross amount and gets a slightly different VAT figure than the settlement. Adjust the voucher in ReAI if needed.');
  const debit = lines.filter((l) => l.signedMinor > 0).reduce((t, l) => t + l.signedMinor, 0);
  const credit = lines.filter((l) => l.signedMinor < 0).reduce((t, l) => t - l.signedMinor, 0);
  const target = `${SLUG}-book-${s.avrnr}`;
  return reaiCard({
    eyebrow: `AVREGNING ${s.avrnr} · SLUTTSEDDEL ${s.seddelnr}`,
    title: `${s.salgsdato} · ${s.kjoper || 'Buyer'}${s.fartoy ? ` · ${s.fartoy}` : ''}`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : problems.length ? reaiBadge({ text: 'Needs attention', tone: 'danger' }) : reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Catch value', value: `${formatMinor(s.sumVareMinor)} NOK`, detail: `${s.lines.length} catch lines` })}
        ${reaiMetric({ label: 'Output VAT', value: `${formatMinor(s.utgMva.vatMinor)} NOK`, detail: s.avgiftsfritt ? 'Settlement marked VAT free' : `${s.utgMva.ratePct} %` })}
        ${reaiMetric({ label: 'Payout', value: `${formatMinor(s.payoutMinor)} NOK`, detail: s.utbetalingsdato })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Posting</th><th>VAT</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${lines.map((l) => html`<tr><td class="mono">${l.account}</td><td>${l.description}</td><td>${l.vat === 'none' ? '' : `${l.vat === 'output' ? 'Output' : 'Input'} ${l.ratePct} %`}</td><td class="num">${l.signedMinor > 0 ? formatMinor(l.signedMinor) : ''}</td><td class="num">${l.signedMinor < 0 ? formatMinor(-l.signedMinor) : ''}</td></tr>`)}
          <tr><td></td><td><strong>Total</strong></td><td></td><td class="num">${formatMinor(debit)}</td><td class="num">${formatMinor(credit)}</td></tr></tbody>
      </table></div>
      ${problems.length ? reaiCallout({ tone: 'warn', title: 'Not bookable as is', body: problems.join(' ') }) : ''}
      ${warnings.length ? reaiCallout({ tone: 'info', body: warnings.join(' ') }) : ''}
      ${isSample
        ? reaiCallout({ tone: 'info', body: 'Sample settlement loaded. Connect to ReAI and fetch your own settlements above to book them.' })
        : problems.length
          ? ''
          : html`<form class="stack-sm confirm-box" hx-post="${BASE_PATH}/book" hx-target="#${target}" hx-swap="innerHTML">
              ${Object.entries(hidden).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}">`)}
              <input type="hidden" name="avrnr" value="${s.avrnr}">
              <label class="check-row"><input type="checkbox" name="confirm" required> I checked this settlement against the PDF on Min side and will attach it in ReAI.</label>
              <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
            </form><div id="${target}" class="stack-sm"></div>`}
    `,
  });
}

/** @param {{ settlements: Settlement[], total: number }} r @param {AccountMap} accounts @param {Record<string, string>} hidden @param {boolean} isSample */
function renderPreview(r, accounts, hidden, isSample) {
  return html`
    ${r.settlements.length === 0 ? reaiCallout({ tone: 'info', body: 'Råfisklaget has no settlements for this period.' }) : ''}
    ${r.total > r.settlements.length ? reaiCallout({ tone: 'warn', body: `Showing the first ${r.settlements.length} of ${r.total} settlements. Choose a shorter period to see the rest.` }) : ''}
    ${r.settlements.map((s) => renderSettlement(s, accounts, hidden, isSample))}
    <p class="muted-note">Each settlement becomes one review voucher dated on the sales date. The payout is posted to the receivable account and is cleared when it reaches the bank. Input VAT is placed on the deduction whose amount equals its base.</p>`;
}

/**
 * Books one settlement as a ReAI review voucher after a duplicate check on the description marker.
 * Subrequests: one Råfisklaget call, then ReAI vouchers, VAT codes and accounts (in parallel) and the voucher.
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {{ token: string, tenantId: number }} auth
 * @param {Settlement} s
 * @param {AccountMap} accounts
 */
export async function bookSettlement(env, auth, s, accounts) {
  const { lines, problems } = buildVoucher(s, accounts);
  if (problems.length) throw new HttpError(400, problems.join(' '));
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s.salgsdato)) throw new HttpError(400, 'The settlement has no valid sales date.');
  const marker = `${BRAND} avregning ${s.avrnr}`;
  const unique = [...new Set(lines.map((l) => l.account))];
  const qs = new URLSearchParams(unique.map((a) => ['accountNumberPrefix', a]));
  qs.set('limit', '100');
  const [existing, vatCodes, accountRows] = await Promise.all([
    /** @type {Promise<Array<{ id: number, number: string, description?: string | null }>>} */ (reaiAll(env, '/api/vouchers', { ...auth, query: { startDate: s.salgsdato, endDate: s.salgsdato, includeReversed: 'true' } })),
    /** @type {Promise<VatCode[]>} */ (reaiRequest(env, '/api/vat-codes', auth)),
    /** @type {Promise<Array<{ number: string, accountNumber: string, restrictedToSystemUsage: boolean, subsidiaryLedger: unknown }>>} */ (reaiRequest(env, `/api/chart-of-accounts/accounts?${qs}`, auth)),
  ]);
  const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
  if (dup) return { duplicate: true, id: dup.id, number: dup.number };
  for (const a of unique) {
    const row = accountRows.find((r) => r.accountNumber === a || r.number === a);
    if (!row || row.restrictedToSystemUsage || row.subsidiaryLedger) throw new HttpError(400, `Account ${a} is missing, restricted or tied to a subledger in ReAI. Choose another account above.`);
  }
  const postings = pairVoucherRows(lines.map((l) => ({
    accountNumber: l.account,
    postingDate: s.salgsdato,
    currencyCode: 'NOK',
    amount: Number((l.signedMinor / 100).toFixed(2)),
    vatCode: l.vat === 'none' ? '0' : vatCodeFor(vatCodes, l.vat, l.ratePct),
    description: l.description.slice(0, 200),
  })));
  const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', {
    ...auth,
    method: 'POST',
    body: {
      date: s.salgsdato,
      description: `${marker} (sluttseddel ${s.seddelnr}, ${s.kjoper})`.slice(0, 250),
      reviewReason: `${BRAND} settlement imported via apps.reai.no. Attach the settlement PDF from Min side and check the deduction accounts.`,
      postings,
    },
  }));
  return { duplicate: false, id: created.id, number: created.number };
}

/** @param {string} label @param {string} name @param {string} value @param {string} [type] */
function field(label, name, value, type = 'text') {
  return html`<div class="field"><label for="rf-${name}">${label}</label><input id="rf-${name}" name="${name}" type="${type}" value="${value}"${type === 'password' ? html` autocomplete="off"` : ''} required></div>`;
}

/**
 * Handles /app/rafisklaget/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE_PATH && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE_PATH}/`, request.url), 301);
  if (pathname === `${BASE_PATH}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro"><p class="eyebrow">FISHING · FIRST-HAND SALES</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${SLUG}-web`, clientName: `ReAI ${BRAND} (Web)` })}
        ${reaiCard({
          eyebrow: 'RÅFISKLAGET SEDDELDATA WEB SERVICE',
          title: 'Fetch settlements',
          body: html`<p class="muted-note">Use the web service username and password Råfisklaget issues to fishers and accountants (apply on Min side or ask it-vakt@rafisklaget.no). They are used only for these requests and are never stored.</p>
            <form class="stack" hx-post="${BASE_PATH}/fetch-api" hx-target="#${SLUG}-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                ${field('Web service username', 'brukernavn', '')}
                ${field('Web service password', 'passord', '', 'password')}
                ${field('Fisher number or organisation number', 'idnr', '')}
                ${field('From sales date', 'from', `${today.slice(0, 7)}-01`, 'date')}
                ${field('To sales date', 'to', today, 'date')}
              </div>
              <details><summary>Accounts</summary><div class="mapping-grid">
                ${ACCOUNT_FIELDS.map((f) => field(f.label, `acc_${f.key}`, DEFAULT_ACCOUNTS[f.key]))}
              </div></details>
              <div class="inline-row">
                <button type="submit" class="button primary">Fetch from Råfisklaget</button>
                <button type="button" class="button secondary" hx-post="${BASE_PATH}/sample" hx-target="#${SLUG}-output" hx-swap="innerHTML">Load sample preview</button>
              </div>
            </form>`,
        })}
        <div id="${SLUG}-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderPreview({ settlements: [SAMPLE], total: 1 }, DEFAULT_ACCOUNTS, {}, true));
  try {
    const form = await request.formData();
    /** @type {Record<string, string>} */
    const creds = { brukernavn: String(form.get('brukernavn') ?? ''), passord: String(form.get('passord') ?? ''), idnr: String(form.get('idnr') ?? ''), from: String(form.get('from') ?? ''), to: String(form.get('to') ?? '') };
    const accounts = readAccounts(form);
    if (pathname === `${BASE_PATH}/fetch-api`) {
      /** @type {Record<string, string>} */
      const hidden = { brukernavn: creds.brukernavn ?? '', passord: creds.passord ?? '' };
      for (const { key } of ACCOUNT_FIELDS) hidden[`acc_${key}`] = accounts[key];
      return htmlResponse(renderPreview(await fetchApi(creds), accounts, hidden, false));
    }
    if (pathname === `${BASE_PATH}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('confirm') !== 'on') throw new HttpError(400, 'Confirm the verification checkbox first.');
      const tenant = session.tenants.find((t) => t.id === session.tenantId);
      if (tenant && tenant.currencyCode !== 'NOK') throw new HttpError(400, 'Råfisklaget settlements are in NOK. Choose a NOK company in ReAI.');
      const settlement = await fetchSettlement(creds, String(form.get('avrnr') ?? ''), fetch);
      const result = await bookSettlement(env, { token: session.accessToken, tenantId: session.tenantId }, settlement, accounts);
      const link = html`<a href="${reaiOrigin(env)}/voucher/${result.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${result.number} ↗</a>`;
      return htmlResponse(result.duplicate
        ? reaiCallout({ tone: 'warn', title: `Already booked (${result.number})`, body: html`This settlement is already in ReAI: ${link}.` })
        : reaiCallout({ tone: 'success', title: `Created review voucher ${result.number}`, body: html`Attach the settlement PDF in ReAI. ${link}.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
