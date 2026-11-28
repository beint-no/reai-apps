// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import {
  assertTwoDecimalCurrency,
  csvAttachment,
  currentMonthIso,
  formatMinor,
  loadActiveBanks,
  loadPendingBankTransactions,
  matchPayouts,
  monthBounds,
} from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * @typedef {'vipps' | 'klarna' | 'zettle' | 'dintero' | 'sumup' | 'nets' | 'paypal'} ProviderSlug
 * @typedef {{ key: string, label: string, secret?: boolean, placeholder: string }} CredentialField
 * @typedef {{ slug: ProviderSlug, brand: string, title: string, lead: string, clientId: string, clientName: string, fields: CredentialField[], hasFees?: boolean }} ProviderConfig
 */

/** @type {Record<ProviderSlug, ProviderConfig>} */
const PROVIDERS = {
  vipps: {
    slug: 'vipps',
    brand: 'Vipps',
    title: 'Vipps Reconcile',
    lead: 'Compare Vipps MobilePay scheduled payouts against pending ReAI bank transactions for one month and export a CSV report.',
    clientId: 'reai-vipps-web',
    clientName: 'ReAI Vipps Reconcile (Web)',
    fields: [
      { key: 'clientId', label: 'Client ID', placeholder: 'Sales unit client_id' },
      { key: 'clientSecret', label: 'Client secret', secret: true, placeholder: 'Sales unit client_secret' },
      { key: 'subscriptionKey', label: 'Ocp-Apim-Subscription-Key', secret: true, placeholder: 'Subscription key' },
      { key: 'msn', label: 'Merchant Serial Number (MSN)', placeholder: '123456' },
    ],
  },
  klarna: {
    slug: 'klarna',
    brand: 'Klarna',
    title: 'Klarna Reconcile',
    lead: 'Compare Klarna settlement payouts against pending ReAI bank transactions for one month and export a CSV report.',
    clientId: 'reai-klarna-web',
    clientName: 'ReAI Klarna Reconcile (Web)',
    fields: [
      { key: 'apiKey', label: 'Klarna API key', secret: true, placeholder: 'klarna_live_api_…' },
    ],
  },
  zettle: {
    slug: 'zettle',
    brand: 'Zettle',
    title: 'Zettle Reconcile',
    lead: 'Compare Zettle liquid-account payouts against pending ReAI bank transactions for one month and export a CSV report.',
    clientId: 'reai-zettle-web',
    clientName: 'ReAI Zettle Reconcile (Web)',
    fields: [
      { key: 'clientId', label: 'Zettle Client ID', placeholder: 'Client ID from developer portal' },
      { key: 'apiKey', label: 'Zettle API key (READ:FINANCE)', secret: true, placeholder: 'JWT assertion key' },
    ],
  },
  dintero: {
    slug: 'dintero',
    brand: 'Dintero',
    title: 'Dintero Fees & Reconcile',
    lead: 'Review withheld fees across paid Dintero settlements, compare net payouts against ReAI bank transactions, and optionally create a monthly review voucher for fees.',
    clientId: 'reai-dintero-web',
    clientName: 'ReAI Dintero Fees (Web)',
    hasFees: true,
    fields: [
      { key: 'accountID', label: 'Dintero Account ID', placeholder: 'P12345678' },
      { key: 'clientID', label: 'Client ID', placeholder: 'Backoffice API client ID' },
      { key: 'clientSecret', label: 'Client secret', secret: true, placeholder: 'Backoffice API client secret' },
    ],
  },
  sumup: {
    slug: 'sumup',
    brand: 'SumUp',
    title: 'SumUp Reconcile',
    lead: 'Compare SumUp card terminal payouts and fees against pending ReAI bank transactions for one month and export a CSV report.',
    clientId: 'reai-sumup-web',
    clientName: 'ReAI SumUp Reconcile (Web)',
    fields: [
      { key: 'merchantCode', label: 'SumUp Merchant Code', placeholder: 'M1234ABCD' },
      { key: 'apiKey', label: 'SumUp API key', secret: true, placeholder: 'sup_sk_…' },
    ],
  },
  nets: {
    slug: 'nets',
    brand: 'Nets Easy',
    title: 'Nets Easy / Nexi Reconcile',
    lead: 'Compare Nets Easy (Nexi Checkout) settlement payouts against pending ReAI bank transactions for one month and export an audit CSV.',
    clientId: 'reai-nets-web',
    clientName: 'ReAI Nets Easy Reconcile (Web)',
    fields: [
      { key: 'secretKey', label: 'Nets Easy Secret API key', secret: true, placeholder: 'live-secret-key-…' },
      { key: 'merchantNumber', label: 'Merchant ID (optional, or "all")', placeholder: 'all' },
    ],
  },
  paypal: {
    slug: 'paypal',
    brand: 'PayPal',
    title: 'PayPal Reconcile',
    lead: 'Compare PayPal Business payout withdrawals against pending ReAI bank transactions for one month and export a reconciliation CSV.',
    clientId: 'reai-paypal-web',
    clientName: 'ReAI PayPal Reconcile (Web)',
    fields: [
      { key: 'clientId', label: 'PayPal REST Client ID', placeholder: 'A21AA…' },
      { key: 'clientSecret', label: 'PayPal REST Client Secret', secret: true, placeholder: 'Secret from PayPal Developer Dashboard' },
    ],
  },
};

