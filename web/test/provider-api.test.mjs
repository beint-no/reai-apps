// Automated mock-API unit test suite covering all 39 REST provider adapters + SSRF protection.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertPublicHttpsUrl,
  fetchAbaxTripsApi,
  fetchCardsApi,
  fetchHospitalityApi,
  fetchHrExpensesApi,
  fetchHumaEmployeesApi,
  fetchPayoutSettlementApi,
  fetchRetailPosApi,
  fetchSwitcherExtraApi,
  fetchTradeApi,
  fetchTransportOrdersApi,
  fetchTwoApi,
  fetchWellnessApi,
  fetchWfmHoursApi,
} from '../worker/lib/provider-api.js';

/**
 * Helper to create a mock fetch that records calls and returns JSON fixtures by URL match.
 * @param {Array<{ match: string | RegExp, body: unknown, status?: number }>} routes
 */
function mockFetch(routes) {
  /** @type {Array<{ url: string, method: string, headers: Record<string, string>, body?: string }>} */
  const calls = [];
  /** @type {import('../worker/lib/provider-api.js').FetchLike} */
  const fn = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.toString();
    const hdrs = /** @type {Record<string, string>} */ ({});
    if (init.headers && typeof init.headers === 'object') {
      for (const [k, v] of Object.entries(init.headers)) hdrs[k.toLowerCase()] = String(v);
    }
    calls.push({ url, method: (init.method ?? 'GET').toUpperCase(), headers: hdrs, body: typeof init.body === 'string' ? init.body : undefined });
    const hit = routes.find((r) => (typeof r.match === 'string' ? url.includes(r.match) : r.match.test(url)));
    if (!hit) return new Response(JSON.stringify({ error: `Unexpected URL: ${url}` }), { status: 404 });
    return new Response(JSON.stringify(hit.body), { status: hit.status ?? 200, headers: { 'content-type': 'application/json' } });
  };
  return { fn, calls };
}

test('SSRF guard allows public https:// and blocks localhost/private/http', () => {
  assert.equal(assertPublicHttpsUrl('https://api.abax.cloud/v1/trips').hostname, 'api.abax.cloud');
  for (const bad of ['http://api.abax.cloud', 'https://localhost/api', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://192.168.1.1/x', 'https://169.254.169.254/latest', 'https://internal.local/api']) {
    assert.throws(() => assertPublicHttpsUrl(bad), /https:\/\/ host|valid https/i, `Expected SSRF block for ${bad}`);
  }
});

test('Trades: SmartDok 2-step /Authorize/ApiToken -> /WorkHours + Holte, Cordel, Svenn, Minuba, Handyman', async () => {
  // SmartDok 2-step exchange
  {
    const { fn, calls } = mockFetch([
      { match: '/Authorize/ApiToken', body: { token: 'sd-session-jwt' } },
      { match: '/WorkHours', body: [{ id: 'SD-1', workDate: '2026-10-14', projectName: 'Bane Nord', customerName: 'Nordic AS', ordinaryHours: 7.5, netAmount: 9375, comment: 'Grunnarbeid' }] },
    ]);
    const rows = await fetchTradeApi('smartdok', { apiToken: 'sd-access-key', fromDate: '2026-10-01', toDate: '2026-10-31' }, fn);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[1].headers.authorization, 'Bearer sd-session-jwt');
    assert.equal(rows[0].hours, 7.5);
    assert.equal(rows[0].amountExVat, 9375);
  }

  for (const [slug, extra] of /** @type {const} */ ([
    ['holte', {}],
    ['svenn', {}],
    ['minuba', {}],
    ['cordel', { baseUrl: 'https://api.cordel.no' }],
    ['handyman', { baseUrl: 'https://api.handyman.gsgroup.no' }],
  ])) {
    const { fn, calls } = mockFetch([
      { match: /api\./, body: { items: [{ orderNumber: 'ORD-99', date: '2026-10-15', project: 'Prosjekt A', customer: 'Kunde AS', hours: 8, totalExVat: 11200, description: 'Montering' }] } },
    ]);
    const rows = await fetchTradeApi(slug, { apiToken: 'tok-123', fromDate: '2026-10-01', toDate: '2026-10-31', ...extra }, fn);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ref, 'ORD-99');
    assert.equal(rows[0].amountExVat, 11200);
    if (slug === 'handyman') assert.equal(calls[0].headers['x-api-key'], 'tok-123');
    else assert.equal(calls[0].headers.authorization, 'Bearer tok-123');
  }
});

