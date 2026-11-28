// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiOrigin, reaiRequest } from '../lib/reai.js';
import { csvAttachment, formatMinor } from '../lib/reconcile.js';
import { SETTLEMENT_API_UI, fetchPayoutSettlementApi, renderApiFetchCard } from '../lib/provider-api.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { extractNorwegianOrg } from './recman-core.js';

/**
 * @typedef {'saft' | 'hoopla' | 'squarespace' | 'paddle' | 'salesforce'} MigSlug
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
  while ((m = re.exec(xml)) !== null) {
    if (m[1]) out.push(m[1]);
  }
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
    .map((blk) => {
      const accountId = xmlTag(blk, 'AccountID');
      const description = xmlTag(blk, 'AccountDescription');
      const ob = (Number(xmlTag(blk, 'OpeningDebitBalance')) || 0) - (Number(xmlTag(blk, 'OpeningCreditBalance')) || 0);
      const cb = (Number(xmlTag(blk, 'ClosingDebitBalance')) || 0) - (Number(xmlTag(blk, 'ClosingCreditBalance')) || 0);
      return { accountId, description, openingBalance: ob, closingBalance: cb };
    })
    .filter((a) => /^[0-9]{4}$/.test(a.accountId));

  /** @type {SaftParty[]} */
  const customers = xmlBlocks(xml, 'Customer')
    .map((blk) => ({
      id: xmlTag(blk, 'CustomerID'),
      name: xmlTag(blk, 'Name'),
      orgnr: extractNorwegianOrg(xmlTag(blk, 'RegistrationNumber')),
      kind: /** @type {'customer'} */ ('customer'),
    }))
    .filter((c) => c.name.length > 0);

  /** @type {SaftParty[]} */
  const suppliers = xmlBlocks(xml, 'Supplier')
    .map((blk) => ({
      id: xmlTag(blk, 'SupplierID'),
      name: xmlTag(blk, 'Name'),
      orgnr: extractNorwegianOrg(xmlTag(blk, 'RegistrationNumber')),
      kind: /** @type {'supplier'} */ ('supplier'),
    }))
    .filter((s) => s.name.length > 0);

  return { companyName, orgnr, software, year, accounts, customers, suppliers };
}

/**
 * Handles /app/{saft,hoopla,squarespace,paddle,salesforce}/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @param {MigSlug} slug
 * @returns {Promise<Response>}
 */
