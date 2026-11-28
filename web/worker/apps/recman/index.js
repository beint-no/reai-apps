// @ts-check
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';
import {
  REAI_WAGE_CODES,
  buildSyntheticRecManSample,
  computeDraftPaymentDate,
  createRecManClient,
  lookupWorkplaceMunicipalities,
  parseRecManCandidates,
  parseRecManCompanies,
  parseRecManDocuments,
  parseRecManPaychecks,
  parseRecManProducts,
  suggestWageCode,
  verifiedNorwegianAccount,
  verifiedNorwegianIban,
} from './core.js';

/**
 * @typedef {{ id: number, name?: string | null, number?: string | null, organizationNumber?: string | null, archived?: boolean }} ReAICustomer
 * @typedef {{ id: number, name: string, email?: string | null }} ReAIEmployeeSummary
 * @typedef {{ id: number, name: string, email?: string | null, bankAccount?: { accountNumber?: string | null } | null, employmentRelations?: Array<{ startDate: string, endDate?: string | null, employmentLines?: Array<{ id?: number, startDate: string, percentage?: number, municipality?: string | null }> }> }} ReAIEmployeeDetail
 * @typedef {{ doc: import('./core.js').RecManDocument, company: import('./core.js').RecManCompany | null, matchedCustomerId: number | null, alreadyBookedId: number | null, problem: string | null, lines: Array<{ itemName: string, quantity: number, unitPrice: number, netAmount: number, taxAmount: number, accountNumber: string, vatCode: string }> }} InvoicePreviewRow
 * @typedef {{ paycheck: import('./core.js').RecManPaycheck, candidate: import('./core.js').RecManCandidate | null, reaiEmployeeId: number | null, period: string, paymentDate: string, municipalities: import('./core.js').MunicipalityMatch[], workplaceLabels: string[], validBank: string, heldReason: string | null, lines: Array<{ line: import('./core.js').RecManPaycheckLine, suggestedCode: string }> }} PayrollPreviewRow
 */

/**
 * @param {import('./core.js').RecManCompany | null} company
 * @param {ReAICustomer[]} customers
 * @returns {ReAICustomer | null}
 */
function matchCustomer(company, customers) {
  if (!company) {
    return null;
  }
  const active = customers.filter((c) => !c.archived);
  if (company.orgnr) {
    const byOrg = active.find((c) => (c.organizationNumber ?? '').replace(/\s+/g, '') === company.orgnr);
    if (byOrg) {
      return byOrg;
    }
  }
  if (company.number && company.number !== '0') {
    const byNum = active.find((c) => (c.number ?? '').trim() === company.number);
    if (byNum) {
      return byNum;
    }
  }
  return active.find((c) => (c.name ?? '').trim().toLowerCase() === company.name.toLowerCase()) ?? null;
}

/**
 * @param {{ rows: InvoicePreviewRow[], customers: ReAICustomer[], apiKey: string, recmanCalls: number, isSample?: boolean }} state
 */
