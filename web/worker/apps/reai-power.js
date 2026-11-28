// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';
import { extractNorwegianOrg } from './recman-core.js';

/**
 * @typedef {'brreg-leads' | 'aksjonaer' | 'assets' | 'budget' | 'mrr' | 'gift-cards' | 'accountant-hub' | 'stock-count'} PowerSlug
 */

/** @type {Record<PowerSlug, { eyebrow: string, title: string, lead: string, brand: string }>} */
const META = {
  'brreg-leads': {
    brand: 'Brreg Prospecting',
    eyebrow: 'LIVE BRØNNØYSUNDREGISTRENE → REAI LEADS',
    title: 'Brreg Company Search & Lead Importer',
    lead: 'Search Norway’s live official Brønnøysundregistrene (Enhetsregisteret) by name, NACE industry code or municipality and save companies straight to ReAI Leads (POST /api/leads) in one click.',
  },
  aksjonaer: {
    brand: 'Aksjonær & Investments',
    eyebrow: 'NORDNET / VPS / DNB → REAI SHARE INVESTMENTS',
    title: 'Norwegian Equity & Share Investment Importer',
    lead: 'Import Norwegian listed/unlisted share holdings (Nordnet, VPS, DNB, RF-1086 CSV) directly into ReAI Share Investments (POST /api/share-investments) with fritaksmetoden tagging.',
  },
  assets: {
    brand: 'Fixed Assets',
    eyebrow: 'ANLEGGSMIDLER & SALDOAVSKRIVNING',
    title: 'Fixed Asset Register Importer',
    lead: 'Import Norwegian fixed assets (saldogruppe a–j, account 1200–1299) from Excel/Tripletex/Visma straight into ReAI Fixed Assets (POST /api/assets) and audit existing assets.',
  },
  budget: {
    brand: 'Company Budget',
    eyebrow: 'NS 4102 MONTHLY BUDGET → REAI',
    title: '12-Month Budget Importer & Inspector',
    lead: 'Upload a 12-month NS 4102 account budget CSV straight into ReAI (PUT /api/company-budgets/{year}) and inspect your active budget lines live.',
  },
  mrr: {
    brand: 'SaaS MRR / ARR',
    eyebrow: 'REAI SUBSCRIPTIONS & RECURRING BILLING',
    title: 'Live MRR, ARR & Subscription Billing Hub',
    lead: 'Monitor Monthly Recurring Revenue (MRR), Annual Recurring Revenue (ARR), active contracts and trigger due recurring invoices directly via ReAI /api/subscriptions.',
  },
  'gift-cards': {
    brand: 'Gift Cards',
    eyebrow: 'REAI GIFT CARD LIABILITY (2900)',
    title: 'Gift Card Issuer & Liability Console',
    lead: 'Issue new gift cards (POST /api/gift-cards), check live remaining balances by code and audit outstanding Norwegian gift-card liability across your company.',
  },
  'accountant-hub': {
    brand: 'Accountant Control Tower',
    eyebrow: 'REGNSKAPSFØRER PORTFOLIO DASHBOARD',
    title: 'Multi-Client Accountant Control Tower',
    lead: 'Fast cross-client control panel for Norwegian accounting firms using ReAI — inspect all engagements, start dates, assignees and status from GET /api/accountant-clients.',
  },
  'stock-count': {
    brand: 'Warehouse Stock Count',
    eyebrow: 'REAI WAREHOUSES & INVENTORY VALUATION',
    title: 'Warehouse Inventory & Stocktake Console',
    lead: 'Inspect live stock-on-hand, SKU cost value and retail value across every ReAI warehouse (GET /api/warehouses & GET /api/warehouses/inventory) on desktop or mobile.',
  },
};

/**
 * Handles all 8 native ReAI OpenAPI power-tool web apps.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @param {PowerSlug} slug
 * @returns {Promise<Response>}
 */
