// @ts-check
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

const SUPPORTED_CURRENCIES = new Set(['NOK', 'EUR', 'USD', 'GBP']);
/** Latest stable (GA) API version in https://docs.stripe.com/changelog as of 2026-11-28. */
const STRIPE_VERSION = '2026-11-18.endive';
/** Stripe list endpoints return at most 100 objects per page; this bounds one preview at five pages per list. */
const LIST_PAGES = 5;
const OSLO_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * @typedef {{ id: string, number: string | null, status: string, currency: string, total: number, amount_due: number, amount_paid: number, amount_remaining: number, amount_overpaid?: number, starting_balance?: number, ending_balance?: number | null, pre_payment_credit_notes_amount?: number, post_payment_credit_notes_amount?: number, total_excluding_tax?: number, total_taxes?: Array<{ amount: number }>, customer_email: string | null, created: number, due_date?: number | null, status_transitions?: { paid_at?: number | null } }} StripeInvoice
 * @typedef {{ id: string, status: string, cancel_at_period_end?: boolean, currency?: string, customer?: { email?: string | null } | null, discounts?: unknown[], automatic_tax?: { enabled?: boolean }, default_tax_rates?: unknown[], items: { has_more: boolean, data: Array<{ quantity?: number, current_period_end?: number, discounts?: unknown[], tax_rates?: unknown[], price: { unit_amount?: number | null, currency: string, billing_scheme?: string, nickname?: string | null, recurring?: { interval: string, interval_count: number, usage_type?: string } } }> } }} StripeSub
 * @typedef {{ id: number, name: string, email?: string | null, invoiceEmail?: string | null, archived?: boolean }} ReAICustomer
 * @typedef {{ id: number, title: string, archived?: boolean, stockItem?: boolean, vatCode?: string | null }} ReAIProduct
 */

/**
 * Europe/Oslo bookkeeping day of a Stripe Unix timestamp.
 * @param {number} epochSeconds
 * @returns {string}
 */
function epochDay(epochSeconds) {
  return OSLO_DAY.format(epochSeconds * 1000);
}

/**
 * Unix seconds of Europe/Oslo midnight at the start of a YYYY-MM-DD day.
 * @param {string} day
 */
function osloMidnight(day) {
  const utc = Date.parse(`${day}T00:00:00Z`) / 1000;
  // Oslo is UTC+1 or UTC+2; pick the offset whose local day is still `day`.
  return epochDay(utc - 7200) === day ? utc - 7200 : utc - 3600;
}

/**
 * @param {string} path
 * @param {string} key
 * @param {Record<string, string>} [query]
 */
