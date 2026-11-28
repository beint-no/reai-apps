// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiOrigin, reaiRequest } from '../lib/reai.js';
import { csvAttachment, formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { extractNorwegianOrg } from './recman-core.js';

/**
 * @typedef {{ accountId: string, description: string, openingBalance: number, closingBalance: number }} SaftAccount
 * @typedef {{ id: string, name: string, orgnr: string, kind: 'customer' | 'supplier' }} SaftParty
 */

const SAMPLE_SAFT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<AuditFile>
  <Header>
    <Company><Name>Fjord Demo AS</Name><RegistrationNumber>935606403</RegistrationNumber></Company>
    <SoftwareCompanyName>Tripletex / Fiken / PowerOffice Go</SoftwareCompanyName>
    <SelectionCriteria><PeriodStart>1</PeriodStart><PeriodEnd>12</PeriodEnd><PeriodStartYear>2026</PeriodStartYear></SelectionCriteria>
  </Header>
  <MasterFiles>
    <GeneralLedgerAccounts>
      <Account><AccountID>1920</AccountID><AccountDescription>Bankinnskudd drift</AccountDescription><OpeningDebitBalance>420500.00</OpeningDebitBalance><ClosingDebitBalance>685200.00</ClosingDebitBalance></Account>
      <Account><AccountID>1500</AccountID><AccountDescription>Kundefordringer</AccountDescription><OpeningDebitBalance>125000.00</OpeningDebitBalance><ClosingDebitBalance>194000.00</ClosingDebitBalance></Account>
      <Account><AccountID>2400</AccountID><AccountDescription>Leverandørgjeld</AccountDescription><OpeningCreditBalance>84000.00</OpeningCreditBalance><ClosingCreditBalance>92500.00</ClosingCreditBalance></Account>
      <Account><AccountID>2000</AccountID><AccountDescription>Aksjekapital</AccountDescription><OpeningCreditBalance>30000.00</OpeningCreditBalance><ClosingCreditBalance>30000.00</ClosingCreditBalance></Account>
    </GeneralLedgerAccounts>
    <Customers>
      <Customer><CustomerID>10001</CustomerID><Name>Nordic Timber AS</Name><RegistrationNumber>935606403</RegistrationNumber></Customer>
      <Customer><CustomerID>10002</CustomerID><Name>Kystverket Drift AS</Name><RegistrationNumber>923609016</RegistrationNumber></Customer>
    </Customers>
    <Suppliers>
      <Supplier><SupplierID>20001</SupplierID><Name>Oslo Kontorrekvisita AS</Name><RegistrationNumber>935606403</RegistrationNumber></Supplier>
    </Suppliers>
  </MasterFiles>
</AuditFile>`;

/** @param {string} xml @param {string} tag */
function xmlTag(xml, tag) {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return m?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';
}

/** @param {string} xml @param {string} tag */
function xmlBlocks(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  /** @type {string[]} */
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) if (m[1]) out.push(m[1]);
  return out;
}

/** @param {string} xml */
function parseSaftXml(xml) {
  const header = xmlBlocks(xml, 'Header')[0] ?? xml;
  const companyName = xmlTag(xmlBlocks(header, 'Company')[0] ?? header, 'Name') || 'Norwegian Company';
  const orgnr = extractNorwegianOrg(xmlTag(xmlBlocks(header, 'Company')[0] ?? header, 'RegistrationNumber'));
  const software = xmlTag(header, 'SoftwareCompanyName') || 'SAF-T Financial';
  const year = xmlTag(header, 'PeriodStartYear') || String(new Date().getUTCFullYear());

  /** @type {SaftAccount[]} */
  const accounts = xmlBlocks(xml, 'Account')
    .map((blk) => ({
      accountId: xmlTag(blk, 'AccountID'),
      description: xmlTag(blk, 'AccountDescription'),
      openingBalance: (Number(xmlTag(blk, 'OpeningDebitBalance')) || 0) - (Number(xmlTag(blk, 'OpeningCreditBalance')) || 0),
      closingBalance: (Number(xmlTag(blk, 'ClosingDebitBalance')) || 0) - (Number(xmlTag(blk, 'ClosingCreditBalance')) || 0),
    }))
    .filter((a) => /^[0-9]{4}$/.test(a.accountId));

  /** @type {SaftParty[]} */
  const customers = xmlBlocks(xml, 'Customer')
    .map((blk) => ({ id: xmlTag(blk, 'CustomerID'), name: xmlTag(blk, 'Name'), orgnr: extractNorwegianOrg(xmlTag(blk, 'RegistrationNumber')), kind: /** @type {'customer'} */ ('customer') }))
    .filter((c) => c.name.length > 0);

  /** @type {SaftParty[]} */
  const suppliers = xmlBlocks(xml, 'Supplier')
    .map((blk) => ({ id: xmlTag(blk, 'SupplierID'), name: xmlTag(blk, 'Name'), orgnr: extractNorwegianOrg(xmlTag(blk, 'RegistrationNumber')), kind: /** @type {'supplier'} */ ('supplier') }))
    .filter((s) => s.name.length > 0);

  return { companyName, orgnr, software, year, accounts, customers, suppliers };
}

/** @param {ReturnType<typeof parseSaftXml>} parsed @param {boolean} isSample */
function renderSaft(parsed, isSample) {
  const csvRows = [['Account', 'Description', 'OpeningBalance', 'ClosingBalance'], ...parsed.accounts.map((a) => [a.accountId, a.description, a.openingBalance.toFixed(2), a.closingBalance.toFixed(2)])];
  return html`
    ${reaiCard({
      eyebrow: 'SAF-T FINANCIAL SUMMARY',
      title: `${parsed.companyName}${parsed.orgnr ? ` (${parsed.orgnr})` : ''} · FY ${parsed.year}`,
      badge: isSample ? reaiBadge({ text: 'Sample SAF-T', tone: 'accent' }) : reaiBadge({ text: parsed.software, tone: 'success' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'NS 4102 Accounts', value: String(parsed.accounts.length), detail: 'Ready for ReAI opening balance' })}
          ${reaiMetric({ label: 'Customers found', value: String(parsed.customers.length), detail: '1-click import to /api/customers' })}
          ${reaiMetric({ label: 'Suppliers found', value: String(parsed.suppliers.length), detail: '1-click import to /api/suppliers' })}
        </div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Account</th><th>Description</th><th class="num">Opening (NOK)</th><th class="num">Closing (NOK)</th></tr></thead>
          <tbody>${parsed.accounts.slice(0, 100).map((a) => html`<tr><td class="mono">${a.accountId}</td><td>${a.description}</td><td class="num">${formatMinor(Math.round(a.openingBalance * 100))}</td><td class="num">${formatMinor(Math.round(a.closingBalance * 100))}</td></tr>`)}</tbody>
        </table></div>
        <div class="inline-row">
          <form method="post" action="/app/saft/export"><input type="hidden" name="rowsJson" value="${JSON.stringify(csvRows)}"><button type="submit" class="button secondary">Download Opening Balance CSV ↓</button></form>
          ${!isSample && parsed.accounts.length > 0
            ? html`<form hx-post="/app/saft/push-opening-balance" hx-target="#saft-ob-result" hx-swap="innerHTML">
                <input type="hidden" name="year" value="${parsed.year}"><input type="hidden" name="accountsJson" value="${JSON.stringify(parsed.accounts)}">
                <button type="submit" class="button primary">Push closing balances to ReAI Opening Balance →</button>
              </form>`
            : ''}
        </div>
        <div id="saft-ob-result" class="stack-sm"></div>
      `,
    })}
    ${reaiCard({
      eyebrow: 'CUSTOMERS & SUPPLIERS FROM SAF-T',
      title: `${parsed.customers.length + parsed.suppliers.length} master-data parties ready`,
      body: html`<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Type</th><th>ID</th><th>Name</th><th>Org.nr</th><th>Action</th></tr></thead>
        <tbody>${[...parsed.customers, ...parsed.suppliers].slice(0, 100).map(
          (p, idx) => html`<tr id="sf-p-${idx}">
            <td>${reaiBadge({ text: p.kind, tone: p.kind === 'customer' ? 'accent' : 'neutral' })}</td>
            <td class="mono">${p.id || '—'}</td><td><strong>${p.name}</strong></td><td class="mono">${p.orgnr || '—'}</td>
            <td>${isSample || !p.orgnr
              ? html`<span class="muted-note">${isSample ? 'Demo only' : 'Needs valid NO org.nr'}</span>`
              : html`<form hx-post="/app/saft/import-party" hx-target="#sf-p-${idx}" hx-swap="outerHTML">
                  <input type="hidden" name="kind" value="${p.kind}"><input type="hidden" name="name" value="${p.name}">
                  <input type="hidden" name="orgnr" value="${p.orgnr}"><input type="hidden" name="number" value="${p.id}">
                  <button type="submit" class="button primary">Import to ReAI</button>
                </form>`}</td>
          </tr>`,
        )}</tbody>
      </table></div>`,
    })}
  `;
}

/**
 * Handles /app/saft/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/saft';
  const title = 'SAF-T Financial Migration & Opening Balance Tool';
  const lead = 'Upload a Norwegian SAF-T Financial XML export from Tripletex, Fiken, PowerOffice Go, Visma or Conta to inspect NS 4102 closing balances, import customers & suppliers into ReAI, and push opening balances.';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">SWITCH FROM TRIPLETEX / FIKEN / POWEROFFICE / VISMA</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-saft-web', clientName: 'ReAI SAF-T Norway (Web)' })}
        ${reaiCard({
          eyebrow: 'UPLOAD NORWEGIAN SAF-T FINANCIAL XML',
          title: 'Inspect & migrate from any Norwegian accounting system',
          body: html`<form class="stack" hx-post="/app/saft/preview" hx-encoding="multipart/form-data" hx-target="#mg-output" hx-swap="innerHTML">
            ${reaiDropzone({ inputId: 'saft-xml', name: 'file', accept: '.xml,text/xml,application/xml', label: 'Choose SAF-T XML file', hint: 'Standard Norwegian SAF-T Financial XML exported from Tripletex, Fiken, PowerOffice Go, Visma or Conta.' })}
            <div class="inline-row">
              <button type="submit" class="button primary">Parse SAF-T XML</button>
              <button type="button" class="button secondary" hx-post="/app/saft/sample" hx-target="#mg-output" hx-swap="innerHTML">Load sample SAF-T file</button>
            </div>
          </form>`,
        })}
        <div id="mg-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${basePath}/sample`) return htmlResponse(renderSaft(parseSaftXml(SAMPLE_SAFT_XML), true));
  if (pathname === `${basePath}/export`) {
    const form = await request.formData();
    const rows = /** @type {string[][]} */ (JSON.parse(String(form.get('rowsJson') ?? '[]')));
    return csvAttachment('saft-opening-balance.csv', rows);
  }

  try {
    const form = await request.formData();
    if (pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a SAF-T XML file or load sample.');
      return htmlResponse(renderSaft(parseSaftXml(new TextDecoder('utf-8').decode(await file.arrayBuffer())), false));
    }

    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');

    if (pathname === `${basePath}/push-opening-balance`) {
      const year = String(form.get('year') ?? String(new Date().getUTCFullYear())).replace(/[^0-9]/g, '').slice(0, 4) || String(new Date().getUTCFullYear());
      const accts = /** @type {SaftAccount[]} */ (JSON.parse(String(form.get('accountsJson') ?? '[]')));
      const bsLines = accts
        .filter((a) => /^[12][0-9]{3}$/.test(a.accountId) && Math.abs(a.closingBalance) >= 0.01 && a.accountId !== '1500' && a.accountId !== '2400')
        .map((a, idx) => ({ rowNumber: idx, ...(a.closingBalance > 0 ? { debitAccount: a.accountId } : { creditAccount: a.accountId }), amount: Number(Math.abs(a.closingBalance).toFixed(2)), description: `SAF-T IB ${a.accountId} ${a.description}`.slice(0, 120) }));
      if (bsLines.length === 0) throw new HttpError(400, 'No non-subledger 1xxx/2xxx balance accounts found to post.');
      const res = /** @type {{ id: number, number: string, webUrl?: string }} */ (
        await reaiRequest(env, '/api/opening-balance', {
          token: session.accessToken, tenantId: session.tenantId, method: 'PUT',
          body: { voucherDate: `${year}-12-31`, voucherDescription: 'SAF-T Opening Balance imported via apps.reai.no', postingLines: bsLines },
        })
      );
      const url = res.webUrl || `${reaiOrigin(env)}/voucher/${res.id}?tenantId=${session.tenantId}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Opening balance saved (${res.number})`, body: html`Posted ${bsLines.length} NS 4102 balance-sheet lines directly to ReAI <code>PUT /api/opening-balance</code>. <a href="${url}" target="_blank" rel="noopener">Open in ReAI ↗</a>` }));
    }

    if (pathname === `${basePath}/import-party`) {
      const kind = String(form.get('kind') ?? 'customer');
      const name = String(form.get('name') ?? '').trim().slice(0, 75);
      const orgnr = extractNorwegianOrg(String(form.get('orgnr') ?? ''));
      const number = String(form.get('number') ?? '').trim();
      const created = /** @type {{ id: number }} */ (
        await reaiRequest(env, kind === 'supplier' ? '/api/suppliers' : '/api/customers', {
          token: session.accessToken, tenantId: session.tenantId, method: 'POST',
          body: { name, organizationNumber: orgnr, countryCode: 'NO', privateContact: false, skipRegistryLookup: true, ...(number ? { number } : {}) },
        })
      );
      return htmlResponse(html`<tr><td>${reaiBadge({ text: kind, tone: 'neutral' })}</td><td class="mono">${number || '—'}</td><td><strong>${name}</strong></td><td class="mono">${orgnr}</td><td>${reaiBadge({ text: `Imported #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'SAF-T Norway error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown SAF-T route.', 404);
}