function renderInvoiceResults(state) {
  const ready = state.rows.filter((r) => !r.alreadyBookedId && !r.problem).length;
  const booked = state.rows.filter((r) => r.alreadyBookedId !== null).length;
  const blocked = state.rows.filter((r) => !r.alreadyBookedId && r.problem !== null).length;

  return html`
    ${reaiCard({
      eyebrow: 'RECMAN INVOICES & CREDIT NOTES → REAI',
      title: `${state.rows.length} issued RecMan documents reviewed`,
      badge: state.isSample
        ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' })
        : reaiBadge({ text: `${state.recmanCalls} RecMan API calls`, tone: 'neutral' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Ready to book', value: String(ready), detail: 'Books with original PDF & KID' })}
          ${reaiMetric({ label: 'Already in ReAI', value: String(booked), detail: 'Skipped (idempotent)' })}
          ${reaiMetric({ label: 'Needs review', value: String(blocked), detail: 'VAT, account or customer check' })}
        </div>

        ${state.rows.length === 0
          ? reaiCallout({ tone: 'info', body: 'No RecMan invoices or credit notes matched these filters.' })
          : html`<div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>KID</th>
                    <th class="num">Total (NOK)</th>
                    <th>Status & lines</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${state.rows.map((r, idx) => {
                    const mult = r.doc.kind === 'creditNote' && r.doc.total > 0 ? -1 : 1;
                    const signedMinor = Math.round(r.doc.total * mult * 100);
                    const canCreateCustomer = !r.matchedCustomerId && Boolean(r.company?.orgnr);
                    return html`<tr id="rm-inv-${idx}">
                      <td class="mono"><strong>${r.doc.kind === 'creditNote' ? 'CN' : 'INV'} ${r.doc.number}</strong></td>
                      <td class="mono">${r.doc.date}</td>
                      <td>${r.company?.name ?? `Company #${r.doc.companyId}`}${r.company?.orgnr ? html`<div class="muted-note mono">${r.company.orgnr}</div>` : ''}</td>
                      <td class="mono">${r.doc.kid || '—'}</td>
                      <td class="num">${formatMinor(signedMinor)}</td>
                      <td>
                        ${r.alreadyBookedId
                          ? reaiBadge({ text: `Booked #${r.alreadyBookedId}`, tone: 'neutral' })
                          : r.problem
                            ? reaiBadge({ text: r.problem, tone: 'danger' })
                            : reaiBadge({ text: `${r.lines.length} lines validated · PDF ready`, tone: 'success' })}
                        <div class="muted-note">${r.lines.map((l) => `${l.accountNumber}/VAT ${l.vatCode}`).join(', ')}</div>
                      </td>
                      <td>
                        ${r.alreadyBookedId || r.problem || state.isSample
                          ? html`<span class="muted-note">${state.isSample && !r.problem ? 'Demo only' : '—'}</span>`
                          : html`<form class="stack-sm" hx-post="/app/recman/book-invoice" hx-target="#rm-inv-${idx}" hx-swap="outerHTML">
                              <input type="hidden" name="recmanKey" value="${state.apiKey}">
                              <input type="hidden" name="docJson" value="${JSON.stringify(r.doc)}">
                              <input type="hidden" name="companyJson" value="${JSON.stringify(r.company)}">
                              <input type="hidden" name="linesJson" value="${JSON.stringify(r.lines)}">
                              <select name="customerChoice" required>
                                ${r.matchedCustomerId
                                  ? html`<option value="${r.matchedCustomerId}" selected>Matched ReAI #${r.matchedCustomerId}</option>`
                                  : canCreateCustomer
                                    ? html`<option value="create" selected>Create from RecMan (${r.company?.orgnr})</option>`
                                    : html`<option value="">Choose ReAI customer…</option>`}
                                ${state.customers.filter((c) => !c.archived).slice(0, 200).map((c) => html`<option value="${c.id}">${c.name}${c.organizationNumber ? ` (${c.organizationNumber})` : ''}</option>`)}
                              </select>
                              <button type="submit" class="button primary">Book + PDF</button>
                            </form>`}
                      </td>
                    </tr>`;
                  })}
                </tbody>
              </table>
            </div>`}
      `,
    })}
  `;
}

/**
 * @param {{ rows: PayrollPreviewRow[], recmanCalls: number, isSample?: boolean }} state
 */
function renderPayrollResults(state) {
  const ready = state.rows.filter((r) => !r.heldReason).length;
  const held = state.rows.filter((r) => r.heldReason !== null).length;

  return html`
    ${reaiCard({
      eyebrow: 'RECMAN PAYCHECKS + KARTVERKET AGA ZONES → REAI DRAFT PAYROLL',
      title: `${state.rows.length} unexported RecMan paychecks reviewed`,
      badge: state.isSample
        ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' })
        : reaiBadge({ text: `${state.recmanCalls} RecMan API calls`, tone: 'neutral' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Ready for draft payroll', value: String(ready), detail: 'Single AGA municipality verified' })}
          ${reaiMetric({ label: 'Held for AGA / review', value: String(held), detail: 'Multi-municipality or missing data' })}
          ${reaiMetric({ label: 'Safety mode', value: 'Draft only', detail: 'Never finalizes or sends A-melding' })}
        </div>

        ${state.rows.length === 0
          ? reaiCallout({ tone: 'info', body: 'No unexported RecMan paychecks found for this filter.' })
          : state.rows.map(
              (r, idx) => html`<div id="rm-pay-${idx}" class="confirm-box stack-sm">
                <div class="inline-row" style="justify-content:space-between">
                  <div>
                    <strong>${r.candidate?.name ?? `Candidate #${r.paycheck.candidateId}`}</strong>
                    <span class="muted-note"> · Paycheck #${r.paycheck.paycheckId} · Period <code class="mono">${r.period || '?'}</code> · Draft pay date <code class="mono">${r.paymentDate || '?'}</code></span>
                  </div>
                  ${r.heldReason
                    ? reaiBadge({ text: 'Held for manual AGA review', tone: 'warn' })
                    : reaiBadge({ text: r.reaiEmployeeId ? `Matched ReAI employee #${r.reaiEmployeeId}` : 'Will create ReAI employee', tone: 'success' })}
                </div>

                <div class="muted-note">
                  <strong>Workplaces:</strong> ${r.workplaceLabels.length > 0 ? r.workplaceLabels.join(' · ') : 'No linked workplace address resolved'}<br>
                  <strong>Kartverket municipality (AGA):</strong> ${r.municipalities.length > 0 ? r.municipalities.map((m) => m.label).join(', ') : 'Not auto-resolved (enter 4-digit kommunenummer below)'}
                  ${r.validBank ? html` · <strong>Bank:</strong> <span class="mono">${r.validBank}</span>` : ''}
                </div>

                ${r.heldReason ? reaiCallout({ tone: 'warn', title: 'Blocked until reviewed', body: r.heldReason }) : ''}

                <form class="stack-sm" hx-post="/app/recman/import-paycheck" hx-target="#rm-pay-${idx}" hx-swap="outerHTML">
                  <input type="hidden" name="paycheckJson" value="${JSON.stringify(r.paycheck)}">
                  <input type="hidden" name="candidateJson" value="${JSON.stringify(r.candidate)}">
                  <input type="hidden" name="reaiEmployeeId" value="${r.reaiEmployeeId ?? 0}">
                  <input type="hidden" name="period" value="${r.period}">
                  <input type="hidden" name="paymentDate" value="${r.paymentDate}">
                  <input type="hidden" name="validBank" value="${r.validBank}">

                  <div class="table-wrap">
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th>RecMan article</th>
                          <th>Dates</th>
                          <th class="num">Qty</th>
                          <th class="num">Rate (NOK)</th>
                          <th class="num">Total (NOK)</th>
                          <th>ReAI wage specification code</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${r.lines.map(
                          (item, lIdx) => html`<tr>
                            <td>${item.line.articleName} <span class="muted-note">(${item.line.articleType})</span></td>
                            <td class="mono">${item.line.startDate} → ${item.line.endDate}</td>
                            <td class="num">${item.line.qty.toFixed(2)}</td>
                            <td class="num">${item.line.amount.toFixed(2)}</td>
                            <td class="num">${item.line.total.toFixed(2)}</td>
                            <td>
                              <select name="wageCode_${lIdx}" required>
                                <option value="">Choose wage type…</option>
                                ${REAI_WAGE_CODES.map(
                                  ([code, label]) =>
                                    html`<option value="${code}"${item.suggestedCode === code ? html` selected` : ''}>${label}</option>`,
                                )}
                              </select>
                            </td>
                          </tr>`,
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div class="inline-row">
                    <div class="field">
                      <label for="mun-${idx}">Municipality code (4-digit AGA kommunenummer)</label>
                      <input id="mun-${idx}" name="municipality" type="text" pattern="[0-9]{4}" maxlength="4" value="${r.municipalities.length === 1 ? (r.municipalities[0]?.code ?? '') : ''}" required placeholder="e.g. 5503">
                    </div>
                    ${state.isSample || r.heldReason
                      ? html`<span class="muted-note">${state.isSample ? 'Demo preview only' : 'Resolve multi-municipality AGA split in ReAI first'}</span>`
                      : html`<button type="submit" class="button primary">Add to ReAI draft payroll</button>`}
                  </div>
                </form>
              </div>`,
            )}
      `,
    })}
  `;
}

/**
 * Handles /app/recman/* SSR & HTMX routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handleRecMan(request, env) {
  const { pathname } = new URL(request.url);

  if (pathname === '/app/recman' && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL('/app/recman/', request.url), 301);
  }

  if (pathname === '/app/recman/' && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const defaultStart = `${new Date().getUTCFullYear()}-01-01`;
    const body = html`
      <section class="app-intro">
        <p class="eyebrow">STAFFING & HR · INVOICES, PDF, KID & PAYROLL AGA</p>
        <h1>RecMan Accounting Bridge</h1>
        <p class="lead">Import issued RecMan invoices & credit notes with original PDFs and KID numbers, and prepare draft ReAI payroll runs with automatic Kartverket workplace municipality (AGA zone) detection.</p>
      </section>

      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-recman-web', clientName: 'ReAI RecMan Bridge (Web)' })}

        ${reaiCard({
          eyebrow: 'STEP 1 · READ-ONLY RECMAN API KEY (SELECT ONLY)',
          title: 'Test connection & scan RecMan incrementally',
          badge: reaiBadge({ text: 'Quota-safe · 0 background polling', tone: 'accent' }),
          body: html`
            <p class="muted-note">Create a read-only (<code>SELECT</code>) API key in RecMan (<em>System settings → Database → API</em>). Keys are sent only for the active HTTPS request and never stored. Use <code>minInvoiceId</code> / <code>minPaycheckId</code> to stay well below RecMan's 200 calls/day free quota.</p>
            <form class="stack" id="recman-controls">
              <div class="mapping-grid">
                <div class="field">
                  <label for="rm-key">RecMan SELECT API key</label>
                  <input id="rm-key" name="recmanKey" type="password" autocomplete="off" placeholder="RecMan read-only API key">
                </div>
                <div class="field">
                  <label for="rm-start">Invoice start date (YYYY-MM-DD)</label>
                  <input id="rm-start" name="startDate" type="date" value="${defaultStart}">
                </div>
                <div class="field">
                  <label for="rm-min-inv">minInvoiceId (optional)</label>
                  <input id="rm-min-inv" name="minInvoiceId" type="number" min="0" placeholder="e.g. 180">
                </div>
                <div class="field">
                  <label for="rm-min-cn">minCreditNoteId (optional)</label>
                  <input id="rm-min-cn" name="minCreditNoteId" type="number" min="0" placeholder="e.g. 15">
                </div>
                <div class="field">
                  <label for="rm-min-pay">minPaycheckId (optional)</label>
                  <input id="rm-min-pay" name="minPaycheckId" type="number" min="0" placeholder="e.g. 150">
                </div>
              </div>
              <div class="inline-row">
                <button type="button" class="button secondary" hx-post="/app/recman/test" hx-include="#recman-controls" hx-target="#rm-status" hx-swap="innerHTML">Test RecMan key</button>
                <button type="button" class="button primary" hx-post="/app/recman/scan-invoices" hx-include="#recman-controls" hx-target="#rm-output" hx-swap="innerHTML">Scan Invoices & Credit Notes</button>
                <button type="button" class="button primary" hx-post="/app/recman/scan-payroll" hx-include="#recman-controls" hx-target="#rm-output" hx-swap="innerHTML">Scan Paychecks & AGA Zones</button>
                <button type="button" class="button secondary" hx-post="/app/recman/sample" hx-target="#rm-output" hx-swap="innerHTML">Load synthetic sample</button>
              </div>
            </form>
            <div id="rm-status" class="stack-sm"></div>
          `,
        })}

        <div id="rm-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(
      appShell({
        title: 'RecMan Accounting Bridge',
        description: 'Import issued RecMan invoices with PDFs & KID and prepare ReAI draft payroll with Kartverket AGA municipality checks.',
        activePath: '/app/recman/',
        body,
      }),
    );
  }

  if (request.method !== 'POST') {
    return errorResponse('Method not allowed.', 405);
  }
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  if (pathname === '/app/recman/sample') {
    const sample = buildSyntheticRecManSample();
    /** @type {InvoicePreviewRow[]} */
    const invRows = sample.documents.map((doc) => {
      const mult = doc.kind === 'creditNote' && doc.total > 0 ? -1 : 1;
      return {
        doc,
        company: sample.companies[0] ?? null,
        matchedCustomerId: doc.kind === 'invoice' ? 42 : 42,
        alreadyBookedId: null,
        problem: null,
        lines: doc.lines.map((l) => ({
          itemName: l.description,
          quantity: l.qty,
          unitPrice: l.price * mult,
          netAmount: l.sumExclVat * mult,
          taxAmount: l.sumVat * mult,
          accountNumber: l.creditAccount,
          vatCode: l.vatCode,
        })),
      };
    });
    /** @type {PayrollPreviewRow[]} */
    const payRows = [
      {
        paycheck: {
          paycheckId: 8801,
          number: 101,
          candidateId: 501,
          departmentId: 1,
          exported: 0,
          lines: [
            { paycheckLineId: 1, articleId: 10, articleName: 'Timelønn', articleType: 'hour', employmentId: 1, workId: 1, qty: 142.5, amount: 315, total: 44887.5, startDate: '2027-01-02', endDate: '2027-01-29' },
            { paycheckLineId: 2, articleId: 12, articleName: 'Kveldstillegg', articleType: 'hourAddition', employmentId: 1, workId: 1, qty: 24, amount: 65, total: 1560, startDate: '2027-01-02', endDate: '2027-01-29' },
          ],
        },
        candidate: { candidateId: 501, name: 'Ingrid Solberg (Demo)', email: 'ingrid@example.no', employments: [{ employmentId: 1, startDate: '2026-09-01', endDate: '', positionPercent: 100, bankAccount: '12345678903', iban: '' }] },
        reaiEmployeeId: 12,
        period: '2027-01',
        paymentDate: '2027-01-29',
        municipalities: [{ code: '5503', name: 'Harstad', label: 'Harstad (5503)' }],
        workplaceLabels: ['Hjemmetjeneste Nord · Nordlys Helsekommune · Storgata 12 9405 Harstad'],
        validBank: '12345678903',
        heldReason: null,
        lines: [
          { line: { paycheckLineId: 1, articleId: 10, articleName: 'Timelønn', articleType: 'hour', employmentId: 1, workId: 1, qty: 142.5, amount: 315, total: 44887.5, startDate: '2027-01-02', endDate: '2027-01-29' }, suggestedCode: 'hourly_salary' },
          { line: { paycheckLineId: 2, articleId: 12, articleName: 'Kveldstillegg', articleType: 'hourAddition', employmentId: 1, workId: 1, qty: 24, amount: 65, total: 1560, startDate: '2027-01-02', endDate: '2027-01-29' }, suggestedCode: 'evening_supplement' },
        ],
      },
      {
        paycheck: {
          paycheckId: 8802,
          number: 102,
          candidateId: 502,
          departmentId: 1,
          exported: 0,
          lines: [
            { paycheckLineId: 3, articleId: 10, articleName: 'Timelønn', articleType: 'hour', employmentId: 2, workId: 2, qty: 75, amount: 320, total: 24000, startDate: '2027-01-05', endDate: '2027-01-25' },
          ],
        },
        candidate: { candidateId: 502, name: 'Henrik Dahl (Demo)', email: 'henrik@example.no', employments: [{ employmentId: 2, startDate: '2026-10-01', endDate: '', positionPercent: 80, bankAccount: '', iban: '' }] },
        reaiEmployeeId: null,
        period: '2027-01',
        paymentDate: '2027-01-29',
        municipalities: [
          { code: '5501', name: 'Tromsø', label: 'Tromsø (5501)' },
          { code: '5503', name: 'Harstad', label: 'Harstad (5503)' },
        ],
        workplaceLabels: ['Avdeling Sentrum · Tromsø', 'Hjemmetjeneste Nord · Harstad'],
        validBank: '',
        heldReason: 'Workplace addresses span multiple AGA municipalities: Tromsø (5501), Harstad (5503). Verify the applicable employment municipality and AGA zone in ReAI before importing.',
        lines: [
          { line: { paycheckLineId: 3, articleId: 10, articleName: 'Timelønn', articleType: 'hour', employmentId: 2, workId: 2, qty: 75, amount: 320, total: 24000, startDate: '2027-01-05', endDate: '2027-01-25' }, suggestedCode: 'hourly_salary' },
        ],
      },
    ];
    return htmlResponse(html`
      ${renderInvoiceResults({ rows: invRows, customers: [], apiKey: '', recmanCalls: 0, isSample: true })}
      ${renderPayrollResults({ rows: payRows, recmanCalls: 0, isSample: true })}
    `);
  }

  try {
    const form = await request.formData();

    if (pathname === '/app/recman/test') {
      const client = createRecManClient(String(form.get('recmanKey') ?? ''));
      const msg = await client.health();
      return htmlResponse(reaiCallout({ tone: 'success', title: 'RecMan API verified', body: `${msg} (${client.getCalls()} API call${client.getCalls() === 1 ? '' : 's'} used).` }));
    }

    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) {
      throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    }
    const company = session.tenants.find((t) => t.id === session.tenantId);
    if (!company || company.currencyCode !== 'NOK') {
      throw new HttpError(400, 'Select a Norwegian (NOK) company in ReAI.');
    }

    if (pathname === '/app/recman/scan-invoices') {
      const apiKey = String(form.get('recmanKey') ?? '').trim();
      const startDate = String(form.get('startDate') ?? '2027-01-01').trim();
      const minInvoiceId = String(form.get('minInvoiceId') ?? '').trim();
      const minCreditNoteId = String(form.get('minCreditNoteId') ?? '').trim();
      const client = createRecManClient(apiKey);

      const [invRaw, cnRaw, compRaw, prodRaw, customersRaw, vatCodesRaw, accountsRaw, existingInvoicesRaw] = await Promise.all([
        client.fetchAll('invoice', minInvoiceId ? { minInvoiceId } : {}),
        client.fetchAll('creditNote', minCreditNoteId ? { minCreditNoteId } : {}),
        client.fetchAll('company', { fields: 'name,number,vatNumber,visitAddress' }),
        client.fetchAll('product'),
        reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: company.id }),
        reaiRequest(env, '/api/vat-codes', { token: session.accessToken, tenantId: company.id, query: { usage: 'customer_invoice' } }),
        reaiRequest(env, '/api/chart-of-accounts/accounts', { token: session.accessToken, tenantId: company.id, query: { accountNumberPrefix: '3', limit: '500' } }),
        reaiAll(env, '/api/invoices', { token: session.accessToken, tenantId: company.id, query: { startDate } }),
      ]);

      const docs = [
        ...parseRecManDocuments(invRaw, 'invoice'),
        ...parseRecManDocuments(cnRaw, 'creditNote'),
      ]
        .filter((d) => d.date >= startDate)
        .sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number);

      const companiesById = new Map(parseRecManCompanies(compRaw).map((c) => [c.companyId, c]));
      const productsById = parseRecManProducts(prodRaw);
      const customers = /** @type {ReAICustomer[]} */ (customersRaw);
      const vatByCode = new Map(/** @type {Array<{ code: string, rate: number }>} */ (vatCodesRaw).map((v) => [v.code, v.rate]));
      const validAccounts = new Set(/** @type {Array<{ accountNumber: string }>} */ (accountsRaw).map((a) => a.accountNumber));
      const existingByNumber = new Map(
        /** @type {Array<{ id: number, number?: string | null, externalId?: string | null }>} */ (existingInvoicesRaw).map((inv) => [String(inv.number ?? ''), inv.id]),
      );

      /** @type {InvoicePreviewRow[]} */
      const rows = docs.map((doc) => {
        const comp = companiesById.get(doc.companyId) ?? null;
        const matched = matchCustomer(comp, customers);
        const alreadyBookedId = existingByNumber.get(String(doc.number)) ?? null;
        const mult = doc.kind === 'creditNote' && doc.total > 0 ? -1 : 1;
        /** @type {string | null} */
        let problem = null;
        /** @type {InvoicePreviewRow['lines']} */
        const mappedLines = [];

        if (!alreadyBookedId) {
          if (!comp) {
            problem = `RecMan company #${doc.companyId} not found.`;
          } else if (doc.lines.length === 0 || doc.total === 0) {
            problem = 'Document has no priced lines.';
          } else {
            for (const l of doc.lines) {
              const prod = productsById.get(l.productId);
              const acct = l.creditAccount || prod?.creditAccount || '';
              const vatCode = l.vatCode || prod?.vatCode || '';
              if (!/^3[0-9]{3}$/.test(acct) || !validAccounts.has(acct)) {
                problem = `Revenue account "${acct || 'missing'}" on "${l.description}" is not available in ReAI.`;
                break;
              }
              if (!vatCode || !vatByCode.has(vatCode)) {
                problem = `VAT code "${vatCode || 'missing'}" (${l.vatPercent}%) is not enabled for sales in ReAI company settings.`;
                break;
              }
              if (Number(vatByCode.get(vatCode)) !== l.vatPercent) {
                problem = `VAT code ${vatCode} is ${vatByCode.get(vatCode)}% in ReAI, but line has ${l.vatPercent}%.`;
                break;
              }
              mappedLines.push({
                itemName: l.description.slice(0, 255) || 'RecMan line',
                quantity: l.qty,
                unitPrice: Number((l.price * mult).toFixed(2)),
                netAmount: Number((l.sumExclVat * mult).toFixed(2)),
                taxAmount: Number((l.sumVat * mult).toFixed(2)),
                accountNumber: acct,
                vatCode,
              });
            }
          }
        }

        return {
          doc,
          company: comp,
          matchedCustomerId: matched?.id ?? null,
          alreadyBookedId,
          problem,
          lines: mappedLines,
        };
      });

      return htmlResponse(renderInvoiceResults({ rows, customers, apiKey, recmanCalls: client.getCalls() }));
    }

    if (pathname === '/app/recman/book-invoice') {
      const apiKey = String(form.get('recmanKey') ?? '').trim();
      const doc = /** @type {import('./core.js').RecManDocument} */ (JSON.parse(String(form.get('docJson') ?? '{}')));
      const comp = /** @type {import('./core.js').RecManCompany | null} */ (JSON.parse(String(form.get('companyJson') ?? 'null')));
      const lines = /** @type {InvoicePreviewRow['lines']} */ (JSON.parse(String(form.get('linesJson') ?? '[]')));
      const choice = String(form.get('customerChoice') ?? '').trim();
      if (!doc.id || !lines.length || !choice) {
        throw new HttpError(400, 'Select a valid ReAI customer before booking.');
      }

      let customerId = Number(choice);
      if (choice === 'create') {
        if (!comp?.orgnr || !comp.name) {
          throw new HttpError(400, 'A valid 9-digit Norwegian org.nr is required to create the customer.');
        }
        const createdCust = /** @type {{ id: number }} */ (
          await reaiRequest(env, '/api/customers', {
            token: session.accessToken,
            tenantId: company.id,
            method: 'POST',
            body: {
              name: comp.name.slice(0, 75),
              organizationNumber: comp.orgnr,
              countryCode: 'NO',
              privateContact: false,
              skipRegistryLookup: true,
              ...(comp.number && comp.number !== '0' ? { number: comp.number } : {}),
            },
          })
        );
        customerId = createdCust.id;
      }

      const client = createRecManClient(apiKey);
      const pdfBase64 = await client.fetchPdfBase64(doc.kind, doc.id);

      const externalRef = `recman-${doc.key}`;
      const daysUntilDue =
        doc.kind === 'invoice' && doc.dueDate
          ? Math.max(0, Math.round((Date.parse(`${doc.dueDate}T00:00:00Z`) - Date.parse(`${doc.date}T00:00:00Z`)) / 86_400_000))
          : 0;

      /** @type {number} */
      let orderId = 0;
      try {
        const order = /** @type {{ id: number }} */ (
          await reaiRequest(env, '/api/orders', {
            token: session.accessToken,
            tenantId: company.id,
            method: 'POST',
            body: {
              externalReference: externalRef,
              customerId,
              currencyCode: 'NOK',
              orderDate: doc.date,
              issueDate: doc.date,
              daysUntilDue,
              sendEhf: false,
              orderLines: lines.map((l) => ({
                itemName: l.itemName,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                vatCode: l.vatCode,
              })),
            },
          })
        );
        orderId = order.id;
      } catch (err) {
        if (err instanceof HttpError && err.status === 409) {
          const existingOrders = /** @type {Array<{ id: number }>} */ (
            await reaiAll(env, '/api/orders', {
              token: session.accessToken,
              tenantId: company.id,
              query: { externalReference: externalRef },
            })
          );
          orderId = existingOrders[0]?.id ?? 0;
        }
        if (!orderId) {
          throw err;
        }
      }

      const imported = /** @type {{ id: number }} */ (
        await reaiRequest(env, '/api/invoices/import', {
          token: session.accessToken,
          tenantId: company.id,
          method: 'POST',
          body: {
            source: 'recman',
            sourceInstance: `department-${doc.departmentId}`,
            externalId: doc.key,
            number: String(doc.number),
            customerId,
            issueDate: doc.date,
            ...(doc.kind === 'invoice' && doc.dueDate ? { dueDate: doc.dueDate } : {}),
            ...(doc.kid ? { paymentReference: doc.kid } : {}),
            accounting: 'book',
            automaticRemindersEnabled: false,
            orderId,
            snapshotLines: lines.map((l) => ({
              orderId,
              itemName: l.itemName,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              netAmount: l.netAmount,
              taxAmount: l.taxAmount,
              vatCode: l.vatCode,
              accountNumber: l.accountNumber,
            })),
            originalPdf: {
              filename: `${doc.kind}-${doc.number}.pdf`,
              contentBase64: pdfBase64,
            },
          },
        })
      );

      const url = `${reaiOrigin(env)}/invoice/${imported.id}?tenantId=${company.id}`;
      const mult = doc.kind === 'creditNote' && doc.total > 0 ? -1 : 1;
      return htmlResponse(html`<tr>
        <td class="mono"><strong>${doc.kind === 'creditNote' ? 'CN' : 'INV'} ${doc.number}</strong></td>
        <td class="mono">${doc.date}</td>
        <td>${comp?.name ?? `Customer #${customerId}`}</td>
        <td class="mono">${doc.kid || '—'}</td>
        <td class="num">${formatMinor(Math.round(doc.total * mult * 100))}</td>
        <td>${reaiBadge({ text: `Booked #${imported.id} (PDF attached)`, tone: 'success' })}</td>
        <td><a href="${url}" target="_blank" rel="noopener">Open in ReAI ↗</a></td>
      </tr>`);
    }

    if (pathname === '/app/recman/scan-payroll') {
      const apiKey = String(form.get('recmanKey') ?? '').trim();
      const minPaycheckId = String(form.get('minPaycheckId') ?? '').trim();
      const client = createRecManClient(apiKey);

      const [payRaw, candRaw, projRaw, compRaw, reaiEmployeesRaw, salarySettings] = await Promise.all([
        client.fetchAll('paycheck', { exported: '0', ...(minPaycheckId ? { minPaycheckId } : {}) }),
        client.fetchAll('candidate', { isEmployee: '1', fields: 'firstName,lastName,email,employment' }),
        client.fetchAll('project', { fields: 'name,companyId' }),
        client.fetchAll('company', { fields: 'name,number,vatNumber,visitAddress' }),
        reaiRequest(env, '/api/employees', { token: session.accessToken, tenantId: company.id }),
        reaiRequest(env, '/api/salary-settings', { token: session.accessToken, tenantId: company.id }).catch(() => ({ payoutDayOfMonth: 31 })),
      ]);

      const paychecks = parseRecManPaychecks(payRaw);
      const candidatesById = new Map(parseRecManCandidates(candRaw).map((c) => [c.candidateId, c]));
      const projectsById = new Map(
        projRaw.map((p) => [Number(p.projectId ?? p.id ?? 0), { projectId: Number(p.projectId ?? p.id ?? 0), companyId: Number(p.companyId ?? 0), name: String(p.name ?? '').trim() }]),
      );
      const companiesById = new Map(parseRecManCompanies(compRaw).map((c) => [c.companyId, c]));
      const reaiEmployees = Array.isArray(reaiEmployeesRaw) ? /** @type {ReAIEmployeeSummary[]} */ (reaiEmployeesRaw) : [];

      // Batch workIds (100 per RecMan call) to resolve workplace addresses → Kartverket AGA municipalities
      const workIds = [...new Set(paychecks.flatMap((p) => p.lines.map((l) => l.workId).filter((id) => id > 0)))].slice(0, 600);
      /** @type {Map<number, { label: string, address: import('./core.js').RecManAddress | null }>} */
      const workplacesByWorkId = new Map();
      for (let i = 0; i < workIds.length; i += 100) {
        const batch = workIds.slice(i, i + 100);
        const works = await client.fetchAll('work', { workIds: batch.join(',') }, 2);
        for (const w of works) {
          const wId = Number(w.workId ?? w.id ?? 0);
          const proj = projectsById.get(Number(w.projectId ?? 0));
          const comp = proj ? companiesById.get(proj.companyId) : undefined;
          const label = [proj?.name || `Project #${w.projectId}`, comp?.name, comp?.visitAddress?.label].filter(Boolean).join(' · ');
          workplacesByWorkId.set(wId, { label, address: comp?.visitAddress ?? null });
        }
      }

      const allAddresses = [...workplacesByWorkId.values()]
        .map((w) => w.address)
        .filter((a) => a !== null);
      const kartverketByLabel = await lookupWorkplaceMunicipalities(allAddresses);
      const payoutDay = typeof (/** @type {any} */ (salarySettings))?.payoutDayOfMonth === 'number' ? Number((/** @type {any} */ (salarySettings)).payoutDayOfMonth) : 31;

      /** @type {PayrollPreviewRow[]} */
      const rows = paychecks.map((pc) => {
        const cand = candidatesById.get(pc.candidateId) ?? null;
        const empMatch = cand
          ? reaiEmployees.find(
              (e) =>
                (cand.email && (e.email ?? '').toLowerCase() === cand.email.toLowerCase()) ||
                e.name.trim().toLowerCase() === cand.name.trim().toLowerCase(),
            )
          : undefined;
        const months = new Set(pc.lines.flatMap((l) => [l.startDate.slice(0, 7), l.endDate.slice(0, 7)]).filter((m) => /^[0-9]{4}-[0-9]{2}$/.test(m)));
        const period = months.size === 1 ? ([...months][0] ?? '') : '';
        const paymentDate = period ? computeDraftPaymentDate(period, payoutDay) : '';

        const workPlaces = [...new Set(pc.lines.map((l) => l.workId).filter((id) => id > 0))]
          .map((id) => workplacesByWorkId.get(id))
          .filter((w) => w !== undefined);
        const workplaceLabels = [...new Set(workPlaces.map((w) => w.label).filter(Boolean))];
        /** @type {Map<string, import('./core.js').MunicipalityMatch>} */
        const munMap = new Map();
        for (const wp of workPlaces) {
          if (wp.address) {
            const m = kartverketByLabel.get(wp.address.label);
            if (m) {
              munMap.set(m.code, m);
            }
          }
        }
        const municipalities = [...munMap.values()].sort((a, b) => a.code.localeCompare(b.code));

        const emp = cand?.employments[0];
        const validBank =
          (emp?.bankAccount ? verifiedNorwegianAccount(emp.bankAccount) : '') ||
          (emp?.iban ? verifiedNorwegianIban(emp.iban) : '');

        /** @type {string | null} */
        let heldReason = null;
        if (!cand) {
          heldReason = `Candidate #${pc.candidateId} not found in RecMan employees.`;
        } else if (!period) {
          heldReason = 'Paycheck lines span multiple payroll months — split or review manually in RecMan.';
        } else if (municipalities.length > 1) {
          heldReason = `Workplace addresses span multiple AGA municipalities: ${municipalities.map((m) => m.label).join(', ')}. Verify the applicable employment municipality and AGA zone in ReAI before importing.`;
        }

        return {
          paycheck: pc,
          candidate: cand,
          reaiEmployeeId: empMatch?.id ?? null,
          period,
          paymentDate,
          municipalities,
          workplaceLabels,
          validBank,
          heldReason,
          lines: pc.lines.map((line) => ({
            line,
            suggestedCode: suggestWageCode(line.articleType, line.articleName),
          })),
        };
      });

      return htmlResponse(renderPayrollResults({ rows, recmanCalls: client.getCalls() }));
    }

    if (pathname === '/app/recman/import-paycheck') {
      const pc = /** @type {import('./core.js').RecManPaycheck} */ (JSON.parse(String(form.get('paycheckJson') ?? '{}')));
      const cand = /** @type {import('./core.js').RecManCandidate | null} */ (JSON.parse(String(form.get('candidateJson') ?? 'null')));
      let employeeId = Number(form.get('reaiEmployeeId') ?? '0');
      const period = String(form.get('period') ?? '').trim();
      const paymentDate = String(form.get('paymentDate') ?? '').trim();
      const municipality = String(form.get('municipality') ?? '').trim();
      const validBank = String(form.get('validBank') ?? '').trim();

      if (!pc.paycheckId || !cand || !/^[0-9]{4}-[0-9]{2}$/.test(period) || !/^[0-9]{4}$/.test(municipality)) {
        throw new HttpError(400, 'Valid paycheck, payroll period and 4-digit AGA municipality code are required.');
      }

      const codes = pc.lines.map((_, idx) => String(form.get(`wageCode_${idx}`) ?? '').trim());
      if (codes.some((c) => !c)) {
        throw new HttpError(400, 'Select a ReAI wage specification code for every paycheck line.');
      }

      // 1. Create or update employee with municipality & bank account
      if (employeeId <= 0) {
        const emp = cand.employments[0];
        const startDate = emp?.startDate || pc.lines[0]?.startDate || `${period}-01`;
        const createdEmp = /** @type {{ id: number }} */ (
          await reaiRequest(env, '/api/employees', {
            token: session.accessToken,
            tenantId: company.id,
            method: 'POST',
            body: {
              name: cand.name.slice(0, 75),
              ...(cand.email ? { email: cand.email } : {}),
              dateOfEmployment: startDate,
              ...(emp?.endDate ? { endDateOfEmployment: emp.endDate } : {}),
              ...(validBank ? { accountNumber: validBank, bankCountryCode: 'NO' } : {}),
              employmentLines: [
                {
                  startDate,
                  percentage: emp?.positionPercent && emp.positionPercent > 0 ? emp.positionPercent : 100,
                  municipality,
                },
              ],
            },
          })
        );
        employeeId = createdEmp.id;
      } else {
        const detail = /** @type {ReAIEmployeeDetail} */ (
          await reaiRequest(env, `/api/employees/${employeeId}`, { token: session.accessToken, tenantId: company.id })
        );
        const rel = detail.employmentRelations?.[0];
        const firstLine = rel?.employmentLines?.[0];
        /** @type {Record<string, unknown>} */
        const patch = {};
        if (firstLine && !firstLine.municipality) {
          patch.employmentLines = [{ ...firstLine, municipality }];
        }
        if (validBank && !detail.bankAccount?.accountNumber) {
          patch.accountNumber = validBank;
          patch.bankCountryCode = 'NO';
        }
        if (Object.keys(patch).length > 0) {
          await reaiRequest(env, `/api/employees/${employeeId}`, {
            token: session.accessToken,
            tenantId: company.id,
            method: 'PATCH',
            body: patch,
          });
        }
      }

      // 2. Find or create editable draft salary payment for period
      const runs = /** @type {Array<{ id: number, status: string, periodYear: number, periodMonth: number }>} */ (
        await reaiRequest(env, '/api/salary-payments', {
          token: session.accessToken,
          tenantId: company.id,
          query: { startDate: `${period}-01`, endDate: `${period}-01` },
        })
      );
      const [yNum, mNum] = period.split('-').map(Number);
      const monthRun = runs.find((r) => r.periodYear === yNum && r.periodMonth === mNum);
      let salaryId = 0;
      if (monthRun) {
        if (monthRun.status !== 'under_process') {
          throw new HttpError(409, `Salary payment #${monthRun.id} for ${period} is already finalized (${monthRun.status}).`);
        }
        salaryId = monthRun.id;
      } else {
        const createdRun = /** @type {{ id: number }} */ (
          await reaiRequest(env, '/api/salary-payments', {
            token: session.accessToken,
            tenantId: company.id,
            method: 'POST',
            body: { period, paymentDate, employeeIds: [employeeId] },
          })
        );
        salaryId = createdRun.id;
      }

      // 3. Check existing wage-spec markers on draft for idempotency
      const draftDetail = /** @type {{ employees?: Array<{ employeeId?: number, wageSpecs?: Array<{ comment?: string | null }> }> }} */ (
        await reaiRequest(env, `/api/salary-payments/${salaryId}`, { token: session.accessToken, tenantId: company.id })
      );
      const existingComments = new Set(
        (draftDetail.employees ?? [])
          .find((e) => e.employeeId === employeeId)
          ?.wageSpecs?.map((w) => w.comment ?? '') ?? [],
      );

      let added = 0;
      for (let i = 0; i < pc.lines.length; i++) {
        const line = pc.lines[i];
        const code = codes[i];
        if (!line || !code) {
          continue;
        }
        const marker = `recman-paycheck-${pc.departmentId}-${pc.paycheckId}-line-${line.paycheckLineId}`;
        if (existingComments.has(marker)) {
          continue;
        }
        await reaiRequest(env, `/api/salary-payments/${salaryId}/wage-specs`, {
          token: session.accessToken,
          tenantId: company.id,
          method: 'POST',
          body: {
            employeeId,
            specificationCode: code,
            quantity: Number(line.qty.toFixed(2)),
            rate: Number(line.amount.toFixed(2)),
            comment: marker,
          },
        });
        added += 1;
      }

      const url = `${reaiOrigin(env)}/salary/${salaryId}?tenantId=${company.id}`;
      return htmlResponse(
        reaiCallout({
          tone: 'success',
          title: `Updated ReAI draft payroll #${salaryId} (${period})`,
          body: html`Added <strong>${added}</strong> wage line${added === 1 ? '' : 's'} for <strong>${cand.name}</strong> (municipality <code class="mono">${municipality}</code>). Draft remains unfinalized (no A-melding or payment sent): <a href="${url}" target="_blank" rel="noopener">Open draft payroll in ReAI ↗</a>.`,
        }),
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'RecMan sync failed.';
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'RecMan operation failed', body: msg }));
  }

  return errorResponse('Unknown RecMan route.', 404);
}