/**
 * @param {string} url
 * @param {RequestInit} init
 * @param {string} errPrefix
 */
async function providerJson(url, init, errPrefix) {
  const res = await fetch(url, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status >= 300 && res.status < 400) {
    throw new HttpError(502, `${errPrefix} returned an unexpected redirect.`);
  }
  const text = await res.text();
  return { status: res.status, ok: res.ok, data: text ? JSON.parse(text) : null };
}

/**
 * @param {Record<string, string>} fields
 * @param {string} start
 * @param {string} end
 * @returns {Promise<import('../lib/reconcile.js').PayoutItem[]>}
 */
async function fetchVippsPayouts(fields, start, end) {
  const baseHeaders = {
    accept: 'application/json',
    'vipps-system-name': 'reai-apps',
    'vipps-system-version': '1.0.0',
    'ocp-apim-subscription-key': fields.subscriptionKey ?? '',
    'merchant-serial-number': fields.msn ?? '',
  };
  const tokRes = await providerJson(
    'https://api.vipps.no/accesstoken/get',
    {
      method: 'POST',
      headers: {
        ...baseHeaders,
        'content-type': 'application/json',
        client_id: fields.clientId ?? '',
        client_secret: fields.clientSecret ?? '',
      },
      body: '',
    },
    'Vipps',
  );
  if (!tokRes.ok || !tokRes.data?.access_token) {
    throw new HttpError(400, 'Vipps rejected these credentials or Report API access.');
  }
  const token = String(tokRes.data.access_token);
  const authHeaders = { ...baseHeaders, authorization: `Bearer ${token}` };

  /** @type {Array<{ ledgerId: string, currency: string }>} */
  const ledgers = [];
  let cursor = '';
  for (let page = 0; page < 20; page++) {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    const lRes = await providerJson(`https://api.vipps.no/settlement/v1/ledgers${q}`, { headers: authHeaders }, 'Vipps');
    if (!lRes.ok) {
      throw new HttpError(400, `Vipps ledger lookup failed (HTTP ${lRes.status}).`);
    }
    const items = Array.isArray(lRes.data?.items) ? lRes.data.items : [];
    ledgers.push(...items);
    cursor = typeof lRes.data?.cursor === 'string' ? lRes.data.cursor : '';
    if (!cursor) {
      break;
    }
  }
  if (ledgers.length === 0) {
    throw new HttpError(400, 'No Vipps Report API ledgers are available for this sales unit.');
  }

  /** @type {import('../lib/reconcile.js').PayoutItem[]} */
  const payouts = [];
  let cur = new Date(`${start}T00:00:00Z`);
  const limit = new Date(`${end}T00:00:00Z`);
  while (cur < limit) {
    const day = cur.toISOString().slice(0, 10);
    for (const ledger of ledgers) {
      let c = '';
      for (let p = 0; p < 50; p++) {
        const q = c ? `?cursor=${encodeURIComponent(c)}` : '';
        const r = await providerJson(
          `https://api.vipps.no/report/v2/ledgers/${encodeURIComponent(ledger.ledgerId)}/funds/dates/${day}${q}`,
          { headers: authHeaders },
          'Vipps',
        );
        if (r.status === 404) {
          break;
        }
        if (!r.ok) {
          throw new HttpError(400, `Vipps report failed for ${day} (HTTP ${r.status}).`);
        }
        const items = Array.isArray(r.data?.items) ? r.data.items : [];
        for (const row of items) {
          if (row.entryType === 'payout-scheduled' && typeof row.amount === 'number' && row.amount < 0) {
            payouts.push({
              id: `${ledger.ledgerId}:${row.pspReference ?? `${row.ledgerDate}${row.amount}`}`,
              date: String(row.ledgerDate).slice(0, 10),
              amountMinor: -row.amount,
              currency: String(row.currency),
              reference: String(row.reference ?? row.pspReference ?? ''),
              detail: `Ledger ${ledger.ledgerId} · scheduled payout`,
            });
          }
        }
        c = r.data?.hasMore && typeof r.data?.cursor === 'string' ? r.data.cursor : '';
        if (!c) {
          break;
        }
      }
    }
    cur = new Date(cur.getTime() + 86_400_000);
  }
  return payouts;
}

/**
 * @param {Record<string, string>} fields
 * @param {string} start
 * @param {string} end
 * @returns {Promise<import('../lib/reconcile.js').PayoutItem[]>}
 */
async function fetchKlarnaPayouts(fields, start, end) {
  const key = fields.apiKey ?? '';
  if (!key.startsWith('klarna_live_api_')) {
    throw new HttpError(400, 'Paste a Klarna API key beginning with klarna_live_api_.');
  }
  /** @type {import('../lib/reconcile.js').PayoutItem[]} */
  const payouts = [];
  let offset = 0;
  for (let p = 0; p < 50; p++) {
    const url = new URL('https://api.klarna.com/settlements/v1/payouts');
    url.searchParams.set('size', '100');
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('start_date', `${start}T00:00:00Z`);
    url.searchParams.set('end_date', `${end}T00:00:00Z`);
    const r = await providerJson(
      url.toString(),
      { headers: { authorization: `Basic ${key}`, accept: 'application/json' } },
      'Klarna',
    );
    if (!r.ok) {
      throw new HttpError(400, r.status === 401 || r.status === 403 ? 'Klarna rejected this API key or denied settlement access.' : `Klarna returned HTTP ${r.status}.`);
    }
    const items = Array.isArray(r.data?.payouts) ? r.data.payouts : [];
    for (const item of items) {
      payouts.push({
        id: String(item.payment_reference),
        date: String(item.payout_date).slice(0, 10),
        amountMinor: Number(item.totals?.settlement_amount ?? 0),
        currency: String(item.currency_code),
        reference: String(item.payment_reference),
        detail: `Sales ${item.totals?.sale_amount ?? 0}, fees ${item.totals?.fee_amount ?? 0}, returns ${item.totals?.return_amount ?? 0} minor units`,
      });
    }
    offset += items.length;
    const total = typeof r.data?.pagination?.total === 'number' ? r.data.pagination.total : Infinity;
    if (items.length < 100 || offset >= total) {
      break;
    }
  }
  return payouts;
}

