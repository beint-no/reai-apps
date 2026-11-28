// @ts-check
import { fetchJson } from '../../lib/api-http.js';
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { extractNorwegianOrg } from '../../lib/norway.js';
import { reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { formatMinor } from '../../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../../lib/ui.js';

/**
 * @typedef {{ itemName: string, quantity: number, unitPrice: number, discount: number, vatPercent: number, netMinor: number }} BookingLine
 * @typedef {{ name: string, number: string, orgnr: string, email: string, phone: string, address: string, address2: string, zip: string, city: string, countryCode: string }} BookingCustomer
 * @typedef {{ id: number, date: string, customer: BookingCustomer, lines: BookingLine[], netMinor: number, vatMinor: number, grossMinor: number, paymentMethod: string, reference: string, problem: string }} Booking
 * @typedef {{ code: string, rate: number, vatType: string, description?: string, reverseCharge: boolean }} VatCode
 */

const SLUG = 'eduadmin';
const BRAND = 'EduAdmin';
const BASE_PATH = `/app/${SLUG}`;
const TITLE = 'EduAdmin Bookings to ReAI Orders';
const LEAD = 'Fetch confirmed EduAdmin course bookings that are not invoiced yet and stage each one as a ReAI order with the course rows, prices and VAT from EduAdmin, ready to invoice in ReAI.';
const API = 'https://api.eduadmin.se';
const PAYMENT_METHODS = /** @type {Record<string, string>} */ ({ 1: 'Invoice', 2: 'Card', 3: 'Cash' });
const SELECT = 'BookingId,BookingDate,TotalPriceExVat,TotalPriceIncVat,VatSum,Paid,Preliminary,PaymentMethodId,Invoiced,Reference,PurchaseOrderNumber';
const EXPAND = 'Customer($select=CustomerNumber,CustomerName,Address,Address2,Zip,City,CountryCode,OrganisationNumber,Email,Phone),OrderRows';
const PAGE = 200;

/** @type {Booking[]} */
const SAMPLE = [
  {
    id: 51001, date: '2026-10-03', paymentMethod: 'Invoice', reference: 'PO 4471', problem: '',
    customer: { name: 'Fjord Bygg AS', number: '1042', orgnr: '', email: 'faktura@example.no', phone: '', address: 'Strandgata 4', address2: '', zip: '5013', city: 'Bergen', countryCode: 'NO' },
    lines: [
      { itemName: 'Varme arbeider, 1 dag', quantity: 3, unitPrice: 2950, discount: 0, vatPercent: 0, netMinor: 885000 },
      { itemName: 'Kursbok', quantity: 3, unitPrice: 320, discount: 0, vatPercent: 0, netMinor: 96000 },
      { itemName: 'Lunsj', quantity: 3, unitPrice: 180, discount: 0, vatPercent: 25, netMinor: 54000 },
    ],
    netMinor: 1035000, vatMinor: 13500, grossMinor: 1048500,
  },
  {
    id: 51002, date: '2026-10-05', paymentMethod: 'Invoice', reference: '', problem: '',
    customer: { name: 'Ola Nordmann', number: '1043', orgnr: '', email: 'ola@example.no', phone: '', address: 'Bakkeveien 2', address2: '', zip: '0150', city: 'Oslo', countryCode: 'NO' },
    lines: [{ itemName: 'Førstehjelp grunnkurs', quantity: 1, unitPrice: 1490, discount: 0, vatPercent: 0, netMinor: 149000 }],
    netMinor: 149000, vatMinor: 0, grossMinor: 149000,
  },
];

/** @param {unknown} v */
const minor = (v) => Math.round(Number(v ?? 0) * 100);

/**
 * Returns the UTC offset of Europe/Oslo at local midnight of a day, as +HH:MM.
 * @param {string} day YYYY-MM-DD
 */
function osloMidnight(day) {
  const probe = new Date(`${day}T12:00:00Z`);
  const part = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Oslo', timeZoneName: 'longOffset' }).formatToParts(probe).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+01:00';
  const offset = part.replace('GMT', '') || '+00:00';
  return `${day}T00:00:00${offset}`;
}

/** @param {string} iso */
function osloDate(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

/**
 * Converts one OData booking (BookingWithCourse with Customer and OrderRows expanded) to a staged booking.
 * Order rows hold PricePerUnit (incl. VAT when PriceIncVat is true), Quantity, DiscountPercent, VatPercent and Billable.
 * @param {any} b
 * @returns {Booking}
 */
export function mapBooking(b) {
  const c = b?.Customer ?? {};
  /** @type {BookingLine[]} */ const lines = [];
  for (const r of /** @type {any[]} */ (Array.isArray(b?.OrderRows) ? b.OrderRows : [])) {
    if (r?.Billable === false) continue;
    const qty = Number(r?.Quantity ?? 0);
    const vatPercent = Number(r?.VatPercent ?? 0);
    const listPrice = Number(r?.PricePerUnit ?? 0);
    if (!qty || !listPrice) continue;
    const exVat = r?.PriceIncVat ? listPrice / (1 + vatPercent / 100) : listPrice;
    const pct = Number(r?.DiscountPercent ?? 0);
    const wholeDiscount = Number.isInteger(pct) && pct >= 0 && pct <= 100;
    const unitPrice = Math.round((wholeDiscount ? exVat : exVat * (1 - pct / 100)) * 100) / 100;
    const discount = wholeDiscount ? pct : 0;
    lines.push({
      itemName: String(r?.Description ?? r?.ItemNumber ?? 'Course').trim().slice(0, 200) || 'Course',
      quantity: qty,
      unitPrice,
      discount,
      vatPercent,
      netMinor: Math.round(unitPrice * qty * (100 - discount)),
    });
  }
  const netMinor = minor(b?.TotalPriceExVat);
  const lineNet = lines.reduce((s, l) => s + l.netMinor, 0);
  let problem = '';
  if (b?.Preliminary) problem = 'Preliminary booking';
  else if (b?.Invoiced) problem = 'Already invoiced in EduAdmin';
  else if (lines.length === 0) problem = netMinor === 0 ? 'Free booking, nothing to invoice' : 'No billable order rows';
  else if (Math.abs(lineNet - netMinor) > Math.max(2, lines.length)) problem = `Order rows add up to ${formatMinor(lineNet)}, booking total is ${formatMinor(netMinor)}`;
  return {
    id: Number(b?.BookingId ?? 0),
    date: osloDate(String(b?.BookingDate ?? '')),
    customer: {
      name: String(c.CustomerName ?? '').trim(),
      number: String(c.CustomerNumber ?? '').trim(),
      orgnr: extractNorwegianOrg(String(c.OrganisationNumber ?? '')),
      email: String(c.Email ?? '').trim(),
      phone: String(c.Phone ?? '').trim(),
      address: String(c.Address ?? '').trim(),
      address2: String(c.Address2 ?? '').trim(),
      zip: String(c.Zip ?? '').trim(),
      city: String(c.City ?? '').trim(),
      countryCode: /^[A-Za-z]{2}$/.test(String(c.CountryCode ?? '')) ? String(c.CountryCode).toUpperCase() : 'NO',
    },
    lines,
    netMinor,
    vatMinor: minor(b?.VatSum),
    grossMinor: minor(b?.TotalPriceIncVat),
    paymentMethod: PAYMENT_METHODS[String(b?.PaymentMethodId ?? '')] ?? 'Unknown',
    reference: [b?.Reference, b?.PurchaseOrderNumber].map((x) => String(x ?? '').trim()).filter(Boolean).join(' · ').slice(0, 200),
    problem: problem || (c.CustomerName ? '' : 'Booking has no customer'),
  };
}

/**
 * Gets an EduAdmin API token for an API user.
 * Docs: https://api.eduadmin.se (Authentication: POST /token, body username, password, grant_type=password; Bearer token valid 24 h).
 * @param {string} username
 * @param {string} password
 * @param {import('../../lib/api-http.js').FetchLike} fetchImpl
 */
async function login(username, password, fetchImpl) {
  if (!username.trim() || !password) throw new HttpError(400, 'Enter the user name and password of your EduAdmin API user.');
  const res = await fetchJson(`${API}/token`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', accept: 'application/json' },
    body: new URLSearchParams({ username: username.trim(), password, grant_type: 'password' }).toString(),
  }, BRAND, fetchImpl);
  const token = typeof res?.access_token === 'string' ? res.access_token : '';
  if (!token) throw new HttpError(400, 'EduAdmin did not return an access token. Check the API user name and password.');
  return token;
}

/**
 * Reads confirmed, not yet invoiced bookings made in a period.
 * Docs: https://api.eduadmin.se (OData v4: filter, select, expand, top, skip, count; cache=false for fresh data),
 * https://api.eduadmin.se/swagger/v1/swagger.json (GET /v1/odata/Bookings, schemas BookingWithCourse, BookingCustomer, OrderRow).
 * @param {Record<string, string>} creds `username` and `password`, or `token`; `from` and `to` (inclusive, YYYY-MM-DD)
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<{ token: string, bookings: Booking[] }>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const from = String(creds.from ?? '');
  const to = String(creds.to ?? '');
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(from) || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(to) || to < from) throw new HttpError(400, 'Choose a valid booking period.');
  const token = creds.token ? creds.token : await login(creds.username ?? '', creds.password ?? '', fetchImpl);
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' };
  const next = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const filter = `Preliminary eq false and Invoiced eq false and BookingDate ge ${osloMidnight(from)} and BookingDate lt ${osloMidnight(next)}`;
  /** @type {any[]} */ const raw = [];
  for (let page = 0; page < 10; page++) {
    const q = new URLSearchParams({ $filter: filter, $select: SELECT, $expand: EXPAND, $orderby: 'BookingId', $top: String(PAGE), $skip: String(page * PAGE), $count: 'true', cache: 'false' });
    const res = await fetchJson(`${API}/v1/odata/Bookings?${q}`, { headers }, BRAND, fetchImpl);
    /** @type {any[]} */ const items = Array.isArray(res?.value) ? res.value : Array.isArray(res) ? res : [];
    raw.push(...items);
    const count = Number(res?.['@odata.count'] ?? NaN);
    if (items.length === 0 || (Number.isFinite(count) ? raw.length >= count : items.length < PAGE)) break;
  }
  return { token, bookings: raw.map(mapBooking) };
}

