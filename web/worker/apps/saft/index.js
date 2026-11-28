// @ts-check
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiRequest } from '../../lib/reai.js';
import { csvAttachment, formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../../lib/ui.js';
import { extractNorwegianOrg } from '../../lib/norway.js';

/**
 * SAF-T Financial (Norway) migration helper. No third-party API: the customer uploads the SAF-T
 * file exported from the old system (schema v1.30, v1.40 or v1.10,
 * https://github.com/Skatteetaten/saf-t), and the app writes to the ReAI public API.
 *
 * @typedef {{ accountId: string, description: string, closingMinor: number, sources: string[] }} SaftAccount
 * @typedef {{ accountId: string, closingMinor: number }} PartyBalance
 * @typedef {{ kind: 'customer' | 'supplier', id: string, name: string, orgnr: string, street: string, postalCode: string, city: string, country: string, balances: PartyBalance[] }} SaftParty
 * @typedef {{ companyName: string, orgnr: string, software: string, version: string, currency: string, endDate: string, accounts: SaftAccount[], skipped: string[], customers: SaftParty[], suppliers: SaftParty[], partyAccounts: string[] }} SaftFile
 * @typedef {{ endDate: string, currency: string, accounts: SaftAccount[], parties: SaftParty[], partyAccounts: string[] }} OpeningPayload
 * @typedef {{ id: number, name: string, number?: string | null, organizationNumber?: string | null }} ReaiParty
 */

const BASE_PATH = '/app/saft';
const MAX_CREATES_PER_ACTION = 30;

const SAMPLE_SAFT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<AuditFile xmlns="urn:StandardAuditFile-Taxation-Financial:NO">
  <Header>
    <AuditFileVersion>1.30</AuditFileVersion>
    <SoftwareCompanyName>Sample accounting system</SoftwareCompanyName>
    <Company><RegistrationNumber>935606403</RegistrationNumber><Name>Fjord Demo AS</Name></Company>
    <DefaultCurrencyCode>NOK</DefaultCurrencyCode>
    <SelectionCriteria><PeriodStart>1</PeriodStart><PeriodStartYear>2025</PeriodStartYear><PeriodEnd>12</PeriodEnd><PeriodEndYear>2025</PeriodEndYear></SelectionCriteria>
  </Header>
  <MasterFiles>
    <GeneralLedgerAccounts>
      <Account><AccountID>1500</AccountID><AccountDescription>Kundefordringer</AccountDescription><OpeningDebitBalance>125000.00</OpeningDebitBalance><ClosingDebitBalance>194000.00</ClosingDebitBalance></Account>
      <Account><AccountID>1920</AccountID><AccountDescription>Bankinnskudd drift</AccountDescription><OpeningDebitBalance>420500.00</OpeningDebitBalance><ClosingDebitBalance>685200.00</ClosingDebitBalance></Account>
      <Account><AccountID>2000</AccountID><AccountDescription>Aksjekapital</AccountDescription><OpeningCreditBalance>30000.00</OpeningCreditBalance><ClosingCreditBalance>30000.00</ClosingCreditBalance></Account>
      <Account><AccountID>2050</AccountID><AccountDescription>Annen egenkapital</AccountDescription><OpeningCreditBalance>431500.00</OpeningCreditBalance><ClosingCreditBalance>756700.00</ClosingCreditBalance></Account>
      <Account><AccountID>2400</AccountID><AccountDescription>Leverandørgjeld</AccountDescription><OpeningCreditBalance>84000.00</OpeningCreditBalance><ClosingCreditBalance>92500.00</ClosingCreditBalance></Account>
      <Account><AccountID>3000</AccountID><AccountDescription>Salgsinntekt</AccountDescription><OpeningDebitBalance>0.00</OpeningDebitBalance><ClosingDebitBalance>0.00</ClosingDebitBalance></Account>
    </GeneralLedgerAccounts>
    <Customers>
      <Customer><RegistrationNumber>923609016</RegistrationNumber><Name>Nordic Timber AS</Name><CustomerID>10001</CustomerID><BalanceAccount><AccountID>1500</AccountID><OpeningDebitBalance>100000.00</OpeningDebitBalance><ClosingDebitBalance>150000.00</ClosingDebitBalance></BalanceAccount></Customer>
      <Customer><Name>Kystverket Drift AS</Name><CustomerID>10002</CustomerID><BalanceAccount><AccountID>1500</AccountID><OpeningDebitBalance>25000.00</OpeningDebitBalance><ClosingDebitBalance>44000.00</ClosingDebitBalance></BalanceAccount></Customer>
    </Customers>
    <Suppliers>
      <Supplier><Name>Oslo Kontorrekvisita AS</Name><SupplierID>20001</SupplierID><BalanceAccount><AccountID>2400</AccountID><OpeningCreditBalance>84000.00</OpeningCreditBalance><ClosingCreditBalance>92500.00</ClosingCreditBalance></BalanceAccount></Supplier>
    </Suppliers>
  </MasterFiles>
</AuditFile>`;

/** @param {string} s */
function decodeXml(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

/** Element regex for an exact tag name with an optional namespace prefix. @param {string} tag @param {string} flags */
function tagRe(tag, flags) {
  return new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z_][\\w.-]*:)?${tag}\\s*>`, flags);
}

