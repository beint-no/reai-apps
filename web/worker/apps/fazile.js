// @ts-check
import { fetchJson, isoDate, num, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * @typedef {{ description: string, annualAmount: number, vatPercent: number, frequency: string }} LeaseLine
 * @typedef {{ contractId: number, contractKey: string, tenantId: number, tenantName: string, orgnr: string, emails: string[], startDate: string, lines: LeaseLine[], skipped: number }} Lease
 * @typedef {{ itemName: string, unitPrice: number, vatPercent: number, vatCode: string }} StagedLine
 * @typedef {{ lease: Lease, customerId: number | null, intervalMonths: number, lines: StagedLine[] }} StagedLease
 * @typedef {{ id: number, name?: string | null, email?: string | null, invoiceEmail?: string | null, organizationNumber?: string | null }} ReAICustomer
 * @typedef {{ code: string, rate: number, description: string, vatType: string, reverseCharge: boolean }} VatCode
 */

const SLUG = 'fazile';
const BRAND = 'Fazile';
const BASE_PATH = '/app/fazile';
const TITLE = 'Fazile Lease Billing';
const LEAD = 'Read active lease contracts from the Fazile API and stage them as ReAI subscriptions, with automatic billing off until you have reviewed them.';
const API = 'https://api.fazile.no/clients/v1';
const PAGE_SIZE = 100;
/** Contract line types that carry recurring rent or cost amounts. Discounts, exemptions and accruals are left to manual review. */
const BILLABLE_TYPES = new Set(['RENT', 'COMMON_COSTS', 'MARKETING', 'PARKING', 'CUSTOM']);
/** Fazile invoice frequencies (as in its invoice_frequency enum) to ReAI interval months. */
/** @type {Record<string, number>} */
const FREQUENCY_MONTHS = { MONTHLY: 1, EVERY_TWO_MONTHS: 2, QUARTERLY: 3, EVERY_FOUR_MONTHS: 4, BI_YEARLY: 6, YEARLY: 12 };

/** @type {import('../lib/api-http.js').ApiFieldSpec[]} */
const API_FIELDS = [{ name: 'apiKey', label: 'Fazile API key', type: 'password', placeholder: 'API-nøkkel fra Firmaprofil' }];

/** @type {Lease[]} */
const SAMPLE = [
  {
    contractId: 190, contractKey: 'AB134F', tenantId: 11, tenantName: 'Nordic Studio AS', orgnr: '923609016', emails: ['faktura@nordicstudio.no'], startDate: '2027-01-01', skipped: 1,
    lines: [
      { description: 'Kontor 3. etasje', annualAmount: 294000, vatPercent: 25, frequency: 'QUARTERLY' },
      { description: 'Felleskostnader', annualAmount: 48000, vatPercent: 25, frequency: 'QUARTERLY' },
    ],
  },
  {
    contractId: 191, contractKey: 'AB135G', tenantId: 12, tenantName: 'Fjord Konsult AS', orgnr: '', emails: [], startDate: '2026-12-01', skipped: 0,
    lines: [{ description: 'Lager plan 1', annualAmount: 120000, vatPercent: 0, frequency: 'MONTHLY' }],
  },
];

/**
 * Reads every page of a Fazile list endpoint (PaginationParams skip/limit).
 * @param {string} path
 * @param {Record<string, string>} headers
 * @param {import('../lib/api-http.js').FetchLike} fetchImpl
 * @returns {Promise<any[]>}
 */
async function fetchAll(path, headers, fetchImpl) {
  /** @type {any[]} */ const all = [];
  for (let page = 0; page < 50; page++) {
    const query = new URLSearchParams({ skip: String(page * PAGE_SIZE), limit: String(PAGE_SIZE) });
    const batch = await fetchJson(`${API}${path}?${query}`, { headers }, BRAND, fetchImpl);
    if (!Array.isArray(batch)) throw new HttpError(502, `${BRAND} returned an unexpected response for ${path}.`);
    all.push(...batch);
    if (batch.length < PAGE_SIZE) return all;
  }
  throw new HttpError(502, `${BRAND} pagination exceeded the safety limit.`);
}

/**
 * Fetches active Fazile contracts with their contract lines and tenants.
 * Docs: https://fazile.net/integrasjon-og-api/ (customer API),
 * https://api.fazile.no/clients/swagger-ui/index.html (OpenAPI: GET /v1/contracts and GET /v1/tenants with
 * skip/limit pagination, `token` header), https://hjelp.fazile.net/docs/oppretting-av-api-nokkel-for-tredjepartsapplikasjoner/
 * (key from Firmaprofil → API Nøkler, read access) and
 * https://hjelp.fazile.net/docs/endring-av-arsleie-og-justering-av-basispriser/ (contract prices are annual amounts).
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<Lease[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const apiKey = (creds.apiKey ?? '').trim();
  if (!apiKey) throw new HttpError(400, 'Enter your Fazile API key.');
  const headers = { token: apiKey, accept: 'application/json' };
  const [contracts, tenants] = await Promise.all([fetchAll('/contracts', headers, fetchImpl), fetchAll('/tenants', headers, fetchImpl)]);
  const tenantsById = new Map(tenants.map((t) => [Number(t.tenant_id), t]));
  const today = new Date().toISOString().slice(0, 10);
  return contracts
    .filter((c) => String(c.contract_status ?? '').toUpperCase() === 'ACTIVE')
    .map((c) => {
      const tenant = tenantsById.get(Number(c.main_tenant_id));
      /** @type {any[]} */ const rawLines = Array.isArray(c.contract_lines) ? c.contract_lines : [];
      const current = rawLines.filter((l) => !l.end_date || isoDate(l.end_date) >= today);
      const billable = current.filter((l) => BILLABLE_TYPES.has(String(l.type ?? '')) && num(l.total_price) !== 0);
      const nextDates = billable.map((l) => isoDate(l.next_invoice_date, '')).filter(Boolean).sort();
      return {
        contractId: Number(c.contract_id),
        contractKey: String(c.contract_key ?? c.contract_id),
        tenantId: Number(c.main_tenant_id),
        tenantName: String(c.main_tenant_name ?? tenant?.full_name ?? '').trim(),
        orgnr: String(tenant?.organization_number ?? '').replace(/\s+/g, ''),
        emails: Array.isArray(tenant?.emails) ? tenant.emails.map((/** @type {unknown} */ e) => String(e).trim().toLowerCase()).filter(Boolean) : [],
        startDate: nextDates[0] ?? today,
        skipped: current.length - billable.length,
        lines: billable.map((l) => ({
          description: String(l.description || l.area_group_name || l.rent_type_name || 'Leie').trim().slice(0, 200),
          annualAmount: num(l.total_price),
          vatPercent: num(l.tax_vat_percent),
          frequency: String(l.frequency ?? '').trim().toUpperCase(),
        })),
      };
    })
    .filter((l) => l.tenantName && l.lines.length > 0);
}