/**
 * Reads one booking again server side before it is staged.
 * Docs: https://api.eduadmin.se/swagger/v1/swagger.json (GET /v1/odata/Bookings/{key}).
 * @param {string} token
 * @param {number} id
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 */
export async function fetchBooking(token, id, fetchImpl = fetch) {
  const q = new URLSearchParams({ $select: SELECT, $expand: EXPAND, cache: 'false' });
  return mapBooking(await fetchJson(`${API}/v1/odata/Bookings/${id}?${q}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, BRAND, fetchImpl));
}

/**
 * Marks a booking as invoiced in EduAdmin. Docs: https://api.eduadmin.se/swagger/v1/swagger.json (PATCH /v1/Booking/{bookingId}, PatchBooking.MarkedAsInvoiced).
 * @param {string} token
 * @param {number} id
 * @param {import('../../lib/api-http.js').FetchLike} [fetchImpl]
 */
async function markInvoiced(token, id, fetchImpl = fetch) {
  const res = await fetchImpl(`${API}/v1/Booking/${id}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ MarkedAsInvoiced: true }),
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  return res.ok;
}

/**
 * @param {VatCode[]} codes
 * @param {number} ratePct
 * @param {string} zeroCode
 */
function lineVatCode(codes, ratePct, zeroCode) {
  if (ratePct <= 0) {
    if (!codes.some((c) => c.code === zeroCode && c.rate === 0)) throw new HttpError(400, 'Choose the ReAI VAT code for course rows without VAT above.');
    return zeroCode;
  }
  const match = codes.find((c) => c.vatType === 'output_vat' && !c.reverseCharge && Math.abs(c.rate - ratePct) < 0.001);
  if (!match) throw new HttpError(400, `ReAI has no output VAT code for ${ratePct}% in this company.`);
  return match.code;
}