/**
 * @param {Record<string, string>} fields
 * @param {string} start
 * @param {string} end
 * @returns {Promise<import('../lib/reconcile.js').PayoutItem[]>}
 */
async function fetchZettlePayouts(fields, start, end) {
  const form = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    client_id: fields.clientId ?? '',
    assertion: fields.apiKey ?? '',
  });
  const tokRes = await providerJson(
    'https://oauth.zettle.com/token',
    { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() },
    'Zettle',
  );
  if (!tokRes.ok || !tokRes.data?.access_token) {
    throw new HttpError(400, 'Zettle rejected the API key or client ID.');
  }
  const headers = { authorization: `Bearer ${tokRes.data.access_token}`, accept: 'application/json' };
  const balRes = await providerJson('https://finance.izettle.com/v2/accounts/liquid/balance', { headers }, 'Zettle');
  if (!balRes.ok) {
    throw new HttpError(400, balRes.status === 403 ? 'This Zettle key needs READ:FINANCE scope.' : `Zettle returned HTTP ${balRes.status}.`);
  }
  const currency = String(balRes.data?.data?.currencyId ?? 'NOK');

  /** @type {import('../lib/reconcile.js').PayoutItem[]} */
  const payouts = [];
  let offset = 0;
  for (let p = 0; p < 50; p++) {
    const url = new URL('https://finance.izettle.com/v2/accounts/liquid/transactions');
    url.searchParams.set('start', `${start}T00:00:00Z`);
    url.searchParams.set('end', `${end}T00:00:00Z`);
    url.searchParams.set('includeTransactionType', 'PAYOUT');
    url.searchParams.set('limit', '100');
    url.searchParams.set('offset', String(offset));
    const r = await providerJson(url.toString(), { headers }, 'Zettle');
    if (!r.ok) {
      throw new HttpError(400, `Zettle Finance returned HTTP ${r.status}.`);
    }
    const items = Array.isArray(r.data?.data) ? r.data.data : [];
    for (const row of items) {
      if (row.originatorTransactionType === 'PAYOUT' && typeof row.amount === 'number' && row.amount < 0) {
        payouts.push({
          id: String(row.originatingTransactionUuid),
          date: String(row.timestamp).slice(0, 10),
          amountMinor: -row.amount,
          currency,
          reference: String(row.originatingTransactionUuid),
          detail: 'Zettle liquid account payout',
        });
      }
    }
    if (items.length < 100) {
      break;
    }
    offset += items.length;
  }
  return payouts;
}

/**
 * @param {Record<string, string>} fields
 * @param {string} start
 * @param {string} end
 * @returns {Promise<import('../lib/reconcile.js').PayoutItem[]>}
 */
async function fetchDinteroSettlements(fields, start, end) {
  const account = fields.accountID ?? '';
  if (!/^[PT][0-9]{8}$/.test(account)) {
    throw new HttpError(400, 'Enter a valid Dintero account ID (P12345678 or T12345678).');
  }
  const base = `https://api.dintero.com/v1/accounts/${account}`;
  const basic = btoa(`${fields.clientID ?? ''}:${fields.clientSecret ?? ''}`);
  const tokRes = await providerJson(
    `${base}/auth/token`,
    {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credentials', audience: base }),
    },
    'Dintero',
  );
  if (!tokRes.ok || !tokRes.data?.access_token) {
    throw new HttpError(400, 'Dintero rejected these credentials. Check settlement report permissions.');
  }
  const headers = { authorization: `Bearer ${tokRes.data.access_token}`, accept: 'application/json' };
  /** @type {import('../lib/reconcile.js').PayoutItem[]} */
  const payouts = [];
  /** @type {{ id: string, settled_at?: string } | null} */
  let cursor = null;
  const seen = new Set();

  for (let p = 0; p < 50; p++) {
    const url = new URL(`${base}/settlements`);
    url.searchParams.set('limit', '100');
    url.searchParams.set('created_at.gte', start);
    url.searchParams.set('created_at.lte', end);
    if (cursor) {
      if (!cursor.settled_at) {
        throw new HttpError(502, 'Dintero omitted a pagination date.');
      }
      url.searchParams.set('starting_after_id', cursor.id);
      url.searchParams.set('starting_after_date', cursor.settled_at);
    }
    const r = await providerJson(url.toString(), { headers }, 'Dintero');
    if (!r.ok) {
      throw new HttpError(400, `Dintero settlements returned HTTP ${r.status}.`);
    }
    const items = Array.isArray(r.data?.items) ? r.data.items : [];
    for (const item of items) {
      if (seen.has(item.id)) {
        throw new HttpError(502, 'Dintero repeated a settlement page.');
      }
      seen.add(item.id);
      const day = typeof item.settled_at === 'string' ? item.settled_at.slice(0, 10) : '';
      if (String(item.payment_status ?? '').toLowerCase() !== 'paid' || day < start || day >= end) {
        continue;
      }
      const amounts = Array.isArray(item.amounts) ? item.amounts : [];
      amounts.forEach((/** @type {{ amount: number, capture?: number, refund?: number, fee: number, currency: string }} */ a, /** @type {number} */ idx) => {
        payouts.push({
          id: `${item.id}:${idx}`,
          date: day,
          amountMinor: Number(a.amount ?? 0),
          feeMinor: Number(a.fee ?? 0),
          currency: String(a.currency),
          reference: String(item.id),
          detail: `${item.provider ?? 'Dintero'} · captured ${a.capture ?? 0}, refunds ${a.refund ?? 0} minor units`,
        });
      });
    }
    cursor = r.data?.last_evaluated_key ?? null;
    if (!cursor) {
      break;
    }
  }
  return payouts;
}