/** First element text (exact tag name). @param {string} xml @param {string} tag */
function xmlTag(xml, tag) {
  const m = tagRe(tag, 'i').exec(xml);
  return m?.[1] ? decodeXml(m[1].replace(/<[^>]+>/g, '')).trim() : '';
}

/** All element bodies (exact tag name). @param {string} xml @param {string} tag */
function xmlBlocks(xml, tag) {
  return [...xml.matchAll(tagRe(tag, 'gi'))].map((m) => m[1] ?? '');
}

/** SAF-T monetary text to integer minor units. @param {string} v */
function minor(v) {
  const n = Number(v.replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Signed closing balance (debit positive) of an Account or BalanceAccount body. @param {string} blk */
function closingMinor(blk) {
  return minor(xmlTag(blk, 'ClosingDebitBalance') || '0') - minor(xmlTag(blk, 'ClosingCreditBalance') || '0');
}

/** @param {number} year @param {number} month */
function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/**
 * Parses the parts of a Norwegian SAF-T Financial file the migration needs.
 * @param {string} xml
 * @returns {SaftFile}
 */
export function parseSaftXml(xml) {
  if (!/<(?:[\w.-]+:)?AuditFile[\s>]/.test(xml)) throw new HttpError(400, 'This is not a SAF-T Financial file. Export SAF-T Financial (XML) from the old accounting system.');
  const header = xmlBlocks(xml, 'Header')[0] ?? '';
  const company = xmlBlocks(header, 'Company')[0] ?? '';
  const selection = xmlBlocks(header, 'SelectionCriteria')[0] ?? '';
  const endYear = Number(xmlTag(selection, 'PeriodEndYear') || xmlTag(selection, 'PeriodStartYear'));
  const endPeriod = Math.min(12, Math.max(1, Number(xmlTag(selection, 'PeriodEnd') || '12')));
  const selectionEnd = xmlTag(selection, 'SelectionEndDate');
  const endDate = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(selectionEnd) ? selectionEnd : endYear > 1900 ? lastDayOfMonth(endYear, endPeriod) : '';
  if (!endDate) throw new HttpError(400, 'The SAF-T file has no selection period in its header.');

  const masterFiles = xmlBlocks(xml, 'MasterFiles')[0] ?? '';
  /** @type {Map<string, SaftAccount>} */
  const byAccount = new Map();
  /** @type {string[]} */
  const skipped = [];
  for (const blk of xmlBlocks(xmlBlocks(masterFiles, 'GeneralLedgerAccounts')[0] ?? '', 'Account')) {
    const id = xmlTag(blk, 'AccountID');
    const standard = xmlTag(blk, 'StandardAccountID');
    const target = /^[0-9]{4}$/.test(id) ? id : /^[0-9]{4}$/.test(standard) ? standard : '';
    const closing = closingMinor(blk);
    if (!target) {
      if (closing !== 0) skipped.push(id);
      continue;
    }
    const existing = byAccount.get(target);
    if (existing) {
      existing.closingMinor += closing;
      existing.sources.push(id);
    } else {
      byAccount.set(target, { accountId: target, description: xmlTag(blk, 'AccountDescription'), closingMinor: closing, sources: [id] });
    }
  }

  /** @param {'customer' | 'supplier'} kind @param {string} blk @returns {SaftParty} */
  const party = (kind, blk) => {
    const address = xmlBlocks(blk, 'Address')[0] ?? '';
    const country = xmlTag(address, 'Country').toUpperCase();
    return {
      kind,
      id: xmlTag(blk, kind === 'customer' ? 'CustomerID' : 'SupplierID'),
      name: xmlTag(blk, 'Name'),
      orgnr: country === '' || country === 'NO' ? extractNorwegianOrg(xmlTag(blk, 'RegistrationNumber')) : '',
      street: [xmlTag(address, 'StreetName'), xmlTag(address, 'Number')].filter(Boolean).join(' '),
      postalCode: xmlTag(address, 'PostalCode'),
      city: xmlTag(address, 'City'),
      country: /^[A-Z]{2}$/.test(country) ? country : '',
      balances: xmlBlocks(blk, 'BalanceAccount').map((b) => ({ accountId: xmlTag(b, 'AccountID'), closingMinor: closingMinor(b) })),
    };
  };
  const customers = xmlBlocks(xmlBlocks(masterFiles, 'Customers')[0] ?? '', 'Customer').map((b) => party('customer', b)).filter((p) => p.name);
  const suppliers = xmlBlocks(xmlBlocks(masterFiles, 'Suppliers')[0] ?? '', 'Supplier').map((b) => party('supplier', b)).filter((p) => p.name);
  const partyAccounts = [...new Set([...customers, ...suppliers].flatMap((p) => p.balances.map((b) => b.accountId)).filter(Boolean))];
  for (const p of [...customers, ...suppliers]) p.balances = p.balances.filter((b) => b.closingMinor !== 0);

  return {
    companyName: xmlTag(company, 'Name') || 'Unknown company',
    orgnr: extractNorwegianOrg(xmlTag(company, 'RegistrationNumber')),
    software: xmlTag(header, 'SoftwareCompanyName') || 'SAF-T Financial',
    version: xmlTag(header, 'AuditFileVersion'),
    currency: (xmlTag(header, 'DefaultCurrencyCode') || 'NOK').toUpperCase(),
    endDate,
    accounts: [...byAccount.values()].sort((a, b) => a.accountId.localeCompare(b.accountId)),
    skipped,
    customers,
    suppliers,
    partyAccounts,
  };
}

/** Balance sheet accounts (classes 1 and 2) with a closing balance. @param {SaftAccount[]} accounts */
function balanceSheet(accounts) {
  return accounts.filter((a) => /^[12]/.test(a.accountId) && a.closingMinor !== 0);
}

/** @param {string} s */
function norm(s) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Finds the ReAI customer or supplier for a SAF-T party: number, then organization number, then exact name.
 * @param {SaftParty} p
 * @param {ReaiParty[]} list
 */
function matchParty(p, list) {
  return (p.id ? list.find((r) => r.number === p.id) : undefined)
    ?? (p.orgnr ? list.find((r) => (r.organizationNumber ?? '').replace(/\s+/g, '') === p.orgnr) : undefined)
    ?? list.find((r) => norm(r.name) === norm(p.name));
}

/**
 * Builds the ReAI opening balance lines from the SAF-T closing balances. Customer and supplier ledger
 * accounts are split per party (`account/{id}`), bank and fixed asset accounts get their ReAI
 * subsidiary when exactly one matches, and every other balance sheet account is posted as is.
 * Pure function so it can be checked without network access.
 * @param {OpeningPayload} payload
 * @param {{ customers: ReaiParty[], suppliers: ReaiParty[], banks: Array<{ id: number, ledgerAccountNumber: string, archived?: boolean }>, assets: Array<{ id: number, accountNumber: string }> }} reai
 */
export function buildOpeningLines(payload, reai) {
  const bs = balanceSheet(payload.accounts);
  /** @type {Array<{ account: string, minor: number, description: string }>} */
  const lines = [];
  /** @type {string[]} */
  const problems = [];
  const partyAccounts = new Set([...payload.partyAccounts, ...payload.parties.flatMap((p) => p.balances.map((b) => b.accountId))]);
  for (const a of bs) {
    if (partyAccounts.has(a.accountId)) {
      const members = payload.parties.flatMap((p) => p.balances.filter((b) => b.accountId === a.accountId).map((b) => ({ p, b })));
      const sum = members.reduce((s, m) => s + m.b.closingMinor, 0);
      if (sum !== a.closingMinor) {
        problems.push(`Customer and supplier balances on account ${a.accountId} add up to ${formatMinor(sum)}, but the account shows ${formatMinor(a.closingMinor)}. Export SAF-T again with balances per customer and supplier.`);
        continue;
      }
      /** @type {string[]} */
      const missing = [];
      for (const { p, b } of members) {
        const match = matchParty(p, p.kind === 'customer' ? reai.customers : reai.suppliers);
        if (!match) {
          missing.push(p.name);
          continue;
        }
        lines.push({ account: `${a.accountId}/${match.id}`, minor: b.closingMinor, description: `IB ${p.kind === 'customer' ? 'kunde' : 'leverandør'} ${p.id} ${p.name}` });
      }
      if (missing.length) problems.push(`Import these ${missing.length === 1 ? 'party' : 'parties'} on account ${a.accountId} into ReAI first: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' and more' : ''}.`);
      continue;
    }
    const banks = reai.banks.filter((b) => !b.archived && b.ledgerAccountNumber === a.accountId);
    if (banks.length > 1) {
      problems.push(`ReAI has several bank accounts on ledger account ${a.accountId}. Enter this opening balance per bank account in ReAI.`);
      continue;
    }
    const assets = /^1[0-2]/.test(a.accountId) ? reai.assets.filter((x) => x.accountNumber === a.accountId) : [];
    if (/^1[0-2]/.test(a.accountId) && assets.length !== 1) {
      problems.push(`Account ${a.accountId} is a fixed asset account. ${assets.length === 0 ? 'Register the asset in ReAI first' : 'ReAI has several assets on it, so enter this balance per asset in ReAI'}.`);
      continue;
    }
    const sub = banks[0] ? `/${banks[0].id}` : assets[0] ? `/${assets[0].id}` : '';
    lines.push({ account: `${a.accountId}${sub}`, minor: a.closingMinor, description: `IB ${a.accountId} ${a.description}` });
  }
  const residual = bs.reduce((s, a) => s + a.closingMinor, 0);
  if (residual !== 0) {
    problems.unshift(`The balance sheet accounts do not balance (difference ${formatMinor(residual)}). Close the year in the old system so the result is moved to equity, then export SAF-T again.`);
  }
  const postingLines = lines.map((l, i) => ({
    rowNumber: i,
    ...(l.minor > 0 ? { debitAccount: l.account } : { creditAccount: l.account }),
    amount: Math.abs(l.minor) / 100,
    description: l.description.slice(0, 200),
  }));
  return { postingLines, problems };
}

/** @param {SaftFile} parsed @param {boolean} isSample */
function renderSaft(parsed, isSample) {
  const bs = balanceSheet(parsed.accounts);
  const residual = bs.reduce((s, a) => s + a.closingMinor, 0);
  const parties = [...parsed.customers, ...parsed.suppliers];
  const csvRows = [['Account', 'Description', 'ClosingBalance'], ...parsed.accounts.map((a) => [a.accountId, a.description, (a.closingMinor / 100).toFixed(2)])];
  /** @type {OpeningPayload} */
  const payload = { endDate: parsed.endDate, currency: parsed.currency, accounts: parsed.accounts, parties: parties.filter((p) => p.balances.length > 0), partyAccounts: parsed.partyAccounts };
  /** @type {SaftParty[]} */
  const importable = parties.map(({ balances: _b, ...p }) => ({ ...p, balances: [] }));
  return html`
    ${reaiCard({
      eyebrow: 'SAF-T FINANCIAL SUMMARY',
      title: `${parsed.companyName}${parsed.orgnr ? ` (${parsed.orgnr})` : ''} · closing balances ${parsed.endDate}`,
      badge: isSample ? reaiBadge({ text: 'Sample SAF-T', tone: 'accent' }) : reaiBadge({ text: `${parsed.software}${parsed.version ? ` · v${parsed.version}` : ''}`, tone: 'success' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Balance sheet accounts', value: String(bs.length), detail: `with a closing balance, in ${parsed.currency}` })}
          ${reaiMetric({ label: 'Customers', value: String(parsed.customers.length) })}
          ${reaiMetric({ label: 'Suppliers', value: String(parsed.suppliers.length) })}
        </div>
        ${residual !== 0 ? reaiCallout({ tone: 'warn', body: `The balance sheet accounts do not balance (difference ${formatMinor(residual)}). Close the year in the old system so the result is moved to equity, then export SAF-T again.` }) : ''}
        ${parsed.skipped.length ? reaiCallout({ tone: 'warn', body: `These accounts are not four digit NS 4102 accounts and were left out: ${parsed.skipped.slice(0, 20).join(', ')}. Enter their balances in ReAI by hand.` }) : ''}
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Account</th><th>Description</th><th class="num">Closing (${parsed.currency})</th></tr></thead>
          <tbody>${parsed.accounts.filter((a) => a.closingMinor !== 0).slice(0, 200).map((a) => html`<tr><td class="mono">${a.accountId}</td><td>${a.description}</td><td class="num">${formatMinor(a.closingMinor)}</td></tr>`)}</tbody>
        </table></div>
        <div class="inline-row">
          <form method="post" action="${BASE_PATH}/export"><input type="hidden" name="rowsJson" value="${JSON.stringify(csvRows)}"><button type="submit" class="button secondary">Download balances CSV</button></form>
        </div>
        ${isSample
          ? reaiCallout({ tone: 'info', body: 'Sample file loaded. Connect to ReAI and upload your own SAF-T file to import.' })
          : html`<form class="stack-sm confirm-box" hx-post="${BASE_PATH}/push-opening-balance" hx-target="#saft-ob-result" hx-swap="innerHTML">
              <input type="hidden" name="payloadJson" value="${JSON.stringify(payload)}">
              <p class="muted-note">The opening balance is dated ${parsed.endDate}, the last day of the SAF-T period. Customer and supplier balances are posted per party, so import the parties below first.</p>
              <label class="check-row"><input type="checkbox" name="replace"> Replace the opening balance already saved in ReAI, if any.</label>
              <div><button type="submit" class="button primary">Save opening balance in ReAI</button></div>
            </form><div id="saft-ob-result" class="stack-sm"></div>`}
      `,
    })}
    ${reaiCard({
      eyebrow: 'CUSTOMERS AND SUPPLIERS',
      title: `${parties.length} parties in the file`,
      body: html`<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Type</th><th>ID</th><th>Name</th><th>Org.nr</th><th class="num">Balance</th></tr></thead>
          <tbody>${parties.slice(0, 200).map((p) => html`<tr><td>${reaiBadge({ text: p.kind, tone: p.kind === 'customer' ? 'accent' : 'neutral' })}</td><td class="mono">${p.id || '—'}</td><td><strong>${p.name}</strong></td><td class="mono">${p.orgnr || '—'}</td><td class="num">${formatMinor(p.balances.reduce((s, b) => s + b.closingMinor, 0))}</td></tr>`)}</tbody>
        </table></div>
        ${parties.length > 200 ? html`<p class="muted-note">Showing the first 200.</p>` : ''}
        ${isSample || parties.length === 0
          ? ''
          : html`<form class="stack-sm" hx-post="${BASE_PATH}/import-parties" hx-target="#saft-party-result" hx-swap="innerHTML">
              <input type="hidden" name="partiesJson" value="${JSON.stringify(importable)}">
              <p class="muted-note">Creates the customers and suppliers ReAI does not have yet, matched by number, organization number or name. Up to ${MAX_CREATES_PER_ACTION} are created per click; click again until none are left.</p>
              <div><button type="submit" class="button primary">Import missing customers and suppliers</button></div>
            </form><div id="saft-party-result" class="stack-sm"></div>`}`,
    })}
  `;
}

/** @param {unknown} raw @returns {OpeningPayload} */
function readPayload(raw) {
  const p = /** @type {OpeningPayload} */ (JSON.parse(String(raw ?? '{}')));
  if (!p || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(p.endDate)) || !Array.isArray(p.accounts) || !Array.isArray(p.parties) || !Array.isArray(p.partyAccounts)) throw new HttpError(400, 'Upload the SAF-T file again.');
  return p;
}

/**
 * Saves the SAF-T closing balances as the ReAI opening balance.
 * Subrequests: GET opening balance, company banks, assets, customers and suppliers (200 per page), then one PUT.
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {{ token: string, tenantId: number, tenantCurrency: string }} auth
 * @param {OpeningPayload} payload
 * @param {boolean} replace
 */
export async function pushOpeningBalance(env, auth, payload, replace) {
  if (payload.currency !== auth.tenantCurrency) throw new HttpError(400, `The SAF-T file is in ${payload.currency}, but the ReAI company uses ${auth.tenantCurrency}.`);
  const a = { token: auth.token, tenantId: auth.tenantId };
  let exists = true;
  try {
    await reaiRequest(env, '/api/opening-balance', a);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) exists = false;
    else throw err;
  }
  if (exists && !replace) throw new HttpError(409, 'This ReAI company already has an opening balance. Tick replace to overwrite it.');
  const needsParties = payload.parties.some((p) => p.balances.length > 0);
  const needsAssets = balanceSheet(payload.accounts).some((x) => /^1[0-2]/.test(x.accountId));
  const [banks, assets, customers, suppliers] = await Promise.all([
    /** @type {Promise<Array<{ id: number, ledgerAccountNumber: string, archived?: boolean }>>} */ (reaiRequest(env, '/api/company-banks', a)),
    needsAssets ? reaiRequest(env, '/api/assets', a).then((r) => /** @type {Array<{ id: number, accountNumber: string }>} */ (Array.isArray(r) ? r : (/** @type {any} */ (r)?.items ?? []))) : Promise.resolve([]),
    needsParties && payload.parties.some((p) => p.kind === 'customer') ? /** @type {Promise<ReaiParty[]>} */ (reaiAll(env, '/api/customers', a)) : Promise.resolve([]),
    needsParties && payload.parties.some((p) => p.kind === 'supplier') ? /** @type {Promise<ReaiParty[]>} */ (reaiAll(env, '/api/suppliers', a)) : Promise.resolve([]),
  ]);
  const { postingLines, problems } = buildOpeningLines(payload, { banks, assets, customers, suppliers });
  if (problems.length) throw new HttpError(400, problems.join(' '));
  if (postingLines.length === 0) throw new HttpError(400, 'The SAF-T file has no balance sheet balances to post.');
  return /** @type {{ id: number, number: string, webUrl: string }} */ (await reaiRequest(env, '/api/opening-balance', {
    ...a,
    method: 'PUT',
    body: { voucherDate: payload.endDate, voucherDescription: 'Opening balance from SAF-T imported via apps.reai.no', postingLines },
  }));
}

/**
 * Creates the customers and suppliers ReAI does not have yet (bounded per action).
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {{ token: string, tenantId: number }} auth
 * @param {SaftParty[]} parties
 */
export async function importParties(env, auth, parties) {
  const [customers, suppliers] = await Promise.all([
    parties.some((p) => p.kind === 'customer') ? /** @type {Promise<ReaiParty[]>} */ (reaiAll(env, '/api/customers', auth)) : Promise.resolve([]),
    parties.some((p) => p.kind === 'supplier') ? /** @type {Promise<ReaiParty[]>} */ (reaiAll(env, '/api/suppliers', auth)) : Promise.resolve([]),
  ]);
  const missing = parties.filter((p) => p.name && !matchParty(p, p.kind === 'customer' ? customers : suppliers));
  const batch = missing.slice(0, MAX_CREATES_PER_ACTION);
  for (const p of batch) {
    await reaiRequest(env, p.kind === 'supplier' ? '/api/suppliers' : '/api/customers', {
      ...auth,
      method: 'POST',
      body: {
        name: p.name.slice(0, 75),
        privateContact: false,
        skipRegistryLookup: true,
        ...(p.id ? { number: p.id.slice(0, 50) } : {}),
        ...(p.orgnr ? { organizationNumber: p.orgnr } : {}),
        ...(p.country ? { countryCode: p.country } : {}),
        ...(p.street ? { addressPart1: p.street } : {}),
        ...(p.postalCode ? { postalCode: p.postalCode } : {}),
        ...(p.city ? { city: p.city } : {}),
      },
    });
  }
  return { created: batch.length, remaining: missing.length - batch.length };
}

/**
 * Handles /app/saft/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const title = 'SAF-T Migration to ReAI';
  const lead = 'Upload the SAF-T Financial file from your old accounting system to import customers and suppliers into ReAI and save the closing balances as the ReAI opening balance.';

  if (pathname === BASE_PATH && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE_PATH}/`, request.url), 301);
  if (pathname === `${BASE_PATH}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">SWITCH ACCOUNTING SYSTEM</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-saft-web', clientName: 'ReAI SAF-T Norway (Web)' })}
        ${reaiCard({
          eyebrow: 'UPLOAD SAF-T FINANCIAL XML',
          title: 'Read the file from the old system',
          body: html`<form class="stack" hx-post="${BASE_PATH}/preview" hx-encoding="multipart/form-data" hx-target="#mg-output" hx-swap="innerHTML">
            ${reaiDropzone({ inputId: 'saft-xml', name: 'file', accept: '.xml,text/xml,application/xml', label: 'Choose SAF-T XML file', hint: 'SAF-T Financial for the last closed year, exported from the old accounting system.' })}
            <div class="inline-row">
              <button type="submit" class="button primary">Read SAF-T file</button>
              <button type="button" class="button secondary" hx-post="${BASE_PATH}/sample" hx-target="#mg-output" hx-swap="innerHTML">Load sample SAF-T file</button>
            </div>
          </form>`,
        })}
        <div id="mg-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${BASE_PATH}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  try {
    if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderSaft(parseSaftXml(SAMPLE_SAFT_XML), true));
    const form = await request.formData();
    if (pathname === `${BASE_PATH}/export`) {
      const rows = /** @type {string[][]} */ (JSON.parse(String(form.get('rowsJson') ?? '[]')));
      return csvAttachment('saft-balances.csv', rows);
    }
    if (pathname === `${BASE_PATH}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a SAF-T XML file or load the sample.');
      return htmlResponse(renderSaft(parseSaftXml(new TextDecoder('utf-8').decode(await file.arrayBuffer())), false));
    }

    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    const auth = { token: session.accessToken, tenantId: session.tenantId };

    if (pathname === `${BASE_PATH}/push-opening-balance`) {
      const tenantCurrency = session.tenants.find((t) => t.id === session.tenantId)?.currencyCode ?? 'NOK';
      const res = await pushOpeningBalance(env, { ...auth, tenantCurrency }, readPayload(form.get('payloadJson')), form.get('replace') === 'on');
      return htmlResponse(reaiCallout({ tone: 'success', title: `Opening balance saved (${res.number})`, body: html`<a href="${res.webUrl}" target="_blank" rel="noopener">Open in ReAI ↗</a>` }));
    }
    if (pathname === `${BASE_PATH}/import-parties`) {
      const parties = /** @type {SaftParty[]} */ (JSON.parse(String(form.get('partiesJson') ?? '[]')));
      if (!Array.isArray(parties)) throw new HttpError(400, 'Upload the SAF-T file again.');
      const r = await importParties(env, auth, parties);
      return htmlResponse(reaiCallout({
        tone: r.remaining ? 'warn' : 'success',
        title: `Created ${r.created} ${r.created === 1 ? 'party' : 'parties'} in ReAI`,
        body: r.remaining ? `${r.remaining} left. Click import again.` : 'All customers and suppliers in the file are now in ReAI.',
      }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'SAF-T import error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown SAF-T route.', 404);
}