/**
 * Finds the ReAI customer by organization number, then email, then exact name, or creates it.
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {{ token: string, tenantId: number }} auth
 * @param {BookingCustomer} c
 */
async function ensureCustomer(env, auth, c) {
  /** @param {Record<string, string>} query */
  const find = async (query) => /** @type {{ items: Array<{ id: number | null, name?: string | null }> }} */ (await reaiRequest(env, '/api/customers', { ...auth, query: { ...query, pageSize: '20' } })).items;
  const byOrg = c.orgnr ? (await find({ organizationNumber: c.orgnr }))[0] : undefined;
  if (byOrg?.id) return { id: byOrg.id, created: false };
  const byEmail = c.email ? (await find({ email: c.email }))[0] : undefined;
  if (byEmail?.id) return { id: byEmail.id, created: false };
  if (!c.orgnr && !c.email) {
    const byName = (await find({ name: c.name })).find((x) => String(x.name ?? '').trim().toLowerCase() === c.name.toLowerCase());
    if (byName?.id) return { id: byName.id, created: false };
  }
  const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/customers', {
    ...auth,
    method: 'POST',
    body: {
      name: c.name.slice(0, 200),
      privateContact: !c.orgnr,
      ...(c.orgnr ? { organizationNumber: c.orgnr } : {}),
      ...(c.email ? { email: c.email } : {}),
      ...(c.address ? { addressPart1: c.address } : {}),
      ...(c.address2 ? { addressPart2: c.address2 } : {}),
      ...(c.zip ? { postalCode: c.zip } : {}),
      ...(c.city ? { city: c.city } : {}),
      countryCode: c.countryCode,
    },
  }));
  return { id: created.id, created: true };
}