export async function handleMigrationEcom(request, env, slug) {
  const { pathname } = new URL(request.url);
  const basePath = `/app/${slug}`;

  /** @type {Record<MigSlug, { eyebrow: string, title: string, lead: string, brand: string }>} */
  const META = {
    saft: {
      brand: 'SAF-T Norway',
      eyebrow: 'SWITCH FROM TRIPLETEX / FIKEN / POWEROFFICE / VISMA',
      title: 'SAF-T Financial Migration & Opening Balance Tool',
      lead: 'Upload a Norwegian SAF-T Financial XML export from Tripletex, Fiken, PowerOffice Go, Visma or Conta to inspect NS 4102 closing balances, import customers & suppliers into ReAI, and download an Excel opening balance sheet.',
    },
    hoopla: {
      brand: 'Hoopla & Deltager.no',
      eyebrow: 'EVENTS, FESTIVALS & RACES',
      title: 'Hoopla & Deltager.no Settlement',
      lead: 'Book Hoopla and Deltager.no event payout reports into ReAI splitting VAT-exempt culture/sports tickets (3100) from 25% merchandise/food (3000) and fees (7770).',
    },
    squarespace: {
      brand: 'Squarespace & BigCommerce',
      eyebrow: 'ECOMMERCE · PRODUCT & SALES SYNC',
      title: 'Squarespace / BigCommerce Sync',
      lead: 'Sync Squarespace Commerce or BigCommerce catalog SKUs into ReAI Products and import paid online orders idempotently.',
    },
    paddle: {
      brand: 'Paddle & Chargebee',
      eyebrow: 'SAAS BILLING & MERCHANT OF RECORD',
      title: 'Paddle / Chargebee SaaS Payouts',
      lead: 'Book Paddle Merchant-of-Record and Chargebee SaaS payouts cleanly into ReAI separating 0% export SaaS revenue (3100/3200), MoR processing fees (7770) and net NOK bank payout (1580).',
    },
    salesforce: {
      brand: 'Salesforce CRM',
      eyebrow: 'ENTERPRISE B2B CRM',
      title: 'Salesforce CRM Sync',
      lead: 'Sync Salesforce Accounts into ReAI customers (with Mod11 NO org.nr validation) and stage Closed-Won Opportunities as idempotent ReAI draft orders.',
    },
  };
  const meta = META[slug];

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  }
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro"><p class="eyebrow">${meta.eyebrow}</p><h1>${meta.title}</h1><p class="lead">${meta.lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${slug}-web`, clientName: `ReAI ${meta.brand} (Web)` })}
        ${slug === 'hoopla' || slug === 'paddle'
          ? renderApiFetchCard({
              basePath,
              targetId: 'mg-output',
              brand: SETTLEMENT_API_UI[slug].brand,
              hint: SETTLEMENT_API_UI[slug].hint,
              fields: SETTLEMENT_API_UI[slug].fields,
              sampleAction: true,
            })
          : ''}
        ${slug === 'saft'
          ? reaiCard({
              eyebrow: 'UPLOAD NORWEGIAN SAF-T FINANCIAL XML',
              title: 'Inspect & migrate from any Norwegian accounting system',
              body: html`<form class="stack" hx-post="/app/saft/preview" hx-encoding="multipart/form-data" hx-target="#mg-output" hx-swap="innerHTML">
                ${reaiDropzone({ inputId: 'saft-xml', name: 'file', accept: '.xml,text/xml,application/xml', label: 'Choose SAF-T XML file', hint: 'Standard Norwegian SAF-T Financial XML exported from Tripletex, Fiken, PowerOffice Go, Visma or Conta.' })}
                <div class="inline-row">
                  <button type="submit" class="button primary">Parse SAF-T XML</button>
                  <button type="button" class="button secondary" hx-post="/app/saft/sample" hx-target="#mg-output" hx-swap="innerHTML">Load sample SAF-T file</button>
                </div>
              </form>`,
            })
          : slug === 'hoopla' || slug === 'paddle'
            ? reaiCard({
                eyebrow: `${meta.brand.toUpperCase()} SETTLEMENT`,
                title: 'Enter payout settlement totals (NOK)',
                body: html`<form class="stack" hx-post="${basePath}/preview" hx-target="#mg-output" hx-swap="innerHTML">
                  <div class="mapping-grid">
                    <div class="field"><label for="mg-d">Date</label><input id="mg-d" name="date" type="date" value="${today}" required></div>
                    <div class="field"><label for="mg-r">Payout ref</label><input id="mg-r" name="ref" type="text" placeholder="${slug.toUpperCase()}-2026-10" required></div>
                    <div class="field"><label for="mg-0">${slug === 'paddle' ? 'Export SaaS revenue 0% (3100)' : 'VAT-exempt tickets 0% (3100)'}</label><input id="mg-0" name="exempt" type="number" step="0.01" min="0" value="0"></div>
                    <div class="field"><label for="mg-25">Gross 25% domestic sales (3000)</label><input id="mg-25" name="taxable25" type="number" step="0.01" min="0" value="0"></div>
                    <div class="field"><label for="mg-f">Platform / MoR fees (7770)</label><input id="mg-f" name="fee" type="number" step="0.01" min="0" value="0"></div>
                  </div>
                  <div class="inline-row">
                    <button type="submit" class="button primary">Preview balanced voucher</button>
                    <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#mg-output" hx-swap="innerHTML">Load sample settlement</button>
                  </div>
                </form>`,
              })
            : reaiCard({
                eyebrow: `CONNECT ${meta.brand.toUpperCase()}`,
                title: slug === 'squarespace' ? 'Scan Squarespace / BigCommerce store' : 'Scan Salesforce Accounts & Won Opportunities',
                body: html`<p class="muted-note">API credentials are used only for this single HTTPS scan and never stored.</p>
                  <form class="stack" hx-post="${basePath}/preview" hx-target="#mg-output" hx-swap="innerHTML">
                    <div class="inline-row">
                      <div class="field"><label for="mg-u">API Base URL</label><input id="mg-u" name="baseUrl" type="url" required placeholder="${slug === 'squarespace' ? 'https://api.squarespace.com/1.0/commerce' : 'https://yourorg.my.salesforce.com/services/data/v61.0'}"></div>
                      <div class="field"><label for="mg-k">Bearer API token</label><input id="mg-k" name="apiToken" type="password" autocomplete="off" required placeholder="Bearer token"></div>
                    </div>
                    <div class="inline-row">
                      <button type="submit" class="button primary">Scan ${meta.brand}</button>
                      <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#mg-output" hx-swap="innerHTML">Load sample preview</button>
                    </div>
                  </form>`,
              })}
        <div id="mg-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: meta.title, description: meta.lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  /** @param {ReturnType<typeof parseSaftXml>} parsed @param {boolean} isSample */
  const renderSaft = (parsed, isSample) => {
    const csvRows = [
      ['Account', 'Description', 'OpeningBalance', 'ClosingBalance'],
      ...parsed.accounts.map((a) => [a.accountId, a.description, a.openingBalance.toFixed(2), a.closingBalance.toFixed(2)]),
    ];
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
            <form method="post" action="/app/saft/export">
              <input type="hidden" name="rowsJson" value="${JSON.stringify(csvRows)}">
              <button type="submit" class="button secondary">Download Opening Balance CSV ↓</button>
            </form>
            ${!isSample && parsed.accounts.length > 0
              ? html`<form hx-post="/app/saft/push-opening-balance" hx-target="#saft-ob-result" hx-swap="innerHTML">
                  <input type="hidden" name="year" value="${parsed.year}">
                  <input type="hidden" name="accountsJson" value="${JSON.stringify(parsed.accounts)}">
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
              <td class="mono">${p.id || '—'}</td>
              <td><strong>${p.name}</strong></td>
              <td class="mono">${p.orgnr || '—'}</td>
              <td>${isSample || !p.orgnr
                ? html`<span class="muted-note">${isSample ? 'Demo only' : 'Needs valid NO org.nr'}</span>`
                : html`<form hx-post="/app/saft/import-party" hx-target="#sf-p-${idx}" hx-swap="outerHTML">
                    <input type="hidden" name="kind" value="${p.kind}">
                    <input type="hidden" name="name" value="${p.name}">
                    <input type="hidden" name="orgnr" value="${p.orgnr}">
                    <input type="hidden" name="number" value="${p.id}">
                    <button type="submit" class="button primary">Import to ReAI</button>
                  </form>`}</td>
            </tr>`,
          )}</tbody>
        </table></div>`,
      })}
    `;
  };

  /** @param {{ date: string, ref: string, exemptMinor: number, taxable25Minor: number, feeMinor: number }} s @param {boolean} isSample */
  const renderPayout = (s, isSample) => {
    const net25 = Math.round((s.taxable25Minor * 100) / 125);
    const vat25 = s.taxable25Minor - net25;
    const netPayout = s.exemptMinor + s.taxable25Minor - s.feeMinor;
    return reaiCard({
      eyebrow: `${meta.brand.toUpperCase()} SETTLEMENT VOUCHER`,
      title: `${s.ref} · ${s.date}`,
      badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Net payout (1580)', value: `${formatMinor(netPayout)} NOK`, detail: 'After platform fees' })}
          ${reaiMetric({ label: '0% revenue (3100)', value: `${formatMinor(s.exemptMinor)} NOK`, detail: slug === 'paddle' ? 'Export SaaS / MoR' : 'Culture & sports' })}
          ${reaiMetric({ label: 'Fees (7770)', value: `${formatMinor(s.feeMinor)} NOK`, detail: 'Platform / MoR fee' })}
        </div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Account</th><th>Posting</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
          <tbody>
            <tr><td class="mono">1580</td><td>${meta.brand} net payout</td><td class="num">${formatMinor(netPayout)}</td><td class="num"></td></tr>
            ${s.feeMinor > 0 ? html`<tr><td class="mono">7770</td><td>${meta.brand} fee</td><td class="num">${formatMinor(s.feeMinor)}</td><td class="num"></td></tr>` : ''}
            ${s.exemptMinor > 0 ? html`<tr><td class="mono">3100</td><td>${meta.brand} 0% revenue</td><td class="num"></td><td class="num">${formatMinor(s.exemptMinor)}</td></tr>` : ''}
            ${net25 > 0 ? html`<tr><td class="mono">3000</td><td>${meta.brand} 25% net</td><td class="num"></td><td class="num">${formatMinor(net25)}</td></tr>` : ''}
            ${vat25 > 0 ? html`<tr><td class="mono">2700</td><td>Output VAT 25%</td><td class="num"></td><td class="num">${formatMinor(vat25)}</td></tr>` : ''}
          </tbody>
        </table></div>
        ${!isSample && netPayout > 0
          ? html`<form class="stack-sm confirm-box" hx-post="${basePath}/book" hx-target="#mg-booking" hx-swap="innerHTML">
              <input type="hidden" name="payJson" value="${JSON.stringify(s)}">
              <label class="check-row"><input type="checkbox" name="c_pay" required> I verified these figures against the ${meta.brand} statement.</label>
              <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
            </form><div id="mg-booking" class="stack-sm"></div>`
          : isSample
            ? reaiCallout({ tone: 'info', body: `Synthetic ${meta.brand} payout loaded. Enter your real totals above and connect to ReAI to book.` })
            : ''}
      `,
    });
  };

  if (pathname === `${basePath}/sample`) {
    if (slug === 'saft') return htmlResponse(renderSaft(parseSaftXml(SAMPLE_SAFT_XML), true));
    if (slug === 'hoopla') return htmlResponse(renderPayout({ date: '2026-10-26', ref: 'HPL-2026-991', exemptMinor: 6400000, taxable25Minor: 1250000, feeMinor: 245000 }, true));
    if (slug === 'paddle') return htmlResponse(renderPayout({ date: '2026-10-31', ref: 'PAD-2026-10', exemptMinor: 18450000, taxable25Minor: 0, feeMinor: 922500 }, true));
    return htmlResponse(
      reaiCard({
        eyebrow: `${meta.brand.toUpperCase()} SAMPLE PREVIEW`,
        title: slug === 'squarespace' ? '2 store SKUs & 2 paid orders' : '2 Salesforce Accounts & 1 Won Opportunity',
        badge: reaiBadge({ text: 'Synthetic sample', tone: 'accent' }),
        body: html`<div class="metric-grid">
          ${reaiMetric({ label: 'Records scanned', value: '3', detail: 'Matched by SKU / org.nr' })}
          ${reaiMetric({ label: 'Ready to sync', value: '2', detail: 'Idempotent ReAI Public API writes' })}
          ${reaiMetric({ label: 'Fee', value: '0 NOK', detail: 'Included free with ReAI' })}
        </div>`,
      }),
    );
  }

  if (slug === 'saft' && pathname === '/app/saft/export') {
    const form = await request.formData();
    const rows = /** @type {string[][]} */ (JSON.parse(String(form.get('rowsJson') ?? '[]')));
    return csvAttachment('saft-opening-balance.csv', rows);
  }

  try {
    const form = await request.formData();
    if (slug === 'saft' && pathname === '/app/saft/preview') {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a SAF-T XML file or load sample.');
      const xml = new TextDecoder('utf-8').decode(await file.arrayBuffer());
      return htmlResponse(renderSaft(parseSaftXml(xml), false));
    }
    if ((slug === 'hoopla' || slug === 'paddle') && pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */
      const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderPayout(await fetchPayoutSettlementApi(slug, creds), false));
    }
    if ((slug === 'hoopla' || slug === 'paddle') && pathname === `${basePath}/preview`) {
      /** @param {string} k */
      const m = (k) => Math.round(Math.max(0, Number(form.get(k) ?? '0') || 0) * 100);
      const date = String(form.get('date') ?? '').trim();
      const ref = String(form.get('ref') ?? '').trim().slice(0, 60);
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !ref) throw new HttpError(400, 'Enter valid date and reference.');
      return htmlResponse(renderPayout({ date, ref, exemptMinor: m('exempt'), taxable25Minor: m('taxable25'), feeMinor: m('fee') }, false));
    }

    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');

    if (slug === 'saft' && pathname === '/app/saft/push-opening-balance') {
      const year = String(form.get('year') ?? String(new Date().getUTCFullYear())).replace(/[^0-9]/g, '').slice(0, 4) || String(new Date().getUTCFullYear());
      const accts = /** @type {SaftAccount[]} */ (JSON.parse(String(form.get('accountsJson') ?? '[]')));
      const bsLines = accts
        .filter((a) => /^[12][0-9]{3}$/.test(a.accountId) && Math.abs(a.closingBalance) >= 0.01 && a.accountId !== '1500' && a.accountId !== '2400')
        .map((a, idx) => ({
          rowNumber: idx,
          ...(a.closingBalance > 0 ? { debitAccount: a.accountId } : { creditAccount: a.accountId }),
          amount: Number(Math.abs(a.closingBalance).toFixed(2)),
          description: `SAF-T IB ${a.accountId} ${a.description}`.slice(0, 120),
        }));
      if (bsLines.length === 0) throw new HttpError(400, 'No non-subledger 1xxx/2xxx balance accounts found to post.');
      const res = /** @type {{ id: number, number: string, webUrl?: string }} */ (
        await reaiRequest(env, '/api/opening-balance', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'PUT',
          body: { voucherDate: `${year}-12-31`, voucherDescription: `SAF-T Opening Balance imported via apps.reai.no`, postingLines: bsLines },
        })
      );
      const url = res.webUrl || `${reaiOrigin(env)}/voucher/${res.id}?tenantId=${session.tenantId}`;
      return htmlResponse(
        reaiCallout({
          tone: 'success',
          title: `Opening balance saved (${res.number})`,
          body: html`Posted ${bsLines.length} NS 4102 balance-sheet lines directly to ReAI <code>PUT /api/opening-balance</code>. <a href="${url}" target="_blank" rel="noopener">Open in ReAI ↗</a>`,
        }),
      );
    }

    if (slug === 'saft' && pathname === '/app/saft/import-party') {
      const kind = String(form.get('kind') ?? 'customer');
      const name = String(form.get('name') ?? '').trim().slice(0, 75);
      const orgnr = extractNorwegianOrg(String(form.get('orgnr') ?? ''));
      const number = String(form.get('number') ?? '').trim();
      const endpoint = kind === 'supplier' ? '/api/suppliers' : '/api/customers';
      const created = /** @type {{ id: number }} */ (
        await reaiRequest(env, endpoint, {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: { name, organizationNumber: orgnr, countryCode: 'NO', privateContact: false, skipRegistryLookup: true, ...(number ? { number } : {}) },
        })
      );
      return htmlResponse(html`<tr><td>${reaiBadge({ text: kind, tone: 'neutral' })}</td><td class="mono">${number || '—'}</td><td><strong>${name}</strong></td><td class="mono">${orgnr}</td><td>${reaiBadge({ text: `Imported #${created.id}`, tone: 'success' })}</td></tr>`);
    }

    if ((slug === 'hoopla' || slug === 'paddle') && pathname === `${basePath}/book`) {
      if (form.get('c_pay') !== 'on') throw new HttpError(400, 'Confirm verification checkbox first.');
      const s = /** @type {{ date: string, ref: string, exemptMinor: number, taxable25Minor: number, feeMinor: number }} */ (JSON.parse(String(form.get('payJson') ?? '{}')));
      const net25 = Math.round((s.taxable25Minor * 100) / 125);
      const vat25 = s.taxable25Minor - net25;
      const netPayout = s.exemptMinor + s.taxable25Minor - s.feeMinor;
      /** @type {Array<Record<string, unknown>>} */
      const postings = [];
      let idx = 0;
      const push = (/** @type {string} */ acct, /** @type {number} */ minor, /** @type {string} */ desc) => {
        if (minor === 0) return;
        postings.push({ accountNumber: acct, postingDate: s.date, currencyCode: 'NOK', amount: Number((minor / 100).toFixed(2)), vatCode: '0', rowNumber: idx++, description: desc });
      };
      push('1580', netPayout, `${meta.brand} net payout`);
      push('7770', s.feeMinor, `${meta.brand} fee`);
      push('3100', -s.exemptMinor, `${meta.brand} 0% revenue`);
      push('3000', -net25, `${meta.brand} 25% net`);
      push('2700', -vat25, 'Output VAT 25%');

      const created = /** @type {{ id: number, number: string }} */ (
        await reaiRequest(env, '/api/manual-vouchers', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: { date: s.date, description: `${meta.brand} ${s.ref} ${s.date}`, reviewReason: `Imported from ${meta.brand} via apps.reai.no.`, postings },
        })
      );
      const url = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${url}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }

    if ((slug === 'squarespace' || slug === 'salesforce') && pathname === `${basePath}/preview`) {
      const baseUrl = String(form.get('baseUrl') ?? '').trim();
      const parsed = new URL(baseUrl);
      if (parsed.protocol !== 'https:' || parsed.hostname === 'localhost') throw new HttpError(400, 'Use a public https:// API URL.');
      const token = String(form.get('apiToken') ?? '').trim();
      const targetUrl =
        slug === 'squarespace'
          ? `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}/products`
          : `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}/query?q=${encodeURIComponent('SELECT Id, Name FROM Account LIMIT 50')}`;
      const res = await fetch(targetUrl, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new HttpError(400, `${meta.brand} returned HTTP ${res.status}. Verify API URL and Bearer token.`);
      const data = /** @type {any} */ (await res.json());
      const rows = Array.isArray(data.products) ? data.products : Array.isArray(data.records) ? data.records : Array.isArray(data.data) ? data.data : [];
      return htmlResponse(
        reaiCard({
          eyebrow: `${meta.brand.toUpperCase()} LIVE SCAN`,
          title: `${rows.length} records returned`,
          badge: reaiBadge({ text: 'API verified', tone: 'success' }),
          body: html`<p class="muted-note">Connected to <code>${parsed.hostname}</code> and verified ${rows.length} live ${slug === 'squarespace' ? 'products' : 'accounts'}.</p>`,
        }),
      );
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${meta.brand} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }

  return errorResponse('Unknown migration/ecom route.', 404);
}