async function stripeGet(path, key, query = {}) {
  const url = new URL(`https://api.stripe.com/v1/${path}`);
  for (const [k, v] of Object.entries(query)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${key}`,
      accept: 'application/json',
      'stripe-version': STRIPE_VERSION,
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status === 429) {
    throw new HttpError(429, 'Stripe rate limit reached. Wait a few seconds and try again.');
  }
  if (!res.ok) {
    throw new HttpError(
      400,
      res.status === 401
        ? 'Stripe rejected this key. Paste a restricted read key (rk_live_ or rk_test_).'
        : `Stripe returned HTTP ${res.status}. Verify Read access to Account, Customers, Invoices, and Subscriptions.`,
    );
  }
  return res.json();
}

/**
 * Follows a Stripe list with starting_after for at most LIST_PAGES pages of 100.
 * @param {string} path
 * @param {string} key
 * @param {Record<string, string>} query
 * @returns {Promise<{ data: any[], truncated: boolean }>}
 */
async function stripeList(path, key, query) {
  /** @type {any[]} */
  const data = [];
  /** @type {string | undefined} */
  let after;
  for (let page = 0; page < LIST_PAGES; page++) {
    const res = /** @type {{ data?: Array<{ id: string }>, has_more?: boolean }} */ (
      await stripeGet(path, key, { ...query, limit: '100', ...(after ? { starting_after: after } : {}) })
    );
    const rows = res.data ?? [];
    data.push(...rows);
    if (!res.has_more || rows.length === 0) {
      return { data, truncated: false };
    }
    after = rows[rows.length - 1]?.id;
  }
  return { data, truncated: true };
}

/**
 * @param {ReAIProduct} p
 * @param {Set<string>} zeroCodes
 */
function isZeroProduct(p, zeroCodes) {
  return !p.archived && !p.stockItem && typeof p.vatCode === 'string' && zeroCodes.has(p.vatCode);
}

/**
 * Zero-rate customer invoice VAT codes of the company.
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {import('../../lib/types.d.ts').SessionData} session
 */
async function loadZeroCodes(env, session) {
  const vats = /** @type {Array<{ code: string, rate: number, vatType: string }>} */ (
    await reaiRequest(env, '/api/vat-codes', { token: session.accessToken, tenantId: session.tenantId, query: { usage: 'customer_invoice' } })
  );
  return new Set(
    vats.filter((v) => v.rate === 0 && (v.vatType === 'output_vat' || v.vatType === 'outside_scope' || v.vatType === 'exempt')).map((v) => v.code),
  );
}

/**
 * Loads the customer and product chosen in the preview for one import action (two lookups instead of full lists).
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {import('../../lib/types.d.ts').SessionData} session
 * @param {number} customerId
 * @param {number} productId
 */
async function loadImportTargets(env, session, customerId, productId) {
  if (customerId <= 0 || productId <= 0) {
    throw new HttpError(400, 'Review the Stripe records again and choose a zero VAT product.');
  }
  const auth = { token: session.accessToken, tenantId: session.tenantId };
  const [customer, product, zeroCodes] = await Promise.all([
    /** @type {Promise<ReAICustomer>} */ (reaiRequest(env, `/api/customers/${customerId}`, auth)),
    /** @type {Promise<ReAIProduct>} */ (reaiRequest(env, `/api/products/${productId}`, auth)),
    loadZeroCodes(env, session),
  ]);
  if (!isZeroProduct(product, zeroCodes)) {
    throw new HttpError(400, 'The chosen ReAI product must be an active non-stock product with a zero VAT code.');
  }
  return { customers: [customer], zeroProducts: [product] };
}

/**
 * @param {string | null | undefined} email
 * @param {ReAICustomer[]} customers
 * @returns {ReAICustomer | null}
 */
function matchCustomer(email, customers) {
  const needle = (email ?? '').trim().toLowerCase();
  if (!needle) {
    return null;
  }
  const matches = customers.filter(
    (c) =>
      !c.archived &&
      ((c.email ?? '').trim().toLowerCase() === needle || (c.invoiceEmail ?? '').trim().toLowerCase() === needle),
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/**
 * @param {StripeInvoice} inv
 * @param {string} currencyCode
 * @param {ReAICustomer[]} customers
 * @param {number} productId
 * @returns {string | null}
 */
function invoiceSkipReason(inv, currencyCode, customers, productId) {
  if (productId <= 0) {
    return 'Select a non-stock zero-VAT ReAI product';
  }
  if (!SUPPORTED_CURRENCIES.has(currencyCode) || inv.currency.toUpperCase() !== currencyCode) {
    return `Currency (${inv.currency.toUpperCase()}) must match ReAI (${currencyCode})`;
  }
  const paidAt = inv.status_transitions?.paid_at;
  if (
    inv.status !== 'paid' ||
    inv.total <= 0 ||
    inv.amount_due !== inv.total ||
    inv.amount_paid !== inv.total ||
    inv.amount_remaining !== 0 ||
    (inv.amount_overpaid ?? 0) !== 0 ||
    (inv.starting_balance ?? 0) !== 0 ||
    (inv.ending_balance ?? 0) !== 0 ||
    (inv.pre_payment_credit_notes_amount ?? 0) !== 0 ||
    (inv.post_payment_credit_notes_amount ?? 0) !== 0 ||
    !paidAt
  ) {
    return 'Only simple fully paid positive invoices';
  }
  const taxes = inv.total_taxes ?? [];
  if (inv.total_excluding_tax !== inv.total || !taxes.every((t) => t.amount === 0)) {
    return 'Tax could not be verified as zero';
  }
  if (!inv.number || inv.number.length > 100) {
    return 'Missing Stripe invoice number';
  }
  if (!matchCustomer(inv.customer_email, customers)) {
    return 'No unique ReAI customer match by email';
  }
  return null;
}

/**
 * @param {StripeSub} sub
 * @param {string} currencyCode
 * @param {ReAICustomer[]} customers
 * @param {number} productId
 * @returns {string | null}
 */
function subSkipReason(sub, currencyCode, customers, productId) {
  if (productId <= 0) {
    return 'Select a non-stock zero-VAT ReAI product';
  }
  if (sub.status !== 'active' || sub.cancel_at_period_end) {
    return 'Only active continuing subscriptions';
  }
  const item = sub.items.data[0];
  if (sub.items.has_more || sub.items.data.length !== 1 || !item) {
    return 'Only single-item subscriptions';
  }
  const amount = item.price.unit_amount ?? 0;
  const qty = item.quantity ?? 0;
  const rec = item.price.recurring;
  if (amount <= 0 || qty < 1 || qty > 100_000) {
    return 'Only positive fixed-price items';
  }
  if (!rec || rec.interval_count !== 1 || rec.usage_type !== 'licensed' || item.price.billing_scheme !== 'per_unit' || (rec.interval !== 'month' && rec.interval !== 'year')) {
    return 'Only fixed monthly or yearly billing';
  }
  if ((sub.discounts?.length ?? 0) > 0 || (item.discounts?.length ?? 0) > 0) {
    return 'Discounts need manual review';
  }
  if (!item.current_period_end) {
    return 'Next period date unavailable';
  }
  if (sub.automatic_tax?.enabled !== false || (sub.default_tax_rates?.length ?? 0) > 0 || (item.tax_rates?.length ?? 0) > 0) {
    return 'Tax configuration needs manual review';
  }
  if ((sub.currency ?? '').toUpperCase() !== currencyCode || item.price.currency.toUpperCase() !== currencyCode || !SUPPORTED_CURRENCIES.has(currencyCode)) {
    return 'Currency must match ReAI company';
  }
  if (!matchCustomer(sub.customer?.email, customers)) {
    return 'No unique ReAI customer match by email';
  }
  return null;
}

/**
 * @param {{ stripeAccount: string, stripeKey: string, currency: string, products: ReAIProduct[], selectedProduct: number, invoices: Array<{ inv: StripeInvoice, reason: string | null, customerName: string, customerId: number }>, subs: Array<{ sub: StripeSub, reason: string | null, customerName: string, customerId: number }>, truncated?: boolean, isSample?: boolean }} state
 */
function renderStripePreview(state) {
  const eligibleInv = state.invoices.filter((r) => r.reason === null).length;
  const eligibleSub = state.subs.filter((r) => r.reason === null).length;
  return html`
    <div class="metric-grid">
      ${reaiMetric({ label: 'Stripe account', value: state.stripeAccount, detail: state.isSample ? 'Synthetic sample' : 'Read-only scan' })}
      ${reaiMetric({ label: 'Eligible paid invoices', value: `${eligibleInv} / ${state.invoices.length}`, detail: 'Imported with accounting=none' })}
      ${reaiMetric({ label: 'Eligible subscriptions', value: `${eligibleSub} / ${state.subs.length}`, detail: 'Staged with auto-billing off' })}
    </div>
    ${state.truncated ? reaiCallout({ tone: 'info', body: 'Stripe has more records than one review shows. Set a later start date to see older invoices in another review.' }) : ''}

    ${reaiCard({
      eyebrow: 'PAID INVOICES',
      title: 'Historical Stripe invoices',
      badge: reaiBadge({ text: `${eligibleInv} eligible`, tone: eligibleInv > 0 ? 'success' : 'neutral' }),
      body: html`
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Paid date</th>
                <th>Customer</th>
                <th class="num">Total</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${state.invoices.map(
                ({ inv, reason, customerName, customerId }, idx) => html`<tr id="stripe-inv-${idx}">
                  <td class="mono">${inv.number ?? inv.id}</td>
                  <td class="mono">${inv.status_transitions?.paid_at ? epochDay(inv.status_transitions.paid_at) : '—'}</td>
                  <td>${customerName || inv.customer_email || '—'}</td>
                  <td class="num">${formatMinor(inv.total)} ${inv.currency.toUpperCase()}</td>
                  <td>${reason ? reaiBadge({ text: reason, tone: 'warn' }) : reaiBadge({ text: 'Eligible', tone: 'success' })}</td>
                  <td>
                    ${reason || state.isSample
                      ? html`<span class="muted-note">${state.isSample && !reason ? 'Demo only' : '—'}</span>`
                      : html`<form hx-post="/app/stripe/import-invoice" hx-target="#stripe-inv-${idx}" hx-swap="outerHTML">
                          <input type="hidden" name="stripeKey" value="${state.stripeKey}">
                          <input type="hidden" name="productId" value="${state.selectedProduct}">
                          <input type="hidden" name="invoiceId" value="${inv.id}">
                          <input type="hidden" name="customerId" value="${customerId}">
                          <button type="submit" class="button primary">Import</button>
                        </form>`}
                  </td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>
      `,
    })}

    ${reaiCard({
      eyebrow: 'SUBSCRIPTIONS',
      title: 'Stage active Stripe subscriptions',
      badge: reaiBadge({ text: `${eligibleSub} eligible`, tone: eligibleSub > 0 ? 'success' : 'neutral' }),
      body: html`
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Subscription</th>
                <th>Next period</th>
                <th>Customer</th>
                <th class="num">Price</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${state.subs.map(({ sub, reason, customerName, customerId }, idx) => {
                const item = sub.items.data[0];
                const amount = item?.price.unit_amount ?? 0;
                const interval = item?.price.recurring?.interval ?? '';
                const nextDate = item?.current_period_end ? epochDay(item.current_period_end) : '—';
                return html`<tr id="stripe-sub-${idx}">
                  <td class="mono">${sub.id}</td>
                  <td class="mono">${nextDate}</td>
                  <td>${customerName || sub.customer?.email || '—'}</td>
                  <td class="num">${formatMinor(amount)} ${(sub.currency ?? '').toUpperCase()}/${interval}</td>
                  <td>${reason ? reaiBadge({ text: reason, tone: 'warn' }) : reaiBadge({ text: 'Eligible', tone: 'success' })}</td>
                  <td>
                    ${reason || state.isSample
                      ? html`<span class="muted-note">${state.isSample && !reason ? 'Demo only' : '—'}</span>`
                      : html`<form hx-post="/app/stripe/stage-subscription" hx-target="#stripe-sub-${idx}" hx-swap="outerHTML">
                          <input type="hidden" name="stripeKey" value="${state.stripeKey}">
                          <input type="hidden" name="productId" value="${state.selectedProduct}">
                          <input type="hidden" name="subscriptionId" value="${sub.id}">
                          <input type="hidden" name="customerId" value="${customerId}">
                          <button type="submit" class="button secondary">Stage</button>
                        </form>`}
                  </td>
                </tr>`;
              })}
            </tbody>
          </table>
        </div>
      `,
    })}
  `;
}

/**
 * Loads zero-VAT non-stock ReAI products for the selected company.
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {import('../../lib/types.d.ts').SessionData} session
 */
async function loadReaiStripeContext(env, session) {
  const [customers, products, zeroCodes] = await Promise.all([
    reaiAll(env, '/api/customers', { token: session.accessToken, tenantId: session.tenantId, query: { archived: 'false' } }),
    reaiAll(env, '/api/products', { token: session.accessToken, tenantId: session.tenantId, query: { archived: 'false' } }),
    loadZeroCodes(env, session),
  ]);
  const zeroProducts = /** @type {ReAIProduct[]} */ (products).filter((p) => isZeroProduct(p, zeroCodes));
  return {
    customers: /** @type {ReAICustomer[]} */ (customers),
    zeroProducts,
  };
}

/**
 * Handles /app/stripe/* SSR & HTMX routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handleStripe(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === '/app/stripe' && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL('/app/stripe/', request.url), 301);
  }

  if (pathname === '/app/stripe/' && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    /** @type {ReAIProduct[]} */
    let zeroProducts = [];
    if (session && session.tenantId > 0) {
      try {
        zeroProducts = (await loadReaiStripeContext(env, session)).zeroProducts;
      } catch {
        zeroProducts = [];
      }
    }
    const body = html`
      <section class="app-intro">
        <p class="eyebrow">PAYMENTS & SALES MIGRATION</p>
        <h1>Stripe Import</h1>
        <p class="lead">Review eligible fully paid tax-free Stripe invoices and stage simple subscriptions into ReAI with automatic billing kept off.</p>
      </section>

      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-stripe-web', clientName: 'ReAI Stripe Import (Web)' })}

        ${reaiCard({
          eyebrow: 'STRIPE READ-ONLY SCAN',
          title: 'Load Stripe invoices & subscriptions',
          body: html`
            <p class="muted-note">Use a Stripe restricted key (<code>rk_live_…</code> or <code>rk_test_…</code>) with Read access to Account, Customers, Invoices and Subscriptions. Keys are never stored on disk or in cookies.</p>
            <form class="stack" hx-post="/app/stripe/preview" hx-target="#stripe-output" hx-swap="innerHTML">
              <div class="inline-row">
                <div class="field">
                  <label for="stripe-key">Stripe restricted read key</label>
                  <input id="stripe-key" name="stripeKey" type="password" autocomplete="off" required placeholder="rk_live_… or rk_test_…">
                </div>
                <div class="field">
                  <label for="stripe-from">Paid invoices created from (optional)</label>
                  <input id="stripe-from" name="from" type="date">
                </div>
                <div class="field">
                  <label for="stripe-product">Zero-VAT non-stock ReAI product</label>
                  <select id="stripe-product" name="productId">
                    <option value="0">${zeroProducts.length > 0 ? 'Choose product…' : 'Connect to ReAI to load products'}</option>
                    ${zeroProducts.map((p) => html`<option value="${p.id}">${p.title} (VAT ${p.vatCode})</option>`)}
                  </select>
                </div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Review Stripe records</button>
                <button type="button" class="button secondary" hx-post="/app/stripe/sample" hx-target="#stripe-output" hx-swap="innerHTML">Load synthetic sample</button>
              </div>
            </form>
          `,
        })}

        <div id="stripe-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(
      appShell({
        title: 'Stripe Import',
        description: 'Review paid Stripe invoices and stage subscriptions into ReAI.',
        activePath: '/app/stripe/',
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

  if (pathname === '/app/stripe/sample') {
    /** @type {ReAICustomer[]} */
    const customers = [{ id: 1, name: 'Fjord Studio AS', email: 'billing@fjordstudio.no' }];
    /** @type {StripeInvoice[]} */
    const invs = [
      {
        id: 'in_sample_001',
        number: 'STR-2026-0041',
        status: 'paid',
        currency: 'nok',
        total: 490000,
        amount_due: 490000,
        amount_paid: 490000,
        amount_remaining: 0,
        total_excluding_tax: 490000,
        total_taxes: [{ amount: 0 }],
        customer_email: 'billing@fjordstudio.no',
        created: 1790899200,
        status_transitions: { paid_at: 1790899200 },
      },
      {
        id: 'in_sample_002',
        number: 'STR-2026-0042',
        status: 'paid',
        currency: 'nok',
        total: 125000,
        amount_due: 125000,
        amount_paid: 125000,
        amount_remaining: 0,
        total_excluding_tax: 100000,
        total_taxes: [{ amount: 25000 }],
        customer_email: 'billing@fjordstudio.no',
        created: 1791504000,
        status_transitions: { paid_at: 1791504000 },
      },
    ];
    /** @type {StripeSub[]} */
    const subs = [
      {
        id: 'sub_sample_001',
        status: 'active',
        cancel_at_period_end: false,
        currency: 'nok',
        customer: { email: 'billing@fjordstudio.no' },
        discounts: [],
        automatic_tax: { enabled: false },
        default_tax_rates: [],
        items: {
          has_more: false,
          data: [
            {
              quantity: 1,
              current_period_end: 1793491200,
              discounts: [],
              tax_rates: [],
              price: {
                unit_amount: 490000,
                currency: 'nok',
                billing_scheme: 'per_unit',
                nickname: 'Pro monthly plan',
                recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
              },
            },
          ],
        },
      },
    ];
    return htmlResponse(
      renderStripePreview({
        stripeAccount: 'acct_sample_demo',
        stripeKey: '',
        currency: 'NOK',
        products: [{ id: 10, title: 'SaaS Subscription (0% VAT)', vatCode: '6' }],
        selectedProduct: 10,
        invoices: invs.map((inv) => ({
          inv,
          reason: invoiceSkipReason(inv, 'NOK', customers, 10),
          customerName: matchCustomer(inv.customer_email, customers)?.name ?? '',
          customerId: matchCustomer(inv.customer_email, customers)?.id ?? 0,
        })),
        subs: subs.map((sub) => ({
          sub,
          reason: subSkipReason(sub, 'NOK', customers, 10),
          customerName: matchCustomer(sub.customer?.email, customers)?.name ?? '',
          customerId: matchCustomer(sub.customer?.email, customers)?.id ?? 0,
        })),
        isSample: true,
      }),
    );
  }

  try {
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) {
      throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    }
    const company = session.tenants.find((t) => t.id === session.tenantId);
    if (!company) {
      throw new HttpError(400, 'Select a valid ReAI company.');
    }
    const form = await request.formData();
    const stripeKey = String(form.get('stripeKey') ?? '').trim();
    const productId = Number(form.get('productId') ?? '0');
    const customerId = Number(form.get('customerId') ?? '0');
    if (!stripeKey.startsWith('rk_live_') && !stripeKey.startsWith('rk_test_')) {
      throw new HttpError(400, 'Use a restricted Stripe key beginning with rk_live_ or rk_test_.');
    }

    if (pathname === '/app/stripe/preview') {
      const from = String(form.get('from') ?? '').trim();
      if (from && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(from)) {
        throw new HttpError(400, 'Enter the start date as YYYY-MM-DD.');
      }
      const [account, invPage, subPage, reaiCtx] = await Promise.all([
        stripeGet('account', stripeKey),
        stripeList('invoices', stripeKey, { status: 'paid', ...(from ? { 'created[gte]': String(osloMidnight(from)) } : {}) }),
        stripeList('subscriptions', stripeKey, { status: 'active', 'expand[]': 'data.customer' }),
        loadReaiStripeContext(env, session),
      ]);
      const chosenProduct =
        reaiCtx.zeroProducts.some((p) => p.id === productId)
          ? productId
          : (reaiCtx.zeroProducts[0]?.id ?? 0);
      const invoices = /** @type {StripeInvoice[]} */ (invPage.data);
      const subs = /** @type {StripeSub[]} */ (subPage.data);
      return htmlResponse(
        renderStripePreview({
          stripeAccount: String(account.id),
          stripeKey,
          currency: company.currencyCode.toUpperCase(),
          products: reaiCtx.zeroProducts,
          selectedProduct: chosenProduct,
          invoices: invoices.map((inv) => ({
            inv,
            reason: invoiceSkipReason(inv, company.currencyCode.toUpperCase(), reaiCtx.customers, chosenProduct),
            customerName: matchCustomer(inv.customer_email, reaiCtx.customers)?.name ?? '',
            customerId: matchCustomer(inv.customer_email, reaiCtx.customers)?.id ?? 0,
          })),
          subs: subs.map((sub) => ({
            sub,
            reason: subSkipReason(sub, company.currencyCode.toUpperCase(), reaiCtx.customers, chosenProduct),
            customerName: matchCustomer(sub.customer?.email, reaiCtx.customers)?.name ?? '',
            customerId: matchCustomer(sub.customer?.email, reaiCtx.customers)?.id ?? 0,
          })),
          truncated: invPage.truncated || subPage.truncated,
        }),
      );
    }

    if (pathname === '/app/stripe/import-invoice') {
      const invoiceId = String(form.get('invoiceId') ?? '').trim();
      const [account, inv, reaiCtx] = await Promise.all([
        stripeGet('account', stripeKey),
        stripeGet(`invoices/${encodeURIComponent(invoiceId)}`, stripeKey),
        loadImportTargets(env, session, customerId, productId),
      ]);
      const invoice = /** @type {StripeInvoice} */ (inv);
      const reason = invoiceSkipReason(invoice, company.currencyCode.toUpperCase(), reaiCtx.customers, productId);
      const customer = matchCustomer(invoice.customer_email, reaiCtx.customers);
      if (reason || !customer || !invoice.number || !invoice.status_transitions?.paid_at) {
        throw new HttpError(400, reason ?? 'Invoice is not eligible.');
      }
      const amount = Number((invoice.total / 100).toFixed(2));
      const paidAt = invoice.status_transitions.paid_at;
      const imported = /** @type {{ id: number }} */ (
        await reaiRequest(env, '/api/invoices/import', {
          token: session.accessToken,
          tenantId: company.id,
          method: 'POST',
          body: {
            source: 'stripe',
            sourceInstance: String(account.id),
            externalId: invoice.id,
            number: invoice.number,
            issueDate: epochDay(invoice.created),
            dueDate: epochDay(invoice.due_date ?? paidAt),
            accounting: 'none',
            automaticRemindersEnabled: false,
            customerId: customer.id,
            comment: `Historical Stripe invoice ${invoice.id}. Revenue and VAT were not posted by this import.`,
            orderItems: [{ productId, quantity: 1, price: amount, currencyCode: company.currencyCode }],
            payments: [{ date: epochDay(paidAt), paidAmount: amount, receivedAmount: amount }],
          },
        })
      );
      const url = `${reaiOrigin(env)}/invoice/${imported.id}?tenantId=${company.id}`;
      return htmlResponse(html`<tr>
        <td class="mono">${invoice.number}</td>
        <td class="mono">${epochDay(paidAt)}</td>
        <td>${customer.name}</td>
        <td class="num">${formatMinor(invoice.total)} ${company.currencyCode}</td>
        <td>${reaiBadge({ text: `Imported #${imported.id}`, tone: 'success' })}</td>
        <td><a href="${url}" target="_blank" rel="noopener">Open in ReAI ↗</a></td>
      </tr>`);
    }

    if (pathname === '/app/stripe/stage-subscription') {
      const subId = String(form.get('subscriptionId') ?? '').trim();
      const [account, subRaw, reaiCtx] = await Promise.all([
        stripeGet('account', stripeKey),
        stripeGet(`subscriptions/${encodeURIComponent(subId)}`, stripeKey, { 'expand[]': 'customer' }),
        loadImportTargets(env, session, customerId, productId),
      ]);
      const sub = /** @type {StripeSub} */ (subRaw);
      const reason = subSkipReason(sub, company.currencyCode.toUpperCase(), reaiCtx.customers, productId);
      const customer = matchCustomer(sub.customer?.email, reaiCtx.customers);
      const product = reaiCtx.zeroProducts.find((p) => p.id === productId);
      const item = sub.items.data[0];
      if (reason || !customer || !product?.vatCode || !item?.price.unit_amount || !item.quantity || !item.current_period_end || !item.price.recurring) {
        throw new HttpError(400, reason ?? 'Subscription is not eligible.');
      }
      const marker = `Stripe subscription ${account.id}/${sub.id}`;
      const intervalMonths = item.price.recurring.interval === 'year' ? 12 : 1;
      const startDate = epochDay(item.current_period_end);
      const existing = /** @type {Array<{ id?: number, startDate?: string, intervalMonths?: number }>} */ (
        await reaiAll(env, '/api/subscriptions', {
          token: session.accessToken,
          tenantId: company.id,
          query: { customerId: String(customer.id) },
        })
      );
      // The list has no internalComment, so only same-start, same-interval rows are opened to look for the marker.
      for (const row of existing) {
        if (!row.id || row.startDate !== startDate || row.intervalMonths !== intervalMonths) {
          continue;
        }
        const detail = /** @type {{ internalComment?: string | null }} */ (
          await reaiRequest(env, `/api/subscriptions/${row.id}`, { token: session.accessToken, tenantId: company.id })
        );
        if (detail.internalComment?.includes(marker)) {
          throw new HttpError(409, `Already staged in ReAI (#${row.id}).`);
        }
      }
      const created = /** @type {{ id?: number }} */ (
        await reaiRequest(env, '/api/subscriptions', {
          token: session.accessToken,
          tenantId: company.id,
          method: 'POST',
          body: {
            customerId: customer.id,
            startDate,
            intervalMonths,
            billingTiming: 'in_advance',
            periodAlignment: 'start_date',
            outputMode: 'create_order',
            automaticBillingGeneration: false,
            currencyCode: company.currencyCode,
            billingLeadDays: 0,
            daysUntilDue: 0,
            sendEhf: false,
            internalComment: `${marker}. Staged from Stripe; verify terms, VAT and collection before activating ReAI billing.`,
            subscriptionLines: [
              {
                rowNumber: 1,
                itemName: item.price.nickname ?? 'Stripe subscription',
                quantity: item.quantity,
                unitPrice: Number((item.price.unit_amount / 100).toFixed(2)),
                vatCode: product.vatCode,
              },
            ],
          },
        })
      );
      return htmlResponse(html`<tr>
        <td class="mono">${sub.id}</td>
        <td class="mono">${epochDay(item.current_period_end)}</td>
        <td>${customer.name}</td>
        <td class="num">${formatMinor(item.price.unit_amount)} ${company.currencyCode}/${item.price.recurring.interval}</td>
        <td>${reaiBadge({ text: `Staged #${created.id ?? 'ok'}`, tone: 'success' })}</td>
        <td><span class="muted-note">Auto-billing off</span></td>
      </tr>`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Stripe request failed.';
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Stripe operation failed', body: msg }));
  }

  return errorResponse('Unknown Stripe route.', 404);
}