/** @param {VatCode[]} codes */
function zeroCodeSelect(codes) {
  const zero = codes.filter((c) => c.rate === 0 && !c.reverseCharge);
  const preferred = zero.find((c) => c.vatType === 'exempt') ?? zero.find((c) => c.vatType === 'outside_scope') ?? zero[0];
  return html`<div class="field"><label for="ea-zero">ReAI VAT code for rows without VAT</label><select id="ea-zero" name="zeroVatCode">${zero.length
    ? zero.map((c) => html`<option value="${c.code}"${c === preferred ? html` selected` : ''}>${c.code} ${c.description ?? ''}</option>`)
    : html`<option value="">Connect to ReAI to load VAT codes</option>`}</select></div>`;
}

/**
 * @param {{ bookings: Booking[], token: string, zeroVatCode: string, isSample: boolean }} state
 */
function renderPreview(state) {
  const ready = state.bookings.filter((b) => !b.problem);
  const net = ready.reduce((s, b) => s + b.netMinor, 0);
  const vat = ready.reduce((s, b) => s + b.vatMinor, 0);
  return reaiCard({
    eyebrow: 'EDUADMIN BOOKINGS → REAI ORDERS',
    title: `${state.bookings.length} bookings not invoiced`,
    badge: state.isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${ready.length} ready`, tone: ready.length ? 'success' : 'warn' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Ready to stage', value: String(ready.length), detail: `${state.bookings.length - ready.length} need a fix in EduAdmin` })}
        ${reaiMetric({ label: 'Amount excl. VAT', value: formatMinor(net) })}
        ${reaiMetric({ label: 'VAT', value: formatMinor(vat), detail: 'Rates from the EduAdmin order rows' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Booked</th><th>Customer</th><th>Rows</th><th>Payment</th><th class="num">Excl. VAT</th><th class="num">VAT</th><th>Action</th></tr></thead>
        <tbody>${state.bookings.map((b) => html`<tr id="${SLUG}-row-${b.id}">
          <td class="mono">${b.date}<div class="muted-note">#${b.id}</div></td>
          <td>${b.customer.name || '—'}${b.customer.orgnr ? html`<div class="muted-note mono">${b.customer.orgnr}</div>` : ''}</td>
          <td>${b.lines.map((l) => html`<div>${l.quantity} × ${l.itemName} (${l.vatPercent}%)</div>`)}</td>
          <td>${b.paymentMethod}${b.reference ? html`<div class="muted-note">${b.reference}</div>` : ''}</td>
          <td class="num">${formatMinor(b.netMinor)}</td><td class="num">${formatMinor(b.vatMinor)}</td>
          <td>${b.problem
            ? reaiBadge({ text: b.problem, tone: 'warn' })
            : state.isSample
              ? html`<span class="muted-note">Demo only</span>`
              : html`<form hx-post="${BASE_PATH}/import" hx-target="#${SLUG}-row-${b.id}" hx-swap="outerHTML">
                  <input type="hidden" name="bookingId" value="${b.id}"><input type="hidden" name="eaToken" value="${state.token}">
                  <input type="hidden" name="zeroVatCode" value="${state.zeroVatCode}">
                  <button type="submit" class="button primary">Stage order in ReAI</button>
                </form>`}</td>
        </tr>`)}</tbody>
      </table></div>
      <p class="muted-note">Each booking becomes one ReAI order for its customer, with one line per billable EduAdmin order row priced excluding VAT. After the order is created, the booking is marked as invoiced in EduAdmin. Card and cash bookings are staged too; register the payment on the invoice in ReAI.</p>
      ${state.isSample ? reaiCallout({ tone: 'info', body: 'Sample EduAdmin bookings loaded. Connect to ReAI and fetch real bookings above to stage them.' }) : ''}
    `,
  });
}