test('Hospitality: Mews Connector API accountingItems/getAll + Favrit, Munu, Lightspeed, VisBook, Quickorder', async () => {
  // Mews official Connector API JSON body
  {
    const { fn, calls } = mockFetch([
      {
        match: '/api/connector/v1/accountingItems/getAll',
        body: {
          AccountingItems: [
            { Type: 'OrderItem', Amount: { GrossValue: 4500, TaxValues: [{ Rate: 0.12 }] } },
            { Type: 'OrderItem', Amount: { GrossValue: 1500, TaxValues: [{ Rate: 0.15 }] } },
            { Type: 'OrderItem', Amount: { GrossValue: 1000, TaxValues: [{ Rate: 0.25 }] } },
            { Type: 'Payment', SubType: 'CreditCard', Amount: { GrossValue: 6850 } },
            { Type: 'Fee', Amount: { GrossValue: 150 } },
          ],
        },
      },
    ]);
    const res = await fetchHospitalityApi('mews', { clientToken: 'ct-1', accessToken: 'at-2', date: '2026-10-24' }, fn);
    assert.equal(calls[0].method, 'POST');
    assert.match(calls[0].body ?? '', /"ClientToken":"ct-1"/);
    assert.equal(res.s12Minor, 450000);
    assert.equal(res.s15Minor, 150000);
    assert.equal(res.s25Minor, 100000);
    assert.equal(res.cardMinor, 685000);
    assert.equal(res.feeMinor, 15000);
    // Balanced debit = credit!
    assert.equal(res.cardMinor + res.cashMinor + res.feeMinor, res.s12Minor + res.s15Minor + res.s25Minor);
  }

  for (const slug of /** @type {const} */ (['favrit', 'munu', 'lightspeed', 'visbook', 'quickorder'])) {
    const { fn } = mockFetch([
      { match: /https:\/\//, body: { reference: 'Z-101', cash: 1000, card: 20000, vipps: 5000, fee: 500, sales25: 20000, sales15: 5500, sales12: 0, tips: 1000 } },
    ]);
    const res = await fetchHospitalityApi(slug, { apiToken: 'tok', businessId: '42', date: '2026-10-24' }, fn);
    assert.equal(res.ref, 'Z-101');
    assert.equal(res.cardMinor + res.cashMinor + res.vippsMinor + res.feeMinor, res.s25Minor + res.s15Minor + res.s12Minor + res.tipsMinor);
  }
});

test('Retail POS: ExtendaGO, PCKasse (X-Api-Key), Susoft balanced Z-reports', async () => {
  for (const slug of /** @type {const} */ (['extendago', 'pckasse', 'susoft'])) {
    const { fn, calls } = mockFetch([
      {
        match: /https:\/\//,
        body: {
          lines: [
            { date: '2026-10-24', account: '1580', description: 'Kort', debit: 12500, credit: 0 },
            { date: '2026-10-24', account: '3000', description: 'Salg', debit: 0, credit: 10000 },
            { date: '2026-10-24', account: '2700', description: 'MVA 25%', debit: 0, credit: 2500 },
          ],
        },
      },
    ]);
    const lines = await fetchRetailPosApi(slug, { apiToken: 'pos-key', date: '2026-10-24' }, fn);
    assert.equal(lines.length, 3);
    assert.equal(lines.reduce((s, l) => s + l.signedMinor, 0), 0);
    if (slug === 'pckasse') assert.equal(calls[0].headers['x-api-key'], 'pos-key');
  }
});

test('Transport & Fleet: ABAX Triplog (meters->km + private filter), Opter TMS, Logistra Cargonizer', async () => {
  // ABAX
  {
    const { fn } = mockFetch([
      {
        match: 'api.abax.cloud/v1/trips',
        body: {
          items: [
            { trip_type: 'business', start_time: '2026-10-14T08:15:00Z', distance: 42500, start_location: { address: 'Oslo Sentrum' }, stop_location: { address: 'Drammen' }, trip_purpose: 'Kundemøte', toll_cost: 88 },
            { trip_type: 'private', start_time: '2026-10-14T18:00:00Z', distance: 12000, start_location: { address: 'Hjem' }, stop_location: { address: 'Butikk' } },
          ],
        },
      },
    ]);
    const trips = await fetchAbaxTripsApi({ apiToken: 'abax-jwt', fromDate: '2026-10-01', toDate: '2026-10-31' }, fn);
    assert.equal(trips.length, 1); // private trip filtered out!
    assert.equal(trips[0].km, 42.5);
    assert.equal(trips[0].toll, 88);
    assert.equal(trips[0].from, 'Oslo Sentrum');
  }

  // Opter & Logistra
  {
    const { fn } = mockFetch([{ match: 'demo.opter.cloud', body: [{ orderNumber: 'OPT-7', date: '2026-10-15', customerName: 'Grossist AS', description: 'Pallfrakt', netAmount: 4200 }] }]);
    const orders = await fetchTransportOrdersApi('opter', { baseUrl: 'https://demo.opter.cloud', apiToken: 'opt-tok', fromDate: '2026-10-01', toDate: '2026-10-31' }, fn);
    assert.equal(orders[0].amountExVat, 4200);
  }
  {
    const { fn, calls } = mockFetch([{ match: 'cargonizer.no', body: { consignments: [{ number: 'CRG-9', createdAt: '2026-10-16', consignee: { name: 'Kyst AS' }, product: 'Bring Bedrift', freightCost: 390 }] } }]);
    const orders = await fetchTransportOrdersApi('logistra', { apiToken: 'cg-key', senderId: '991', fromDate: '2026-10-01', toDate: '2026-10-31' }, fn);
    assert.equal(calls[0].headers['x-cargonizer-key'], 'cg-key');
    assert.equal(calls[0].headers['x-cargonizer-sender'], '991');
    assert.equal(orders[0].amountExVat, 390);
  }
});

test('Corporate Cards: Pleo Open API, Revolut Business & Wise', async () => {
  {
    const { fn } = mockFetch([{ match: 'external.pleo.io', body: { data: [{ performedAt: '2026-10-09', merchant: { name: 'Vy' }, account: { code: '7140' }, amountSettled: { value: 899 } }] } }]);
    const rows = await fetchCardsApi('pleo', { apiToken: 'pleo-key', fromDate: '2026-10-01', toDate: '2026-10-31' }, fn);
    assert.equal(rows[0].account, '7140');
    assert.equal(rows[0].amountMinor, 89900);
  }
  {
    const { fn } = mockFetch([
      { match: 'b2b.revolut.com', body: [{ completed_at: '2026-10-12', merchant: { name: 'AWS' }, legs: [{ amount: -3840, fee: 19.2 }] }, { completed_at: '2026-10-12', legs: [{ amount: 50000 }] }] },
    ]);
    const rows = await fetchCardsApi('revolut', { provider: 'revolut', apiToken: 'rev-tok', fromDate: '2026-10-01', toDate: '2026-10-31' }, fn);
    assert.equal(rows.length, 2); // expense + 7770 fee, positive deposit skipped
    assert.equal(rows[0].amountMinor, 384000);
    assert.equal(rows[1].account, '7770');
  }
  {
    const { fn } = mockFetch([
      { match: 'api.wise.com/v1/profiles', body: [{ id: 777 }] },
      { match: 'api.wise.com/v1/transfers', body: [{ id: 12, created: '2026-10-18', sourceValue: 1250.5, details: { reference: 'Figma' } }] },
    ]);
    const rows = await fetchCardsApi('revolut', { provider: 'wise', apiToken: 'wise-tok', fromDate: '2026-10-01', toDate: '2026-10-31' }, fn);
    assert.equal(rows[0].amountMinor, 125050);
  }
});

test('Settlements: TicketCo, Checkin, Hoopla, Paddle Billing & Two B2B BNPL', async () => {
  {
    const { fn } = mockFetch([{ match: 'api.paddle.com/transactions', body: { data: [{ details: { payout_totals: { total: '150000', fee: '7500' } } }] } }]);
    const res = await fetchPayoutSettlementApi('paddle', { apiToken: 'pdl_live_123', date: '2026-10-31' }, fn);
    assert.equal(res.exemptMinor, 150000);
    assert.equal(res.feeMinor, 7500);
  }
  for (const slug of /** @type {const} */ (['ticketco', 'checkin', 'hoopla'])) {
    const { fn } = mockFetch([{ match: /https:\/\//, body: { data: [{ grossAmount: 1000, vatRate: 0, fee: 35 }, { grossAmount: 500, vatRate: 25, fee: 15 }] } }]);
    const res = await fetchPayoutSettlementApi(slug, { apiToken: 'evt-key', fromDate: '2026-10-01', toDate: '2026-10-31' }, fn);
    assert.equal(res.exemptMinor, 100000);
    assert.equal(res.taxable25Minor, 50000);
    assert.equal(res.feeMinor, 5000);
  }
  {
    const { fn, calls } = mockFetch([{ match: 'api.two.inc/v1/order', body: { items: [{ gross_amount: 50000, merchant_fee: 900 }] } }]);
    const res = await fetchTwoApi({ apiToken: 'two-secret', fromDate: '2026-10-01', toDate: '2026-10-31' }, fn);
    assert.equal(calls[0].headers['x-api-key'], 'two-secret');
    assert.equal(res.principalMinor, 5000000);
    assert.equal(res.feeMinor, 90000);
  }
});

test('HR, WFM, Time & Clinics: Simployer, Acubiz, Quinyx, Severa, Planday, Tamigo, Huma, Busy, Milient, Tidsbanken, EasyPractice, Hano, Fixit', async () => {
  for (const slug of /** @type {const} */ (['simployer', 'acubiz'])) {
    const { fn } = mockFetch([{ match: /https:\/\//, body: [{ date: '2026-10-15', description: 'Hotell', accountNumber: '7140', amount: 1890 }] }]);
    const rows = await fetchHrExpensesApi(slug, { apiToken: 'hr-tok', fromDate: '2026-10-01', toDate: '2026-10-31' }, fn);
    assert.equal(rows[0].amountMinor, 189000);
  }

  for (const slug of /** @type {const} */ (['quinyx', 'severa', 'planday', 'tamigo', 'busy', 'milient', 'tidsbanken'])) {
    const { fn, calls } = mockFetch([{ match: /https:\/\//, body: [{ date: '2026-10-14', hours: 7.5, projectName: 'Avd 1', comment: 'Vakt' }] }]);
    const rows = await fetchWfmHoursApi(slug, { apiToken: 'wfm-tok', clientId: 'pd-cid', subscriptionKey: 'tb-sub', fromDate: '2026-10-01', toDate: '2026-10-31' }, fn);
    assert.equal(rows[0].hours, 7.5);
    if (slug === 'tidsbanken') {
      assert.equal(calls[0].headers['subscription-key'], 'tb-sub');
      assert.equal(calls[0].headers['tidsbanken-key'], 'wfm-tok');
    }
    if (slug === 'planday') assert.equal(calls[0].headers['x-clientid'], 'pd-cid');
  }

  {
    const { fn } = mockFetch([{ match: 'api.hu.ma/v1/users', body: [{ firstName: 'Astrid', lastName: 'Lind', email: 'astrid@example.no', employmentStartDate: '2026-11-01', employmentPercentage: 100, bankAccountNumber: '12345678903' }] }]);
    const emps = await fetchHumaEmployeesApi({ apiToken: 'huma-tok' }, fn);
    assert.equal(emps[0].name, 'Astrid Lind');
    assert.equal(emps[0].bank, '12345678903');
  }

  {
    const { fn } = mockFetch([{ match: 'easypractice.net', body: [{ total: 1200, vat: 0, status: 'paid' }, { total: 500, vat: 100, status: 'unpaid' }] }]);
    const res = await fetchWellnessApi('easypractice', { apiToken: 'ep-pat', fromDate: '2026-10-01', toDate: '2026-10-31' }, fn);
    assert.equal(res.exemptMinor, 120000);
    assert.equal(res.taxable25Minor, 50000);
    assert.equal(res.cardMinor, 120000);
    assert.equal(res.claimMinor, 50000);
  }
  for (const slug of /** @type {const} */ (['hano', 'fixit'])) {
    const { fn } = mockFetch([{ match: /https:\/\//, body: { card: 20000, cash: 1000, fee: 200, exempt: 5000, taxable25: 16200 } }]);
    const res = await fetchWellnessApi(slug, { apiToken: 'wl-tok', date: '2026-10-24' }, fn);
    assert.equal(res.cardMinor + res.cashMinor + res.feeMinor, res.exemptMinor + res.taxable25Minor);
  }
});

test('Accounting Switchers: PowerOffice Go v2 & 24SevenOffice REST API', async () => {
  {
    const { fn, calls } = mockFetch([
      { match: '/v2/Customers', body: [{ Code: 10001, Name: 'Fjord AS', OrganizationNumber: '935606403', EmailAddress: 'post@fjord.no' }] },
      { match: '/v2/Suppliers', body: [{ Code: 20001, Name: 'Grossist AS', OrganizationNumber: '923609016' }] },
      { match: '/v2/Products', body: [{ Code: 'SKU-1', Name: 'Konsulenttime', SalesPrice: 1450 }] },
    ]);
    const items = await fetchSwitcherExtraApi('poweroffice-migrate', { subscriptionKey: 'po-sub', apiToken: 'po-jwt' }, fn);
    assert.equal(items.length, 3);
    assert.equal(calls[0].headers['ocp-apim-subscription-key'], 'po-sub');
    assert.equal(items[0].orgnr, '935606403');
    assert.equal(items[2].price, 1450);
  }
  {
    const { fn } = mockFetch([
      { match: '/v1/customers', body: [{ number: '1001', name: 'Bergen AS', organizationNumber: '935606403' }] },
      { match: '/v1/products', body: [{ sku: 'P1', name: 'Lisens', price: 990 }] },
    ]);
    const items = await fetchSwitcherExtraApi('24sevenoffice-migrate', { apiToken: '24so-jwt' }, fn);
    assert.equal(items.length, 2);
    assert.equal(items[1].kind, 'product');
  }
});