/**
 * Fetches SumUp payouts for a merchant code and date range.
 * @param {Record<string, string>} fields
 * @param {string} start
 * @param {string} end
 * @returns {Promise<import('../lib/reconcile.js').PayoutItem[]>}
 */
async function fetchSumUpPayouts(fields, start, end) {
  const merchantCode = (fields.merchantCode ?? '').trim();
  const apiKey = (fields.apiKey ?? '').trim();
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(merchantCode) || !apiKey) {
    throw new HttpError(400, 'Enter a valid SumUp Merchant Code and API key.');
  }
  const lastDay = new Date(Date.parse(`${end}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const url = new URL(`https://api.sumup.com/v1.0/merchants/${encodeURIComponent(merchantCode)}/payouts`);
  url.searchParams.set('start_date', start);
  url.searchParams.set('end_date', lastDay);
  url.searchParams.set('format', 'json');
  const r = await providerJson(
    url.toString(),
    { headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' } },
    'SumUp',
  );
  if (!r.ok) {
    throw new HttpError(
      400,
      r.status === 401 || r.status === 403
        ? 'SumUp rejected this API key or merchant code.'
        : `SumUp returned HTTP ${r.status}.`,
    );
  }
  const items = Array.isArray(r.data) ? r.data : [];
  /** @type {import('../lib/reconcile.js').PayoutItem[]} */
  const payouts = [];
  for (const row of items) {
    if (row.type !== 'PAYOUT' || row.status !== 'SUCCESSFUL' || typeof row.amount !== 'number') {
      continue;
    }
    const feeMajor = typeof row.fee === 'number' ? row.fee : 0;
    payouts.push({
      id: String(row.id ?? row.reference ?? `${row.date}-${row.amount}`),
      date: String(row.date ?? '').slice(0, 10),
      amountMinor: Math.round(row.amount * 100),
      currency: String(row.currency ?? 'NOK').toUpperCase(),
      reference: String(row.reference ?? row.transaction_code ?? ''),
      detail: `SumUp payout · fee ${feeMajor.toFixed(2)} ${String(row.currency ?? '').toUpperCase()}`,
    });
  }
  return payouts;
}

/**
 * Fetches Nets Easy / Nexi Checkout Reporting API payouts for the date window.
 * @param {Record<string, string>} fields
 * @param {string} start
 * @param {string} end
 * @returns {Promise<import('../lib/reconcile.js').PayoutItem[]>}
 */
async function fetchNetsPayouts(fields, start, end) {
  const secretKey = (fields.secretKey ?? '').trim();
  if (!secretKey) {
    throw new HttpError(400, 'Enter your Nets Easy Secret API key.');
  }
  const host = secretKey.startsWith('test-') ? 'https://test.api.dibspayment.eu' : 'https://api.dibspayment.eu';
  const lastDay = new Date(Date.parse(`${end}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const url = new URL(`${host}/report/v1/payouts`);
  url.searchParams.set('fromDate', start);
  url.searchParams.set('toDate', lastDay);
  const merchant = (fields.merchantNumber ?? '').trim();
  if (merchant && merchant.toLowerCase() !== 'all') {
    url.searchParams.set('merchantNumber', merchant);
  }
  const r = await providerJson(
    url.toString(),
    { headers: { authorization: secretKey, accept: 'application/json' } },
    'Nets Easy',
  );
  if (!r.ok) {
    throw new HttpError(
      400,
      r.status === 401 || r.status === 403
        ? 'Nets Easy rejected this key or Reporting API access is not enabled on the merchant account.'
        : `Nets Easy Reporting API returned HTTP ${r.status}.`,
    );
  }
  const rows = Array.isArray(r.data) ? r.data : Array.isArray(r.data?.payouts) ? r.data.payouts : [];
  /** @type {import('../lib/reconcile.js').PayoutItem[]} */
  const payouts = [];
  for (const row of rows) {
    const rawAmount = typeof row.amount === 'number' ? row.amount : typeof row.netAmount === 'number' ? row.netAmount : 0;
    const date = String(row.payoutDate ?? row.date ?? '').slice(0, 10);
    if (!date || rawAmount === 0) {
      continue;
    }
    payouts.push({
      id: String(row.payoutId ?? row.reference ?? `${date}-${rawAmount}`),
      date,
      amountMinor: Math.round(Math.abs(rawAmount)),
      currency: String(row.currency ?? 'NOK').toUpperCase(),
      reference: String(row.bankReference ?? row.reference ?? row.payoutId ?? ''),
      detail: `Nets Easy settlement · ${String(row.status ?? 'paid')}`,
    });
  }
  return payouts;
}

/**
 * Fetches PayPal Business payout/withdrawal transactions via Reporting API v1.
 * @param {Record<string, string>} fields
 * @param {string} start
 * @param {string} end
 * @returns {Promise<import('../lib/reconcile.js').PayoutItem[]>}
 */
async function fetchPayPalPayouts(fields, start, end) {
  const basic = btoa(`${fields.clientId ?? ''}:${fields.clientSecret ?? ''}`);
  const tokRes = await providerJson(
    'https://api-m.paypal.com/v1/oauth2/token',
    {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
    },
    'PayPal',
  );
  if (!tokRes.ok || !tokRes.data?.access_token) {
    throw new HttpError(400, 'PayPal rejected these REST API credentials.');
  }
  const headers = { authorization: `Bearer ${tokRes.data.access_token}`, accept: 'application/json' };
  const lastDay = new Date(Date.parse(`${end}T00:00:00Z`) - 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  const url = new URL('https://api-m.paypal.com/v1/reporting/transactions');
  url.searchParams.set('start_date', `${start}T00:00:00Z`);
  url.searchParams.set('end_date', lastDay);
  url.searchParams.set('fields', 'transaction_info');
  url.searchParams.set('page_size', '500');
  const r = await providerJson(url.toString(), { headers }, 'PayPal');
  if (!r.ok) {
    throw new HttpError(
      400,
      r.status === 403
        ? 'Enable Transaction Search permission on your PayPal REST app.'
        : `PayPal Reporting API returned HTTP ${r.status}.`,
    );
  }
  const details = Array.isArray(r.data?.transaction_details) ? r.data.transaction_details : [];
  /** @type {import('../lib/reconcile.js').PayoutItem[]} */
  const payouts = [];
  for (const item of details) {
    const info = item.transaction_info ?? {};
    const code = String(info.transaction_event_code ?? '');
    const amtVal = Number(info.transaction_amount?.value ?? '0');
    const feeVal = Number(info.fee_amount?.value ?? '0');
    if (!code.startsWith('T04') && !code.startsWith('T0001')) {
      continue;
    }
    if (!Number.isFinite(amtVal) || amtVal === 0) {
      continue;
    }
    payouts.push({
      id: String(info.transaction_id ?? `${info.transaction_initiation_date}-${amtVal}`),
      date: String(info.transaction_updated_date ?? info.transaction_initiation_date ?? '').slice(0, 10),
      amountMinor: Math.round(Math.abs(amtVal) * 100),
      currency: String(info.transaction_amount?.currency_code ?? 'NOK').toUpperCase(),
      reference: String(info.bank_reference_id ?? info.transaction_id ?? ''),
      detail: `PayPal ${code} · fee ${Math.abs(feeVal).toFixed(2)}`,
    });
  }
  return payouts;
}

/**
 * @param {ProviderSlug} slug
 * @returns {{ payouts: import('../lib/reconcile.js').PayoutItem[], bankTx: import('../lib/reconcile.js').BankTx[], month: string, currency: string }}
 */
function sampleData(slug) {
  const month = '2026-10';
  const prefix = slug.toUpperCase();
  /** @type {import('../lib/reconcile.js').PayoutItem[]} */
  const payouts = [
    {
      id: `${slug}-1`,
      date: '2026-10-06',
      amountMinor: 1482000,
      ...(slug === 'dintero' ? { feeMinor: 29500 } : {}),
      currency: 'NOK',
      reference: `${prefix}-2610-001`,
      detail: `Sample ${prefix} payout batch 1`,
    },
    {
      id: `${slug}-2`,
      date: '2026-10-14',
      amountMinor: 964500,
      ...(slug === 'dintero' ? { feeMinor: 19200 } : {}),
      currency: 'NOK',
      reference: `${prefix}-2610-002`,
      detail: `Sample ${prefix} payout batch 2`,
    },
    {
      id: `${slug}-3`,
      date: '2026-10-27',
      amountMinor: 712000,
      ...(slug === 'dintero' ? { feeMinor: 14100 } : {}),
      currency: 'NOK',
      reference: `${prefix}-2610-003`,
      detail: `Sample ${prefix} payout batch 3 (pending settlement)`,
    },
  ];
  /** @type {import('../lib/reconcile.js').BankTx[]} */
  const bankTx = [
    {
      id: 9001,
      amount: 14820.0,
      currencyCode: 'NOK',
      transactionDate: '2026-10-07',
      description: `Utbetaling ${prefix}-2610-001`,
      paymentReference: `${prefix}-2610-001`,
    },
    {
      id: 9002,
      amount: 9645.0,
      currencyCode: 'NOK',
      transactionDate: '2026-10-16',
      description: `${prefix} oppgjør`,
      paymentReference: null,
    },
  ];
  return { payouts, bankTx, month, currency: 'NOK' };
}

/**
 * @param {ProviderConfig} cfg
 * @param {{ rows: import('../lib/reconcile.js').ReconcileRow[], month: string, currency: string, excluded: number, bankCount: number, isSample?: boolean, accountID?: string }} state
 */
function renderReviewResults(cfg, state) {
  const { rows, month, currency, excluded, bankCount, isSample, accountID } = state;
  const matched = rows.filter((r) => r.match !== null).length;
  const totalNet = rows.reduce((s, r) => s + r.payout.amountMinor, 0);
  const totalFees = rows.reduce((s, r) => s + Math.abs(r.payout.feeMinor ?? 0), 0);
  const csvRows = [
    cfg.hasFees
      ? ['provider', 'reference', 'payout_date', 'net_payout', 'fee_field', 'currency', 'match_status', 'reai_bank_transaction_id', 'detail']
      : ['provider', 'reference', 'payout_date', 'amount', 'currency', 'match_status', 'reai_bank_transaction_id', 'detail'],
    ...rows.map((r) =>
      cfg.hasFees
        ? [cfg.brand, r.payout.reference, r.payout.date, (r.payout.amountMinor / 100).toFixed(2), ((r.payout.feeMinor ?? 0) / 100).toFixed(2), r.payout.currency, r.status, r.match ? String(r.match.id) : '', r.payout.detail]
        : [cfg.brand, r.payout.reference, r.payout.date, (r.payout.amountMinor / 100).toFixed(2), r.payout.currency, r.status, r.match ? String(r.match.id) : '', r.payout.detail],
    ),
  ];

  return html`
    ${reaiCard({
      eyebrow: 'RECONCILIATION PREVIEW',
      title: `${cfg.brand} · ${month}`,
      badge: isSample
        ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' })
        : reaiBadge({ text: `${matched}/${rows.length} matched`, tone: matched === rows.length && rows.length > 0 ? 'success' : 'warn' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Payouts', value: String(rows.length), detail: `${excluded} other-currency excluded` })}
          ${reaiMetric({ label: 'Net payout total', value: `${formatMinor(totalNet)} ${currency}`, detail: `${bankCount} pending ReAI bank rows` })}
          ${cfg.hasFees
            ? reaiMetric({ label: 'Withheld fees', value: `${formatMinor(totalFees)} ${currency}`, detail: 'Compare against Dintero report' })
            : reaiMetric({ label: 'Bank matches', value: `${matched} / ${rows.length}`, detail: '±8 day window, exact ref or unique amount' })}
        </div>

        ${rows.length === 0
          ? reaiCallout({ tone: 'info', body: `No ${currency} payouts found for ${month}.` })
          : html`
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Reference</th>
                    <th class="num">Net amount</th>
                    ${cfg.hasFees ? html`<th class="num">Fee</th>` : ''}
                    <th>Bank match</th>
                    <th>ReAI Bank Tx</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows.map(
                    (r) => html`<tr>
                      <td class="mono">${r.payout.date}</td>
                      <td class="mono">${r.payout.reference}</td>
                      <td class="num">${formatMinor(r.payout.amountMinor)} ${r.payout.currency}</td>
                      ${cfg.hasFees ? html`<td class="num">${formatMinor(r.payout.feeMinor ?? 0)}</td>` : ''}
                      <td>${reaiBadge({ text: r.status, tone: r.match ? 'success' : 'warn' })}</td>
                      <td class="mono">${r.match ? `#${r.match.id} (${r.match.transactionDate})` : '—'}</td>
                      <td>${r.payout.detail}</td>
                    </tr>`,
                  )}
                </tbody>
              </table>
            </div>
            <form class="stack-sm" method="post" action="/app/${cfg.slug}/export">
              <input type="hidden" name="filename" value="${cfg.slug}-reconciliation-${month}.csv">
              <input type="hidden" name="rowsJson" value="${JSON.stringify(csvRows)}">
              <div>
                <button type="submit" class="button secondary">Download reconciliation CSV ↓</button>
              </div>
            </form>
          `}
      `,
    })}

    ${cfg.hasFees && !isSample && totalFees > 0 && accountID
      ? reaiCard({
          eyebrow: 'OPTIONAL · BOOK WITHHELD FEES',
          title: 'Create monthly fee voucher for review',
          body: html`
            <p class="muted-note">Only book if Dintero withheld these fees directly from payouts and has not separately invoiced them.</p>
            <form class="stack" hx-post="/app/dintero/voucher" hx-target="#dintero-booking" hx-swap="innerHTML">
              <input type="hidden" name="month" value="${month}">
              <input type="hidden" name="accountID" value="${accountID}">
              <input type="hidden" name="totalFeeMinor" value="${totalFees}">
              <div class="inline-row">
                <div class="field">
                  <label for="dintero-expense">Fee expense account (e.g. 7770)</label>
                  <input id="dintero-expense" name="expenseAccount" type="text" pattern="[0-9]{4}" required placeholder="7770">
                </div>
                <div class="field">
                  <label for="dintero-clearing">Payout clearing account (asset/liability)</label>
                  <input id="dintero-clearing" name="clearingAccount" type="text" pattern="[0-9]{4}" required placeholder="1580">
                </div>
              </div>
              <label class="check-row"><input type="checkbox" name="c_deducted" required> I confirm ${formatMinor(totalFees)} ${currency} was withheld from payouts and not separately invoiced.</label>
              <label class="check-row"><input type="checkbox" name="c_report" required> I verified this total against Dintero's official payout reports for ${month}.</label>
              <div>
                <button type="submit" class="button primary">Create review voucher (${formatMinor(totalFees)} ${currency})</button>
              </div>
            </form>
            <div id="dintero-booking" class="stack-sm"></div>
          `,
        })
      : ''}
  `;
}

/**
 * Handles /app/{vipps,klarna,zettle,dintero}/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @param {ProviderSlug} slug
 * @returns {Promise<Response>}
 */
export async function handleReconcile(request, env, slug) {
  const cfg = PROVIDERS[slug];
  const { pathname } = new URL(request.url);
  const basePath = `/app/${slug}`;

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  }

  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    let banks = /** @type {Array<{ id: number, displayName: string, currencyCode: string, ledgerAccountNumber: string }>} */ ([]);
    if (session && session.tenantId > 0) {
      try {
        banks = await loadActiveBanks(env, session);
      } catch {
        banks = [];
      }
    }
    const defaultMonth = currentMonthIso();
    const body = html`
      <section class="app-intro">
        <p class="eyebrow">PAYMENTS & PAYOUTS</p>
        <h1>${cfg.title}</h1>
        <p class="lead">${cfg.lead}</p>
      </section>

      <div class="stack">
        ${renderConnectPanel(session, { clientId: cfg.clientId, clientName: cfg.clientName })}

        ${reaiCard({
          eyebrow: 'ON-DEMAND REVIEW',
          title: `Fetch ${cfg.brand} payouts`,
          body: html`
            <p class="muted-note">Provider credentials are used only for this single HTTPS request and are never stored in cookies, browser storage or a database.</p>
            <form class="stack" hx-post="${basePath}/review" hx-target="#reconcile-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                ${cfg.fields.map(
                  (f) => html`<div class="field">
                    <label for="f-${f.key}">${f.label}</label>
                    <input id="f-${f.key}" name="${f.key}" type="${f.secret ? 'password' : 'text'}" autocomplete="off" required placeholder="${f.placeholder}">
                  </div>`,
                )}
                <div class="field">
                  <label for="reconcile-month">Payout month</label>
                  <input id="reconcile-month" name="month" type="text" pattern="[0-9]{4}-[0-9]{2}" value="${defaultMonth}" required placeholder="YYYY-MM">
                </div>
                <div class="field">
                  <label for="reconcile-bank">ReAI bank account${cfg.hasFees ? ' (optional)' : ''}</label>
                  <select id="reconcile-bank" name="bankId">
                    <option value="0">${banks.length > 0 ? 'Select bank account…' : 'Connect to ReAI to load banks'}</option>
                    ${banks.map((b) => html`<option value="${b.id}">${b.displayName} (${b.ledgerAccountNumber} · ${b.currencyCode})</option>`)}
                  </select>
                </div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Review ${cfg.brand} payouts</button>
                <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#reconcile-output" hx-swap="innerHTML">Load sample review</button>
              </div>
            </form>
          `,
        })}

        <div id="reconcile-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(
      appShell({
        title: cfg.title,
        description: cfg.lead,
        activePath: `${basePath}/`,
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

  if (pathname === `${basePath}/sample`) {
    const sample = sampleData(slug);
    const rows = matchPayouts(sample.payouts, sample.bankTx);
    return htmlResponse(
      renderReviewResults(cfg, {
        rows,
        month: sample.month,
        currency: sample.currency,
        excluded: 0,
        bankCount: sample.bankTx.length,
        isSample: true,
      }),
    );
  }

  if (pathname === `${basePath}/export`) {
    const form = await request.formData();
    const filename = String(form.get('filename') ?? `${slug}-reconciliation.csv`);
    const rows = /** @type {string[][]} */ (JSON.parse(String(form.get('rowsJson') ?? '[]')));
    return csvAttachment(filename, rows);
  }

  if (pathname === `${basePath}/review`) {
    try {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) {
        throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      }
      const company = session.tenants.find((t) => t.id === session.tenantId);
      if (!company) {
        throw new HttpError(400, 'Select a valid ReAI company.');
      }
      assertTwoDecimalCurrency(company.currencyCode);
      const form = await request.formData();
      const bounds = monthBounds(String(form.get('month') ?? '').trim());
      const bankId = Number(form.get('bankId') ?? '0');
      if (!cfg.hasFees && bankId <= 0) {
        throw new HttpError(400, 'Select an active ReAI bank account (reload after connecting to ReAI).');
      }
      /** @type {Record<string, string>} */
      const fields = {};
      for (const f of cfg.fields) {
        const val = String(form.get(f.key) ?? '').trim();
        if (!val) {
          throw new HttpError(400, `Enter ${f.label}.`);
        }
        fields[f.key] = val;
      }

      const [fetched, bankTx] = await Promise.all([
        slug === 'vipps'
          ? fetchVippsPayouts(fields, bounds.start, bounds.end)
          : slug === 'klarna'
            ? fetchKlarnaPayouts(fields, bounds.start, bounds.end)
            : slug === 'zettle'
              ? fetchZettlePayouts(fields, bounds.start, bounds.end)
              : slug === 'sumup'
                ? fetchSumUpPayouts(fields, bounds.start, bounds.end)
                : slug === 'nets'
                  ? fetchNetsPayouts(fields, bounds.start, bounds.end)
                  : slug === 'paypal'
                    ? fetchPayPalPayouts(fields, bounds.start, bounds.end)
                    : fetchDinteroSettlements(fields, bounds.start, bounds.end),
        bankId > 0 ? loadPendingBankTransactions(env, session, bankId, bounds.month) : Promise.resolve([]),
      ]);

      const matching = fetched
        .filter((p) => p.currency === company.currencyCode)
        .sort((a, b) => b.date.localeCompare(a.date));
      const rows = matchPayouts(matching, bankTx);
      return htmlResponse(
        renderReviewResults(cfg, {
          rows,
          month: bounds.month,
          currency: company.currencyCode,
          excluded: fetched.length - matching.length,
          bankCount: bankTx.length,
          ...(slug === 'dintero' && fields.accountID ? { accountID: fields.accountID } : {}),
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Review failed.';
      return htmlResponse(reaiCallout({ tone: 'danger', title: `Could not review ${cfg.brand}`, body: msg }));
    }
  }

  if (slug === 'dintero' && pathname === '/app/dintero/voucher') {
    try {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) {
        throw new HttpError(401, 'Connect to ReAI and choose a company first.');
      }
      const company = session.tenants.find((t) => t.id === session.tenantId);
      if (!company) {
        throw new HttpError(400, 'Select a valid ReAI company.');
      }
      const form = await request.formData();
      const bounds = monthBounds(String(form.get('month') ?? '').trim());
      const accountID = String(form.get('accountID') ?? '').trim();
      const expense = String(form.get('expenseAccount') ?? '').trim();
      const clearing = String(form.get('clearingAccount') ?? '').trim();
      const totalFeeMinor = Number(form.get('totalFeeMinor') ?? '0');

      if (!accountID.startsWith('P')) {
        throw new HttpError(400, 'Test Dintero settlements cannot be booked to ReAI.');
      }
      if (!expense || !clearing || expense === clearing) {
        throw new HttpError(400, 'Choose separate fee expense and payout clearing accounts.');
      }
      if (!Number.isSafeInteger(totalFeeMinor) || totalFeeMinor <= 0) {
        throw new HttpError(400, 'Fee total must be positive.');
      }
      if (form.get('c_deducted') !== 'on' || form.get('c_report') !== 'on') {
        throw new HttpError(400, 'Confirm both checkboxes before creating the voucher.');
      }

      const marker = `Dintero withheld fees ${accountID} ${bounds.month}`;
      const [vouchers, expenseOpts, clearingOpts] = await Promise.all([
        reaiAll(env, '/api/vouchers', {
          token: session.accessToken,
          tenantId: company.id,
          query: { startDate: bounds.start, endDate: bounds.end },
        }),
        reaiRequest(env, '/api/chart-of-accounts/accounts', {
          token: session.accessToken,
          tenantId: company.id,
          query: { accountNumberPrefix: expense },
        }),
        reaiRequest(env, '/api/chart-of-accounts/accounts', {
          token: session.accessToken,
          tenantId: company.id,
          query: { accountNumberPrefix: clearing },
        }),
      ]);

      const voucherList = /** @type {Array<{ description?: string | null }>} */ (vouchers);
      if (voucherList.some((v) => typeof v.description === 'string' && v.description.includes(marker))) {
        throw new HttpError(409, 'A Dintero fee voucher for this account and month already exists in ReAI.');
      }
      const expAccounts = /** @type {Array<{ accountNumber: string, type: string, restrictedToSystemUsage: boolean }>} */ (expenseOpts);
      const clrAccounts = /** @type {Array<{ accountNumber: string, type: string, restrictedToSystemUsage: boolean }>} */ (clearingOpts);
      const validExp = expAccounts.some((a) => a.accountNumber === expense && !a.restrictedToSystemUsage && a.type === 'expense');
      const validClr = clrAccounts.some((a) => a.accountNumber === clearing && !a.restrictedToSystemUsage && (a.type === 'asset' || a.type === 'liability'));
      if (!validExp || !validClr) {
        throw new HttpError(400, 'Use an active expense account and an active asset or liability clearing account from ReAI.');
      }

      const amount = Number((totalFeeMinor / 100).toFixed(2));
      const created = /** @type {import('../lib/types.d.ts').VoucherSummary} */ (
        await reaiRequest(env, '/api/manual-vouchers', {
          token: session.accessToken,
          tenantId: company.id,
          method: 'POST',
          body: {
            date: bounds.lastDay,
            description: marker,
            reviewReason: 'Verify Dintero payout reports, invoicing, fee VAT treatment, and the payout clearing account before finalizing.',
            postings: [
              { accountNumber: expense, postingDate: bounds.lastDay, currencyCode: company.currencyCode, amount, vatCode: '0', rowNumber: 0, description: marker },
              { accountNumber: clearing, postingDate: bounds.lastDay, currencyCode: company.currencyCode, amount: -amount, vatCode: '0', rowNumber: 1, description: marker },
            ],
          },
        })
      );
      const url = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${company.id}`;
      return htmlResponse(
        reaiCallout({
          tone: 'success',
          title: `Created review voucher ${created.number}`,
          body: html`Booked ${formatMinor(totalFeeMinor)} ${company.currencyCode} flagged for review. <a href="${url}" target="_blank" rel="noopener">Open in ReAI ↗</a>`,
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Voucher creation failed.';
      return htmlResponse(reaiCallout({ tone: 'danger', title: 'Could not book Dintero fees', body: msg }));
    }
  }

  return errorResponse('Unknown reconciliation route.', 404);
}