export async function handleReaiPower(request, env, slug) {
  const meta = META[slug];
  const { pathname } = new URL(request.url);
  const basePath = `/app/${slug}`;

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  }

  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const year = new Date().getUTCFullYear();
    const today = new Date().toISOString().slice(0, 10);

    let toolCard;
    if (slug === 'brreg-leads') {
      toolCard = reaiCard({
        eyebrow: 'LIVE BRREG ENHETSSØK (OPEN PUBLIC API)',
        title: 'Search Norwegian companies & import to ReAI Leads',
        body: html`<form class="stack" hx-post="${basePath}/search" hx-target="#pw-output" hx-swap="innerHTML">
          <div class="mapping-grid">
            <div class="field"><label for="br-q">Company name or keyword</label><input id="br-q" name="q" type="text" placeholder="e.g. Bygg, Frisør, Regnskap"></div>
            <div class="field"><label for="br-nace">NACE code (optional)</label><input id="br-nace" name="nace" type="text" placeholder="e.g. 62.010"></div>
            <div class="field"><label for="br-form">Org form</label><select id="br-form" name="orgform"><option value="AS">AS (Aksjeselskap)</option><option value="ENK">ENK (Enkeltpersonforetak)</option><option value="">Any</option></select></div>
          </div>
          <div class="inline-row">
            <button type="submit" class="button primary">Search Brreg live</button>
            <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#pw-output" hx-swap="innerHTML">Load sample results</button>
          </div>
        </form>`,
      });
    } else if (slug === 'aksjonaer') {
      toolCard = reaiCard({
        eyebrow: 'UPLOAD SHARE PORTFOLIO CSV OR LOAD LIVE HOLDINGS',
        title: 'Import equity holdings to /api/share-investments',
        body: html`<form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#pw-output" hx-swap="innerHTML">
          ${reaiDropzone({ inputId: 'ak-csv', name: 'file', accept: '.csv,text/csv', label: 'Choose portfolio CSV', hint: 'Columns: Name, Ticker, ISIN, Type (listed_share/unlisted_share/fund), Account (1350/1810), Quantity, CostAmount, Date, Exemption (true/false).' })}
          <div class="inline-row">
            <button type="submit" class="button primary">Preview portfolio CSV</button>
            <button type="button" class="button secondary" hx-post="${basePath}/live" hx-target="#pw-output" hx-swap="innerHTML">Load live ReAI holdings</button>
            <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#pw-output" hx-swap="innerHTML">Load sample portfolio</button>
          </div>
        </form>`,
      });
    } else if (slug === 'assets') {
      toolCard = reaiCard({
        eyebrow: 'FIXED ASSETS → POST /api/assets',
        title: 'Register or import Norwegian fixed assets',
        body: html`<form class="stack" hx-post="${basePath}/create" hx-target="#pw-output" hx-swap="innerHTML">
          <div class="mapping-grid">
            <div class="field"><label for="as-n">Asset name</label><input id="as-n" name="name" type="text" required placeholder="MacBook Pro M4 / Firmabil"></div>
            <div class="field"><label for="as-a">Account (1xxx)</label><input id="as-a" name="accountNumber" type="text" required value="1280"></div>
            <div class="field"><label for="as-d">Acquisition date</label><input id="as-d" name="acquisitionDate" type="date" value="${today}" required></div>
            <div class="field"><label for="as-c">Cost (NOK)</label><input id="as-c" name="acquisitionCost" type="number" step="0.01" min="0" required value="34900"></div>
            <div class="field"><label for="as-m">Useful life (months)</label><input id="as-m" name="usefulLifeInMonths" type="number" min="1" value="36" required></div>
          </div>
          <div class="inline-row">
            <button type="submit" class="button primary">Create fixed asset in ReAI</button>
            <button type="button" class="button secondary" hx-post="${basePath}/live" hx-target="#pw-output" hx-swap="innerHTML">Load live ReAI assets</button>
            <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#pw-output" hx-swap="innerHTML">Load sample register</button>
          </div>
        </form>`,
      });
    } else if (slug === 'budget') {
      toolCard = reaiCard({
        eyebrow: 'COMPANY BUDGET → PUT /api/company-budgets/{year}',
        title: 'Upload 12-month NS 4102 budget CSV or load active budget',
        body: html`<form class="stack" hx-post="${basePath}/upload" hx-encoding="multipart/form-data" hx-target="#pw-output" hx-swap="innerHTML">
          <div class="field"><label for="bg-y">Fiscal year</label><input id="bg-y" name="year" type="number" min="2020" max="2035" value="${year}" required></div>
          ${reaiDropzone({ inputId: 'bg-csv', name: 'file', accept: '.csv,text/csv', label: 'Choose 12-month budget CSV', hint: 'Columns: Account, Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec.' })}
          <div class="inline-row">
            <button type="submit" class="button primary">Upload & save to ReAI</button>
            <button type="button" class="button secondary" hx-post="${basePath}/live" hx-include="#bg-y" hx-target="#pw-output" hx-swap="innerHTML">Load live ReAI budget</button>
            <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#pw-output" hx-swap="innerHTML">Load sample budget</button>
          </div>
        </form>`,
      });
    } else if (slug === 'gift-cards') {
      toolCard = reaiCard({
        eyebrow: 'GIFT CARDS → /api/gift-cards',
        title: 'Issue gift card or audit outstanding balances',
        body: html`<form class="stack" hx-post="${basePath}/issue" hx-target="#pw-output" hx-swap="innerHTML">
          <div class="inline-row">
            <div class="field"><label for="gc-a">Amount (NOK)</label><input id="gc-a" name="amount" type="number" step="1" min="1" value="1000" required></div>
            <div class="field"><label for="gc-r">Reference</label><input id="gc-r" name="reference" type="text" placeholder="POS / Web order #"></div>
          </div>
          <div class="inline-row">
            <button type="submit" class="button primary">Issue gift card in ReAI</button>
            <button type="button" class="button secondary" hx-post="${basePath}/live" hx-target="#pw-output" hx-swap="innerHTML">Load all live gift cards</button>
            <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#pw-output" hx-swap="innerHTML">Load sample report</button>
          </div>
        </form>`,
      });
    } else {
      toolCard = reaiCard({
        eyebrow: `LIVE REAI DATA · ${meta.brand.toUpperCase()}`,
        title: `Fetch live ${meta.brand} data from your connected ReAI company`,
        body: html`<div class="inline-row">
          <button type="button" class="button primary" hx-post="${basePath}/live" hx-target="#pw-output" hx-swap="innerHTML">Load live from ReAI</button>
          ${slug === 'mrr' ? html`<button type="button" class="button secondary" hx-post="${basePath}/generate-due" hx-target="#pw-output" hx-swap="innerHTML">Generate due invoices</button>` : ''}
          <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#pw-output" hx-swap="innerHTML">Load sample dashboard</button>
        </div>`,
      });
    }

    const body = html`
      <section class="app-intro"><p class="eyebrow">${meta.eyebrow}</p><h1>${meta.title}</h1><p class="lead">${meta.lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${slug}-web`, clientName: `ReAI ${meta.brand} (Web)` })}
        ${toolCard}
        <div id="pw-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: meta.title, description: meta.lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${basePath}/sample`) {
    if (slug === 'brreg-leads') {
      return htmlResponse(
        reaiCard({
          eyebrow: 'BRREG SAMPLE PROSPECTS',
          title: '2 Norwegian companies matched',
          badge: reaiBadge({ text: 'Sample', tone: 'accent' }),
          body: html`<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Org.nr</th><th>Company</th><th>City</th><th>NACE</th><th>Employees</th></tr></thead>
            <tbody>
              <tr><td class="mono">935606403</td><td><strong>Fjord Demo Teknologi AS</strong></td><td>Oslo</td><td class="mono">62.010</td><td class="num">14</td></tr>
              <tr><td class="mono">923609016</td><td><strong>Vestland Byggservice AS</strong></td><td>Bergen</td><td class="mono">41.200</td><td class="num">28</td></tr>
            </tbody>
          </table></div>`,
        }),
      );
    }
    if (slug === 'mrr') {
      return htmlResponse(
        reaiCard({
          eyebrow: 'REAI SUBSCRIPTIONS SAMPLE',
          title: 'Live SaaS & Retainer Metrics',
          badge: reaiBadge({ text: 'Sample', tone: 'accent' }),
          body: html`<div class="metric-grid">
            ${reaiMetric({ label: 'Active MRR', value: '148 500,00 NOK', detail: '24 active recurring contracts' })}
            ${reaiMetric({ label: 'Annualized ARR', value: '1 782 000,00 NOK', detail: 'MRR × 12' })}
            ${reaiMetric({ label: 'Due for billing', value: '3 contracts', detail: 'Ready for POST /api/subscriptions/generate-due' })}
          </div>`,
        }),
      );
    }
    if (slug === 'accountant-hub') {
      return htmlResponse(
        reaiCard({
          eyebrow: 'REGNSKAPSFØRER PORTFOLIO SAMPLE',
          title: '3 active ReAI accounting clients',
          badge: reaiBadge({ text: 'Sample', tone: 'accent' }),
          body: html`<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Client</th><th>Org.nr</th><th>Start date</th><th>Status</th></tr></thead>
            <tbody>
              <tr><td><strong>Nordic Bakeri AS</strong></td><td class="mono">935606403</td><td>2025-01-01</td><td>${reaiBadge({ text: 'Active', tone: 'success' })}</td></tr>
              <tr><td><strong>Fjord Elektro AS</strong></td><td class="mono">923609016</td><td>2026-01-01</td><td>${reaiBadge({ text: 'Active', tone: 'success' })}</td></tr>
            </tbody>
          </table></div>`,
        }),
      );
    }
    return htmlResponse(
      reaiCard({
        eyebrow: `${meta.brand.toUpperCase()} SAMPLE`,
        title: `Live ReAI ${meta.brand} preview`,
        badge: reaiBadge({ text: 'Sample', tone: 'accent' }),
        body: html`<div class="metric-grid">
          ${reaiMetric({ label: 'Records', value: '12', detail: 'Mapped to live ReAI Public API' })}
          ${reaiMetric({ label: 'Total NOK', value: '485 200,00 NOK', detail: 'NS 4102 compliant' })}
          ${reaiMetric({ label: 'Add-on fee', value: '0 NOK', detail: 'Included free with ReAI' })}
        </div>`,
      }),
    );
  }

  try {
    const form = await request.formData();

    // Brreg search requires zero ReAI auth (open Norwegian government registry!)
    if (slug === 'brreg-leads' && pathname === `${basePath}/search`) {
      const q = String(form.get('q') ?? '').trim();
      const nace = String(form.get('nace') ?? '').trim();
      const orgform = String(form.get('orgform') ?? '').trim();
      const params = new URLSearchParams({ size: '25' });
      if (q) params.set('navn', q);
      if (nace) params.set('naeringskode', nace);
      if (orgform) params.set('organisasjonsform', orgform);
      const res = await fetch(`https://data.brreg.no/enhetsregisteret/api/enheter?${params}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new HttpError(502, `Brreg Enhetsregisteret returned HTTP ${res.status}.`);
      const data = /** @type {any} */ (await res.json());
      const rows = /** @type {any[]} */ (data?._embedded?.enheter ?? []);
      return htmlResponse(
        reaiCard({
          eyebrow: 'BRØNNØYSUNDREGISTRENE LIVE RESULTS',
          title: `${rows.length} Norwegian companies found`,
          badge: reaiBadge({ text: 'Live Brreg API', tone: 'success' }),
          body: html`<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Org.nr</th><th>Company</th><th>City</th><th>NACE</th><th class="num">Employees</th><th>Action</th></tr></thead>
            <tbody>${rows.map(
              (r, idx) => html`<tr id="br-r-${idx}">
                <td class="mono">${r.organisasjonsnummer}</td>
                <td><strong>${r.navn}</strong></td>
                <td>${r.forretningsadresse?.poststed ?? '—'}</td>
                <td class="mono">${r.naeringskode1?.kode ?? '—'}</td>
                <td class="num">${r.antallAnsatte ?? 0}</td>
                <td><form hx-post="/app/brreg-leads/import-lead" hx-target="#br-r-${idx}" hx-swap="outerHTML">
                  <input type="hidden" name="orgnr" value="${r.organisasjonsnummer}">
                  <input type="hidden" name="name" value="${r.navn}">
                  <button type="submit" class="button primary">Save lead</button>
                </form></td>
              </tr>`,
            )}</tbody>
          </table></div>`,
        }),
      );
    }

    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');

    if (slug === 'brreg-leads' && pathname === `${basePath}/import-lead`) {
      const orgnr = extractNorwegianOrg(String(form.get('orgnr') ?? ''));
      const name = String(form.get('name') ?? '');
      if (!orgnr) throw new HttpError(400, 'Invalid 9-digit Norwegian org number.');
      const saved = /** @type {{ organizationNumber: string, companyName: string, webUrl?: string }} */ (
        await reaiRequest(env, '/api/leads', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: { organizationNumber: orgnr },
        })
      );
      return htmlResponse(html`<tr><td class="mono">${orgnr}</td><td colspan="4"><strong>${saved.companyName || name}</strong></td><td>${reaiBadge({ text: 'Saved in ReAI Leads', tone: 'success' })}</td></tr>`);
    }

    if (slug === 'aksjonaer' && pathname === `${basePath}/live`) {
      const list = /** @type {any[]} */ (await reaiAll(env, '/api/share-investments', { token: session.accessToken, tenantId: session.tenantId }));
      const totalCost = list.reduce((s, x) => s + (Number(x.costPrice ?? 0) * Number(x.quantity ?? 0)), 0);
      return htmlResponse(
        reaiCard({
          eyebrow: 'LIVE REAI SHARE INVESTMENTS',
          title: `${list.length} holdings in ReAI`,
          badge: reaiBadge({ text: 'Live API', tone: 'success' }),
          body: html`
            <div class="metric-grid">
              ${reaiMetric({ label: 'Holdings', value: String(list.length), detail: 'GET /api/share-investments' })}
              ${reaiMetric({ label: 'Total cost basis', value: `${formatMinor(Math.round(totalCost * 100))} NOK`, detail: 'Book cost value' })}
            </div>
            <div class="table-wrap"><table class="data-table">
              <thead><tr><th>Name</th><th>Ticker / ISIN</th><th>Account</th><th class="num">Qty</th><th class="num">Cost price</th></tr></thead>
              <tbody>${list.slice(0, 100).map((x) => html`<tr><td><strong>${x.name}</strong></td><td class="mono">${x.ticker || x.isin || '—'}</td><td class="mono">${x.assetAccountNumber || '—'}</td><td class="num">${x.quantity}</td><td class="num">${Number(x.costPrice ?? 0).toFixed(2)}</td></tr>`)}</tbody>
            </table></div>
          `,
        }),
      );
    }

    if (slug === 'aksjonaer' && pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a portfolio CSV file.');
      const doc = parseCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer())));
      const h = doc.headers.map((x) => x.toLowerCase().trim());
      const nameIdx = h.findIndex((x) => x.includes('name') || x.includes('navn') || x.includes('selskap'));
      const tickIdx = h.findIndex((x) => x.includes('tick'));
      const isinIdx = h.findIndex((x) => x.includes('isin'));
      const qtyIdx = h.findIndex((x) => x.includes('qty') || x.includes('antall') || x.includes('quantity'));
      const costIdx = h.findIndex((x) => x.includes('cost') || x.includes('kost'));
      if (nameIdx < 0) throw new HttpError(400, 'CSV needs a Name / Navn column.');
      const rows = doc.rows
        .map((r) => ({
          name: (r[nameIdx] ?? '').trim(),
          ticker: tickIdx >= 0 ? (r[tickIdx] ?? '').trim() : '',
          isin: isinIdx >= 0 ? (r[isinIdx] ?? '').trim() : '',
          qty: qtyIdx >= 0 ? Number((r[qtyIdx] ?? '0').replace(',', '.')) || 0 : 0,
          cost: costIdx >= 0 ? Number((r[costIdx] ?? '0').replace(',', '.')) || 0 : 0,
        }))
        .filter((x) => x.name);
      return htmlResponse(
        reaiCard({
          eyebrow: 'PORTFOLIO CSV PREVIEW',
          title: `${rows.length} holdings parsed`,
          body: html`<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Name</th><th>Ticker</th><th>ISIN</th><th class="num">Qty</th><th class="num">Cost (NOK)</th><th>Action</th></tr></thead>
            <tbody>${rows.slice(0, 80).map(
              (r, idx) => html`<tr id="ak-r-${idx}">
                <td><strong>${r.name}</strong></td><td class="mono">${r.ticker || '—'}</td><td class="mono">${r.isin || '—'}</td><td class="num">${r.qty}</td><td class="num">${r.cost.toFixed(2)}</td>
                <td><form hx-post="/app/aksjonaer/import-one" hx-target="#ak-r-${idx}" hx-swap="outerHTML">
                  <input type="hidden" name="rowJson" value="${JSON.stringify(r)}">
                  <button type="submit" class="button primary">Import</button>
                </form></td>
              </tr>`,
            )}</tbody>
          </table></div>`,
        }),
      );
    }

    if (slug === 'aksjonaer' && pathname === `${basePath}/import-one`) {
      const r = /** @type {{ name: string, ticker: string, isin: string, qty: number, cost: number }} */ (JSON.parse(String(form.get('rowJson') ?? '{}')));
      const created = /** @type {{ id: number }} */ (
        await reaiRequest(env, '/api/share-investments', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: {
            name: r.name.slice(0, 150),
            instrumentType: 'listed_share',
            ...(r.ticker ? { ticker: r.ticker.slice(0, 20) } : {}),
            ...(r.isin ? { isin: r.isin.slice(0, 12) } : {}),
            assetAccountNumber: '1350',
            openingQuantity: r.qty || null,
            openingCostAmount: r.cost || null,
            withinExemptionMethod: true,
          },
        })
      );
      return htmlResponse(html`<tr><td colspan="5"><strong>${r.name}</strong></td><td>${reaiBadge({ text: `Imported #${created.id}`, tone: 'success' })}</td></tr>`);
    }

    if (slug === 'assets' && pathname === `${basePath}/create`) {
      const created = /** @type {{ id: number, name: string, webUrl?: string }} */ (
        await reaiRequest(env, '/api/assets', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: {
            name: String(form.get('name') ?? '').trim().slice(0, 255),
            accountNumber: String(form.get('accountNumber') ?? '1280').trim(),
            acquisitionDate: String(form.get('acquisitionDate') ?? '').trim(),
            acquisitionCost: Number(form.get('acquisitionCost') ?? 0),
            usefulLifeInMonths: Math.max(1, Number(form.get('usefulLifeInMonths') ?? 36)),
            depreciationMethod: 'linear',
            currencyCode: 'NOK',
          },
        })
      );
      return htmlResponse(reaiCallout({ tone: 'success', title: `Registered fixed asset #${created.id}`, body: html`Saved <strong>${created.name}</strong> in ReAI Fixed Assets.` }));
    }

    if (slug === 'assets' && pathname === `${basePath}/live`) {
      const list = /** @type {any[]} */ (await reaiAll(env, '/api/assets', { token: session.accessToken, tenantId: session.tenantId }));
      return htmlResponse(
        reaiCard({
          eyebrow: 'LIVE REAI FIXED ASSETS',
          title: `${list.length} registered assets`,
          badge: reaiBadge({ text: 'Live API', tone: 'success' }),
          body: html`<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Account</th><th>Asset</th><th>Acquired</th><th class="num">Cost</th><th class="num">Months</th></tr></thead>
            <tbody>${list.slice(0, 100).map((a) => html`<tr><td class="mono">${a.accountNumber}</td><td><strong>${a.name}</strong></td><td class="mono">${a.acquisitionDate}</td><td class="num">${Number(a.acquisitionCost ?? 0).toFixed(2)} ${a.currencyCode || 'NOK'}</td><td class="num">${a.usefulLifeInMonths}</td></tr>`)}</tbody>
          </table></div>`,
        }),
      );
    }

    if (slug === 'budget' && pathname === `${basePath}/live`) {
      const year = String(form.get('year') ?? new Date().getUTCFullYear()).replace(/[^0-9]/g, '');
      const b = /** @type {{ year: number, accounts?: Array<{ accountNumber: string, amounts: number[] }> }} */ (
        await reaiRequest(env, `/api/company-budgets/${year}`, { token: session.accessToken, tenantId: session.tenantId })
      );
      const accts = b.accounts ?? [];
      return htmlResponse(
        reaiCard({
          eyebrow: `REAI BUDGET ${b.year}`,
          title: `${accts.length} budgeted NS 4102 accounts`,
          badge: reaiBadge({ text: 'Live API', tone: 'success' }),
          body: html`<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Account</th><th class="num">Q1</th><th class="num">Q2</th><th class="num">Q3</th><th class="num">Q4</th><th class="num">Full year</th></tr></thead>
            <tbody>${accts.slice(0, 100).map((a) => {
              const m = a.amounts ?? [];
              const sum = (/** @type {number} */ s, /** @type {number} */ e) => m.slice(s, e).reduce((acc, v) => acc + Number(v || 0), 0);
              return html`<tr><td class="mono">${a.accountNumber}</td><td class="num">${sum(0, 3).toFixed(0)}</td><td class="num">${sum(3, 6).toFixed(0)}</td><td class="num">${sum(6, 9).toFixed(0)}</td><td class="num">${sum(9, 12).toFixed(0)}</td><td class="num"><strong>${sum(0, 12).toFixed(0)}</strong></td></tr>`;
            })}</tbody>
          </table></div>`,
        }),
      );
    }

    if (slug === 'budget' && pathname === `${basePath}/upload`) {
      const year = String(form.get('year') ?? new Date().getUTCFullYear()).replace(/[^0-9]/g, '');
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a 12-month budget CSV.');
      const doc = parseCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer())));
      const accounts = doc.rows
        .map((r) => ({
          accountNumber: (r[0] ?? '').trim(),
          amounts: Array.from({ length: 12 }, (_, i) => Number((r[i + 1] ?? '0').replace(',', '.').replace(/[^0-9.-]/g, '')) || 0),
        }))
        .filter((a) => /^[0-9]{4}$/.test(a.accountNumber));
      if (accounts.length === 0) throw new HttpError(400, 'No 4-digit NS 4102 accounts found in first column.');
      let version = null;
      try {
        const cur = /** @type {{ version?: number | null }} */ (await reaiRequest(env, `/api/company-budgets/${year}`, { token: session.accessToken, tenantId: session.tenantId }));
        version = cur.version ?? null;
      } catch {
        version = null;
      }
      await reaiRequest(env, `/api/company-budgets/${year}`, {
        token: session.accessToken,
        tenantId: session.tenantId,
        method: 'PUT',
        body: { version, accounts },
      });
      return htmlResponse(reaiCallout({ tone: 'success', title: `Saved ${year} budget (${accounts.length} accounts)`, body: `Uploaded ${accounts.length} monthly NS 4102 budget lines straight to ReAI PUT /api/company-budgets/${year}.` }));
    }

    if (slug === 'mrr' && pathname === `${basePath}/live`) {
      const subs = /** @type {any[]} */ (await reaiAll(env, '/api/subscriptions', { token: session.accessToken, tenantId: session.tenantId }));
      const active = subs.filter((s) => s.active);
      const due = active.filter((s) => s.due);
      const mrr = active.reduce((acc, s) => acc + (Number(s.amounts?.totalExVat ?? s.amounts?.netAmount ?? 0) / Math.max(1, Number(s.intervalMonths ?? 1))), 0);
      return htmlResponse(
        reaiCard({
          eyebrow: 'LIVE REAI SUBSCRIPTIONS',
          title: `${active.length} active recurring contracts`,
          badge: reaiBadge({ text: 'Live API', tone: 'success' }),
          body: html`
            <div class="metric-grid">
              ${reaiMetric({ label: 'Active MRR', value: `${formatMinor(Math.round(mrr * 100))} NOK`, detail: 'Normalized monthly ex. VAT' })}
              ${reaiMetric({ label: 'Annualized ARR', value: `${formatMinor(Math.round(mrr * 1200))} NOK`, detail: 'MRR × 12' })}
              ${reaiMetric({ label: 'Due now', value: String(due.length), detail: 'Ready to bill' })}
            </div>
            <div class="table-wrap"><table class="data-table">
              <thead><tr><th>Customer</th><th>Interval</th><th>Next billing</th><th>Status</th></tr></thead>
              <tbody>${active.slice(0, 100).map((s) => html`<tr><td><strong>${s.customerName}</strong></td><td class="mono">${s.intervalMonths}m</td><td class="mono">${s.nextBillingDate}</td><td>${reaiBadge({ text: s.due ? 'Due' : 'Scheduled', tone: s.due ? 'warn' : 'success' })}</td></tr>`)}</tbody>
            </table></div>
          `,
        }),
      );
    }

    if (slug === 'mrr' && pathname === `${basePath}/generate-due`) {
      const res = /** @type {any} */ (await reaiRequest(env, '/api/subscriptions/generate-due', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: {} }));
      return htmlResponse(reaiCallout({ tone: 'success', title: 'Due subscription billing executed', body: `ReAI processed due subscription billing (${JSON.stringify(res).slice(0, 160)}).` }));
    }

    if (slug === 'gift-cards' && pathname === `${basePath}/issue`) {
      const amount = Number(form.get('amount') ?? 0);
      const reference = String(form.get('reference') ?? '').trim() || null;
      const gc = /** @type {{ code: string, balance: number, currencyCode: string }} */ (
        await reaiRequest(env, '/api/gift-cards', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: { amount, currencyCode: 'NOK', reference },
        })
      );
      return htmlResponse(reaiCallout({ tone: 'success', title: `Issued gift card ${gc.code}`, body: html`Code: <code>${gc.code}</code> · Balance: <strong>${gc.balance.toFixed(2)} ${gc.currencyCode}</strong>.` }));
    }

    if (slug === 'gift-cards' && pathname === `${basePath}/live`) {
      const list = /** @type {any[]} */ (await reaiAll(env, '/api/gift-cards', { token: session.accessToken, tenantId: session.tenantId }));
      const openLiability = list.filter((g) => !g.voided).reduce((s, g) => s + Number(g.balance ?? 0), 0);
      return htmlResponse(
        reaiCard({
          eyebrow: 'LIVE GIFT CARD LIABILITY (2900)',
          title: `${list.length} gift cards`,
          badge: reaiBadge({ text: 'Live API', tone: 'success' }),
          body: html`
            <div class="metric-grid">
              ${reaiMetric({ label: 'Outstanding liability', value: `${formatMinor(Math.round(openLiability * 100))} NOK`, detail: 'Matches NS 4102 account 2900' })}
              ${reaiMetric({ label: 'Active cards', value: String(list.filter((g) => !g.voided && Number(g.balance) > 0).length), detail: 'With positive balance' })}
            </div>
            <div class="table-wrap"><table class="data-table">
              <thead><tr><th>Code</th><th>Issued</th><th class="num">Initial</th><th class="num">Remaining</th><th>Status</th></tr></thead>
              <tbody>${list.slice(0, 100).map((g) => html`<tr><td class="mono">${g.code}</td><td class="mono">${String(g.issuedAt ?? '').slice(0, 10)}</td><td class="num">${Number(g.initialAmount ?? 0).toFixed(2)}</td><td class="num"><strong>${Number(g.balance ?? 0).toFixed(2)}</strong></td><td>${reaiBadge({ text: g.voided ? 'Voided' : Number(g.balance) > 0 ? 'Open' : 'Redeemed', tone: g.voided ? 'danger' : Number(g.balance) > 0 ? 'accent' : 'neutral' })}</td></tr>`)}</tbody>
            </table></div>
          `,
        }),
      );
    }

    if (slug === 'accountant-hub' && pathname === `${basePath}/live`) {
      const clients = /** @type {any[]} */ (await reaiRequest(env, '/api/accountant-clients', { token: session.accessToken, tenantId: session.tenantId }));
      const arr = Array.isArray(clients) ? clients : [];
      return htmlResponse(
        reaiCard({
          eyebrow: 'LIVE REGNSKAPSFØRER PORTFOLIO',
          title: `${arr.length} connected client companies`,
          badge: reaiBadge({ text: 'Live API', tone: 'success' }),
          body: html`<div class="table-wrap"><table class="data-table">
            <thead><tr><th>Client</th><th>Org.nr</th><th>Start date</th><th>Open</th></tr></thead>
            <tbody>${arr.slice(0, 200).map((c) => html`<tr><td><strong>${c.companyName || c.name || `Tenant #${c.clientTenantId}`}</strong></td><td class="mono">${c.organizationNumber || '—'}</td><td class="mono">${c.accountingStartDate || '—'}</td><td><a href="${reaiOrigin(env)}/?tenantId=${c.clientTenantId}" target="_blank" rel="noopener">Open ↗</a></td></tr>`)}</tbody>
          </table></div>`,
        }),
      );
    }

    if (slug === 'stock-count' && pathname === `${basePath}/live`) {
      const inv = /** @type {{ rows?: any[], totalStockValue?: number, totalRetailValue?: number }} */ (
        await reaiRequest(env, '/api/warehouses/inventory', { token: session.accessToken, tenantId: session.tenantId })
      );
      const rows = inv.rows ?? [];
      return htmlResponse(
        reaiCard({
          eyebrow: 'LIVE WAREHOUSE STOCK VALUATION',
          title: `${rows.length} stocked SKUs`,
          badge: reaiBadge({ text: 'Live API', tone: 'success' }),
          body: html`
            <div class="metric-grid">
              ${reaiMetric({ label: 'Total stock value (cost)', value: `${formatMinor(Math.round(Number(inv.totalStockValue ?? 0) * 100))} NOK`, detail: 'NS 4102 account 1460' })}
              ${reaiMetric({ label: 'Total retail value', value: `${formatMinor(Math.round(Number(inv.totalRetailValue ?? 0) * 100))} NOK`, detail: 'Ex. VAT' })}
              ${reaiMetric({ label: 'SKUs tracked', value: String(rows.length), detail: 'GET /api/warehouses/inventory' })}
            </div>
            <div class="table-wrap"><table class="data-table">
              <thead><tr><th>SKU</th><th>Product</th><th class="num">Qty on hand</th><th class="num">Unit cost</th><th class="num">Stock value</th></tr></thead>
              <tbody>${rows.slice(0, 150).map((r) => html`<tr><td class="mono">${r.sku || '—'}</td><td><strong>${r.productTitle}</strong></td><td class="num">${r.quantityOnHand}</td><td class="num">${Number(r.stockUnitCost ?? 0).toFixed(2)}</td><td class="num"><strong>${Number(r.stockValue ?? 0).toFixed(2)}</strong></td></tr>`)}</tbody>
            </table></div>
          `,
        }),
      );
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${meta.brand} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }

  return errorResponse('Unknown ReAI power-tool route.', 404);
}