/**
 * Handles /app/eduadmin/* routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE_PATH && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE_PATH}/`, request.url), 301);
  if (pathname === `${BASE_PATH}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    /** @type {VatCode[]} */ let codes = [];
    if (session && session.tenantId > 0) {
      try {
        codes = /** @type {VatCode[]} */ (await reaiRequest(env, '/api/vat-codes', { token: session.accessToken, tenantId: session.tenantId, query: { usage: 'customer_invoice' } }));
      } catch {
        codes = [];
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro"><p class="eyebrow">COURSES & EDUCATION</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${SLUG}-web`, clientName: `ReAI ${BRAND} (Web)` })}
        ${reaiCard({
          eyebrow: 'LIVE EDUADMIN API',
          title: 'Fetch bookings that are not invoiced',
          body: html`<p class="muted-note">Use an API user created in EduAdmin. If you have none, ask EduAdmin support to set one up for your account. The password is used only to get a token for these requests and is never stored.</p>
            <form class="stack" hx-post="${BASE_PATH}/fetch-api" hx-target="#${SLUG}-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="ea-user">API user name</label><input id="ea-user" name="username" type="text" autocomplete="off" required></div>
                <div class="field"><label for="ea-pass">API user password</label><input id="ea-pass" name="password" type="password" autocomplete="off" required></div>
                <div class="field"><label for="ea-from">Booked from</label><input id="ea-from" name="from" type="date" value="${today.slice(0, 7)}-01" required></div>
                <div class="field"><label for="ea-to">Booked to</label><input id="ea-to" name="to" type="date" value="${today}" required></div>
                ${zeroCodeSelect(codes)}
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Fetch from EduAdmin</button>
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
  if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderPreview({ bookings: SAMPLE, token: '', zeroVatCode: '', isSample: true }));
  try {
    const form = await request.formData();
    if (pathname === `${BASE_PATH}/fetch-api`) {
      const result = await fetchApi({ username: String(form.get('username') ?? ''), password: String(form.get('password') ?? ''), from: String(form.get('from') ?? ''), to: String(form.get('to') ?? '') });
      if (result.bookings.length === 0) throw new HttpError(400, 'EduAdmin has no confirmed bookings in this period that are not invoiced yet.');
      return htmlResponse(renderPreview({ bookings: result.bookings, token: result.token, zeroVatCode: String(form.get('zeroVatCode') ?? ''), isSample: false }));
    }
    if (pathname === `${BASE_PATH}/import`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const bookingId = Number(form.get('bookingId') ?? '0');
      const token = String(form.get('eaToken') ?? '');
      if (!Number.isInteger(bookingId) || bookingId <= 0 || !token) throw new HttpError(400, 'Fetch the bookings from EduAdmin again.');
      const auth = { token: session.accessToken, tenantId: session.tenantId };
      const externalReference = `eduadmin-booking-${bookingId}`;
      const existing = /** @type {{ items: Array<{ id: number | null, number?: string }> }} */ (await reaiRequest(env, '/api/orders', { ...auth, query: { externalReference, status: 'all', pageSize: '1' } }));
      const dup = existing.items[0];
      if (dup?.id) return htmlResponse(html`<tr><td colspan="7">${reaiBadge({ text: `Booking #${bookingId} is already order ${dup.number ?? dup.id}`, tone: 'warn' })} <a href="${reaiOrigin(env)}/order/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open ↗</a></td></tr>`);
      const booking = await fetchBooking(token, bookingId);
      if (booking.problem) throw new HttpError(400, `Booking #${bookingId}: ${booking.problem}.`);
      const [codes, settings] = await Promise.all([
        /** @type {Promise<VatCode[]>} */ (reaiRequest(env, '/api/vat-codes', { ...auth, query: { usage: 'customer_invoice' } })),
        /** @type {Promise<{ daysUntilDue: number }>} */ (reaiRequest(env, '/api/invoice-settings', auth)),
      ]);
      const zeroCode = String(form.get('zeroVatCode') ?? '');
      const orderLines = booking.lines.map((l) => ({ itemName: l.itemName, quantity: l.quantity, unitPrice: l.unitPrice, ...(l.discount ? { discount: l.discount } : {}), vatCode: lineVatCode(codes, l.vatPercent, zeroCode) }));
      const customer = await ensureCustomer(env, auth, booking.customer);
      const currency = session.tenants.find((t) => t.id === session.tenantId)?.currencyCode ?? 'NOK';
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/orders', {
        ...auth,
        method: 'POST',
        body: {
          customerId: customer.id,
          currencyCode: currency,
          daysUntilDue: Number(settings?.daysUntilDue ?? 14) || 14,
          issueDate: new Date().toISOString().slice(0, 10),
          orderDate: booking.date,
          externalReference,
          ...(booking.reference ? { buyerReference: booking.reference } : {}),
          comment: `EduAdmin booking #${bookingId} (${booking.paymentMethod})`,
          orderLines,
        },
      }));
      const marked = await markInvoiced(token, bookingId);
      const link = html`<a href="${reaiOrigin(env)}/order/${created.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Order ${created.number} ↗</a>`;
      return htmlResponse(html`<tr><td colspan="7">${reaiBadge({ text: `Staged #${bookingId}`, tone: 'success' })} ${link}${customer.created ? ' · new customer' : ''}${marked ? ' · marked as invoiced in EduAdmin' : html` ${reaiBadge({ text: 'Mark the booking as invoiced in EduAdmin yourself', tone: 'warn' })}`}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