/**
 * Picks the ReAI invoice VAT code for a Fazile line rate.
 * @param {VatCode[]} codes
 * @param {number} ratePct
 * @param {string} zeroCode
 */
function invoiceVatCode(codes, ratePct, zeroCode) {
  if (ratePct <= 0) return zeroCode;
  const match = codes.find((c) => c.vatType === 'output_vat' && !c.reverseCharge && Math.abs(c.rate - ratePct) < 0.001);
  if (!match) throw new HttpError(400, `ReAI has no output VAT code for ${ratePct}% in this company.`);
  return match.code;
}

/**
 * Groups lease lines by invoice interval and converts annual amounts to the amount per invoice.
 * @param {Lease} lease
 * @param {number} defaultMonths
 * @param {VatCode[]} codes
 * @param {string} zeroCode
 * @returns {Array<{ intervalMonths: number, lines: StagedLine[] }>}
 */
function groupByInterval(lease, defaultMonths, codes, zeroCode) {
  /** @type {Map<number, StagedLine[]>} */ const groups = new Map();
  for (const l of lease.lines) {
    const months = FREQUENCY_MONTHS[l.frequency] ?? defaultMonths;
    const list = groups.get(months) ?? [];
    list.push({
      itemName: l.description,
      unitPrice: Number(((l.annualAmount * months) / 12).toFixed(2)),
      vatPercent: l.vatPercent,
      vatCode: codes.length ? invoiceVatCode(codes, l.vatPercent, zeroCode) : '',
    });
    groups.set(months, list);
  }
  return [...groups.entries()].map(([intervalMonths, lines]) => ({ intervalMonths, lines }));
}

/**
 * @param {Lease} lease
 * @param {ReAICustomer[]} customers
 */
function matchCustomer(lease, customers) {
  const name = lease.tenantName.toLowerCase();
  const byOrg = lease.orgnr ? customers.find((c) => (c.organizationNumber ?? '').replace(/\s+/g, '') === lease.orgnr) : undefined;
  const byEmail = customers.find((c) => lease.emails.includes((c.invoiceEmail ?? '').toLowerCase()) || lease.emails.includes((c.email ?? '').toLowerCase()));
  const byName = customers.find((c) => (c.name ?? '').trim().toLowerCase() === name);
  return (byOrg ?? byEmail ?? byName)?.id ?? null;
}

/** @param {{ staged: StagedLease[], skipped: number, isSample: boolean }} state */
function renderPreview(state) {
  const matched = state.staged.filter((s) => s.customerId !== null).length;
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI SUBSCRIPTIONS`,
    title: `${state.staged.length} subscriptions from active Fazile contracts`,
    badge: state.isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${matched} matched`, tone: matched > 0 ? 'success' : 'warn' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Subscriptions', value: String(state.staged.length), detail: 'One per contract and invoice interval' })}
        ${reaiMetric({ label: 'Matched tenants', value: `${matched} / ${state.staged.length}`, detail: 'By org.nr, email or exact name' })}
        ${reaiMetric({ label: 'Lines left out', value: String(state.skipped), detail: 'Discounts, exemptions and accruals' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Contract</th><th>Tenant</th><th>Lines (per invoice)</th><th>Every</th><th>Start</th><th>Action</th></tr></thead>
        <tbody>${state.staged.map((s, idx) => html`<tr id="${SLUG}-row-${idx}">
          <td class="mono">${s.lease.contractKey}</td>
          <td><strong>${s.lease.tenantName}</strong>${s.lease.orgnr ? html`<div class="muted-note mono">${s.lease.orgnr}</div>` : ''}</td>
          <td>${s.lines.map((l) => html`<div>${l.itemName}: ${formatMinor(Math.round(l.unitPrice * 100))} NOK ex. VAT · ${l.vatPercent}%${l.vatCode ? ` (code ${l.vatCode})` : ''}</div>`)}</td>
          <td>${s.intervalMonths} mo</td>
          <td class="mono">${s.lease.startDate}</td>
          <td>${state.isSample || s.customerId === null || s.lines.some((l) => !l.vatCode)
            ? html`<span class="muted-note">${state.isSample ? 'Demo only' : s.customerId === null ? 'No matching ReAI customer' : 'Connect to ReAI first'}</span>`
            : html`<form hx-post="${BASE_PATH}/stage" hx-target="#${SLUG}-row-${idx}" hx-swap="outerHTML">
                <input type="hidden" name="stagedJson" value="${JSON.stringify({ contractKey: s.lease.contractKey, tenantName: s.lease.tenantName, startDate: s.lease.startDate, customerId: s.customerId, intervalMonths: s.intervalMonths, lines: s.lines })}">
                <button type="submit" class="button primary">Stage subscription</button>
              </form>`}</td>
        </tr>`)}</tbody>
      </table></div>
      <p class="muted-note">Fazile prices are annual. Each line is divided by the invoice frequency on the contract line. Fazile normally sends invoice basis to your ERP itself, so stage a contract here only when ReAI invoices it instead.</p>
    `,
  });
}

/** @param {VatCode[]} codes */
function renderOptions(codes) {
  const zero = codes.filter((c) => c.rate === 0 && c.vatType !== 'input_vat' && !c.reverseCharge);
  return html`<div class="mapping-grid">
    <div class="field"><label for="${SLUG}-interval">Interval when the line has no frequency</label><select id="${SLUG}-interval" name="defaultInterval"><option value="3">Quarterly</option><option value="1">Monthly</option><option value="6">Every six months</option><option value="12">Yearly</option></select></div>
    <div class="field"><label for="${SLUG}-zero">ReAI VAT code for lines without VAT</label><select id="${SLUG}-zero" name="zeroVatCode">${zero.length
      ? zero.map((c) => html`<option value="${c.code}">${c.code}: ${c.description}</option>`)
      : html`<option value="">Connect to ReAI to load VAT codes</option>`}</select></div>
  </div>`;
}

/**
 * @param {import('../lib/types.d.ts').Env} env
 * @param {{ accessToken: string, tenantId: number } | null} session
 * @returns {Promise<VatCode[]>}
 */
async function loadVatCodes(env, session) {
  if (!session || session.tenantId <= 0) return [];
  return /** @type {VatCode[]} */ (await reaiRequest(env, '/api/vat-codes', { token: session.accessToken, tenantId: session.tenantId, query: { usage: 'customer_invoice' } }));
}

/**
 * Handles /app/fazile/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE_PATH && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE_PATH}/`, request.url), 301);
  if (pathname === `${BASE_PATH}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    /** @type {VatCode[]} */ let codes = [];
    try { codes = await loadVatCodes(env, session); } catch { codes = []; }
    const body = html`
      <section class="app-intro"><p class="eyebrow">REAL ESTATE & LEASES</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${SLUG}-web`, clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({
          basePath: BASE_PATH, targetId: `${SLUG}-output`, brand: BRAND, fields: API_FIELDS, sampleAction: true,
          hint: 'Create a read only key in Fazile under Firmaprofil → API Nøkler → Opprett API-nøkkel, with access to the contracts and tenants you want to bill.',
          extraFields: renderOptions(codes),
        })}
        <div id="${SLUG}-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${BASE_PATH}/sample`) {
    const staged = SAMPLE.flatMap((lease, i) => groupByInterval(lease, 3, [], '').map((g) => ({ lease, customerId: i === 0 ? 12 : null, ...g })));
    return htmlResponse(renderPreview({ staged, skipped: SAMPLE.reduce((t, l) => t + l.skipped, 0), isSample: true }));
  }

  try {
    const form = await request.formData();
    const session = await readSession(env, request);
    if (pathname === `${BASE_PATH}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      const leases = await fetchApi(creds);
      const codes = await loadVatCodes(env, session);
      /** @type {ReAICustomer[]} */
      const customers = session && session.tenantId > 0 ? /** @type {ReAICustomer[]} */ (await reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId, query: { archived: 'false' } })) : [];
      const defaultMonths = [1, 3, 6, 12].includes(Number(creds.defaultInterval)) ? Number(creds.defaultInterval) : 3;
      const zeroCode = String(creds.zeroVatCode ?? '').trim();
      if (codes.length && leases.some((l) => l.lines.some((x) => x.vatPercent <= 0)) && !codes.some((c) => c.code === zeroCode && c.rate === 0)) {
        throw new HttpError(400, 'Choose the ReAI VAT code for lines without VAT.');
      }
      const staged = leases.flatMap((lease) => groupByInterval(lease, defaultMonths, codes, zeroCode).map((g) => ({ lease, customerId: matchCustomer(lease, customers), ...g })));
      return htmlResponse(renderPreview({ staged, skipped: leases.reduce((t, l) => t + l.skipped, 0), isSample: false }));
    }
    if (pathname === `${BASE_PATH}/stage`) {
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const s = /** @type {{ contractKey: string, tenantName: string, startDate: string, customerId: number, intervalMonths: number, lines: StagedLine[] }} */ (JSON.parse(String(form.get('stagedJson') ?? '{}')));
      const customerId = Number(s.customerId);
      const intervalMonths = Number(s.intervalMonths);
      if (!(customerId > 0) || !Object.values(FREQUENCY_MONTHS).includes(intervalMonths) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(s.startDate)) || !Array.isArray(s.lines) || s.lines.length === 0) {
        throw new HttpError(400, 'The staged contract is incomplete.');
      }
      const codes = await loadVatCodes(env, session);
      const created = /** @type {{ id?: number, webUrl?: string }} */ (
        await reaiRequest(env, '/api/subscriptions', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: {
            customerId, startDate: s.startDate, intervalMonths, billingTiming: 'in_advance', periodAlignment: 'start_date',
            outputMode: 'create_order', automaticBillingGeneration: false, currencyCode: 'NOK', billingLeadDays: 0, daysUntilDue: 14, sendEhf: false,
            internalComment: `Fazile contract ${String(s.contractKey).slice(0, 40)} (${String(s.tenantName).slice(0, 80)}). Staged from apps.reai.no with automatic billing off.`,
            subscriptionLines: s.lines.map((l, i) => {
              const code = String(l.vatCode);
              if (!codes.some((c) => c.code === code)) throw new HttpError(400, `VAT code ${code} is not available for invoices in this ReAI company.`);
              return { rowNumber: i + 1, itemName: String(l.itemName).slice(0, 200), quantity: 1, unitPrice: Number(Number(l.unitPrice).toFixed(2)), vatCode: code };
            }),
          },
        })
      );
      return htmlResponse(html`<tr><td class="mono">${s.contractKey}</td><td>${s.tenantName}</td><td>${s.lines.length} lines</td><td>${intervalMonths} mo</td><td class="mono">${s.startDate}</td><td>${created.webUrl ? html`<a href="${created.webUrl}" target="_blank" rel="noopener">Subscription #${created.id ?? ''} ↗</a>` : reaiBadge({ text: `Staged #${created.id ?? 'ok'}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Operation failed.' }));
  }
  return errorResponse('Unknown Fazile route.', 404);
}
