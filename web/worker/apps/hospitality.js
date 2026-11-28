// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { HOSP_API_UI, fetchHospitalityApi, renderApiFetchCard } from '../lib/provider-api.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * @typedef {'favrit' | 'quickorder' | 'munu' | 'lightspeed' | 'visbook' | 'mews' | 'wolt-foodora'} HospSlug
 * @typedef {{ account: string, description: string, debitMinor: number, creditMinor: number }} HospLine
 * @typedef {{ date: string, ref: string, lines: HospLine[], debitMinor: number, creditMinor: number }} HospVoucher
 */

/** @type {Record<HospSlug, { brand: string, title: string, lead: string, eyebrow: string, sample: { ref: string, cash: number, card: number, vipps: number, fee: number, s25: number, s15: number, s12: number, tips: number } }>} */
const HOSP = {
  favrit: {
    brand: 'Favrit',
    title: 'Favrit Restaurant POS & QR Accounting',
    lead: 'Book daily Favrit QR-ordering and restaurant POS settlements into ReAI with automatic 25% dine-in/alcohol, 15% takeaway food, tips liability (2930) and payment fee splits.',
    eyebrow: 'RESTAURANT POS & QR ORDERING',
    sample: { ref: 'FAV-2026-1024', cash: 1200, card: 31800, vipps: 14200, fee: 850, s25: 38500, s15: 7650, s12: 0, tips: 1900 },
  },
  quickorder: {
    brand: 'Quickorder (Shopbox)',
    title: 'Quickorder Restaurant POS Accounting',
    lead: 'Convert daily Quickorder (Shopbox) Z-reports into balanced ReAI review vouchers splitting 25% restaurant sales, 15% takeaway, tips (2930) and card/Vipps clearing.',
    eyebrow: 'RESTAURANT & TAKEAWAY POS',
    sample: { ref: 'QO-2026-1024', cash: 950, card: 26400, vipps: 9100, fee: 550, s25: 28200, s15: 7400, s12: 0, tips: 1400 },
  },
  munu: {
    brand: 'Munu',
    title: 'Munu Hospitality POS Accounting',
    lead: 'Book daily Munu hospitality POS settlements directly into ReAI with Norwegian 25%/15% VAT splitting, tips payable (2930) and payment clearing.',
    eyebrow: 'HOSPITALITY & BAR POS',
    sample: { ref: 'MUNU-1024', cash: 1800, card: 42100, vipps: 8400, fee: 700, s25: 48600, s15: 2200, s12: 0, tips: 2200 },
  },
  lightspeed: {
    brand: 'Lightspeed Restaurant',
    title: 'Lightspeed Restaurant (Gastrofix) Sync',
    lead: 'Import daily Lightspeed Restaurant (Gastrofix) accounting summaries into balanced ReAI vouchers with exact Norwegian 25% dine-in, 15% takeaway and tips separation.',
    eyebrow: 'RESTAURANT POS (GASTROFIX)',
    sample: { ref: 'LSR-2026-1024', cash: 2100, card: 54900, vipps: 6300, fee: 900, s25: 57200, s15: 4100, s12: 0, tips: 2900 },
  },
  visbook: {
    brand: 'VisBook',
    title: 'VisBook Hotel & Camping PMS Accounting',
    lead: 'Book VisBook daily or monthly hospitality journals into ReAI with exact Norwegian 12% accommodation VAT (3020), 15% breakfast/food (3010) and 25% bar/services (3000).',
    eyebrow: 'HOTEL, CAMPING & TOURISM PMS',
    sample: { ref: 'VB-2026-1024', cash: 1500, card: 68400, vipps: 9800, fee: 1100, s25: 19200, s15: 14600, s12: 47000, tips: 0 },
  },
  mews: {
    brand: 'Mews PMS',
    title: 'Mews Cloud Hotel PMS Accounting',
    lead: 'Import Mews PMS daily revenue & payment settlements into balanced ReAI review vouchers supporting Norwegian 12% room VAT (3020), 15% F&B (3010) and 25% services (3000).',
    eyebrow: 'CLOUD HOTEL PMS',
    sample: { ref: 'MEWS-2026-1024', cash: 0, card: 92400, vipps: 5600, fee: 1600, s25: 21800, s15: 16800, s12: 61000, tips: 0 },
  },
  'wolt-foodora': {
    brand: 'Wolt & Foodora',
    title: 'Wolt & Foodora Delivery Settlement',
    lead: 'Reconcile Wolt and Foodora payout statements cleanly: splits 15% takeaway food revenue (3010), 25% delivery platform commission (7770/4060) and net bank payout (1580).',
    eyebrow: 'FOOD DELIVERY SETTLEMENTS',
    sample: { ref: 'WOLT-2026-W43', cash: 0, card: 28400, vipps: 0, fee: 7600, s25: 0, s15: 36000, s12: 0, tips: 0 },
  },
};

/** @param {number} grossMinor @param {number} pct */
function splitVat(grossMinor, pct) {
  if (pct <= 0 || grossMinor === 0) {
    return { net: grossMinor, vat: 0 };
  }
  const net = Math.round((grossMinor * 100) / (100 + pct));
  return { net, vat: grossMinor - net };
}

/**
 * @param {string} brand
 * @param {{ date: string, ref: string, cashMinor: number, cardMinor: number, vippsMinor: number, feeMinor: number, s25Minor: number, s15Minor: number, s12Minor: number, tipsMinor: number }} input
 * @returns {HospVoucher}
 */
function buildHospVoucher(brand, input) {
  /** @type {HospLine[]} */
  const lines = [];
  const pfx = `${brand} ${input.ref}`;
  if (input.cashMinor > 0) lines.push({ account: '1900', description: `${pfx} · Cash receipts`, debitMinor: input.cashMinor, creditMinor: 0 });
  if (input.cardMinor > 0) lines.push({ account: '1580', description: `${pfx} · Card / platform settlement`, debitMinor: input.cardMinor, creditMinor: 0 });
  if (input.vippsMinor > 0) lines.push({ account: '1580', description: `${pfx} · Vipps settlement`, debitMinor: input.vippsMinor, creditMinor: 0 });
  if (input.feeMinor > 0) lines.push({ account: '7770', description: `${pfx} · Payment / delivery commission fees`, debitMinor: input.feeMinor, creditMinor: 0 });

  let vatTotal = 0;
  for (const [gross, pct, acct, title] of [
    /** @type {const} */ ([input.s25Minor, 25, '3000', 'Restaurant / bar / services 25% (net)']),
    /** @type {const} */ ([input.s15Minor, 15, '3010', 'Takeaway food & beverages 15% (net)']),
    /** @type {const} */ ([input.s12Minor, 12, '3020', 'Hotel / accommodation 12% (net)']),
  ]) {
    if (gross > 0) {
      const { net, vat } = splitVat(gross, pct);
      vatTotal += vat;
      lines.push({ account: acct, description: `${pfx} · ${title}`, debitMinor: 0, creditMinor: net });
    }
  }
  if (vatTotal > 0) lines.push({ account: '2700', description: `${pfx} · Output VAT payable`, debitMinor: 0, creditMinor: vatTotal });
  if (input.tipsMinor > 0) lines.push({ account: '2930', description: `${pfx} · Staff tips payable`, debitMinor: 0, creditMinor: input.tipsMinor });

  const debitMinor = lines.reduce((s, l) => s + l.debitMinor, 0);
  const creditMinor = lines.reduce((s, l) => s + l.creditMinor, 0);
  return { date: input.date, ref: input.ref, lines, debitMinor, creditMinor };
}

/**
 * @param {HospSlug} slug
 * @param {HospVoucher} v
 * @param {boolean} isSample
 */
function renderHospPreview(slug, v, isSample) {
  const cfg = HOSP[slug];
  const diff = v.debitMinor - v.creditMinor;
  const balanced = diff === 0 && v.debitMinor > 0;
  return html`
    ${reaiCard({
      eyebrow: `${cfg.brand.toUpperCase()} SETTLEMENT VOUCHER`,
      title: `${v.ref} · ${v.date}`,
      badge: balanced
        ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' })
        : reaiBadge({ text: `Diff ${formatMinor(diff)} NOK`, tone: 'danger' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Settlement + fees (Debit)', value: `${formatMinor(v.debitMinor)} NOK`, detail: 'Cash, card, Vipps & commissions' })}
          ${reaiMetric({ label: 'Revenue + VAT + tips (Credit)', value: `${formatMinor(v.creditMinor)} NOK`, detail: '25% / 15% / 12% Norwegian VAT split' })}
          ${reaiMetric({ label: 'Balance check', value: `${formatMinor(diff)} NOK`, detail: balanced ? 'Ready for ReAI review voucher' : 'Totals must match' })}
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Account</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
            <tbody>
              ${v.lines.map(
                (l) => html`<tr>
                  <td class="mono">${l.account}</td>
                  <td>${l.description}</td>
                  <td class="num">${l.debitMinor > 0 ? formatMinor(l.debitMinor) : ''}</td>
                  <td class="num">${l.creditMinor > 0 ? formatMinor(l.creditMinor) : ''}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>
        ${balanced && !isSample
          ? html`<form class="stack-sm confirm-box" hx-post="/app/${slug}/book" hx-target="#hosp-booking" hx-swap="innerHTML">
              <input type="hidden" name="voucherJson" value="${JSON.stringify(v)}">
              <label class="check-row"><input type="checkbox" name="c_confirm" required> I verified these figures against the official ${cfg.brand} settlement report and will attach the PDF in ReAI.</label>
              <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
            </form>
            <div id="hosp-booking" class="stack-sm"></div>`
          : isSample
            ? reaiCallout({ tone: 'info', body: `Synthetic ${cfg.brand} preview loaded. Enter your real daily/weekly settlement totals above and connect to ReAI to book.` })
            : ''}
      `,
    })}
  `;
}

/**
 * Handles /app/{favrit,quickorder,munu,lightspeed,visbook,mews,wolt-foodora}/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @param {HospSlug} slug
 * @returns {Promise<Response>}
 */
export async function handleHospitality(request, env, slug) {
  const cfg = HOSP[slug];
  const { pathname } = new URL(request.url);
  const basePath = `/app/${slug}`;

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  }

  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro">
        <p class="eyebrow">${cfg.eyebrow}</p>
        <h1>${cfg.title}</h1>
        <p class="lead">${cfg.lead}</p>
      </section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${slug}-web`, clientName: `ReAI ${cfg.brand} (Web)` })}
        ${HOSP_API_UI[slug]
          ? renderApiFetchCard({
              basePath,
              targetId: 'hosp-output',
              brand: HOSP_API_UI[slug].brand,
              hint: HOSP_API_UI[slug].hint,
              fields: HOSP_API_UI[slug].fields,
              sampleAction: true,
            })
          : ''}
        ${reaiCard({
          eyebrow: `${cfg.brand.toUpperCase()} DAILY / PERIOD SETTLEMENT`,
          title: 'Enter settlement totals (NOK incl. VAT)',
          body: html`
            <form class="stack" hx-post="${basePath}/preview" hx-target="#hosp-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="h-date">Settlement date</label><input id="h-date" name="date" type="date" value="${today}" required></div>
                <div class="field"><label for="h-ref">Z-report / Payout ref</label><input id="h-ref" name="ref" type="text" placeholder="${cfg.sample.ref}" required></div>
                <div class="field"><label for="h-cash">Cash (1900)</label><input id="h-cash" name="cash" type="number" step="0.01" min="0" value="0"></div>
                <div class="field"><label for="h-card">Card / net payout (1580)</label><input id="h-card" name="card" type="number" step="0.01" min="0" value="0"></div>
                <div class="field"><label for="h-vipps">Vipps (1580)</label><input id="h-vipps" name="vipps" type="number" step="0.01" min="0" value="0"></div>
                <div class="field"><label for="h-fee">Commission / card fees (7770)</label><input id="h-fee" name="fee" type="number" step="0.01" min="0" value="0"></div>
                <div class="field"><label for="h-s25">Gross 25% dine-in / bar (3000)</label><input id="h-s25" name="s25" type="number" step="0.01" min="0" value="0"></div>
                <div class="field"><label for="h-s15">Gross 15% takeaway / food (3010)</label><input id="h-s15" name="s15" type="number" step="0.01" min="0" value="0"></div>
                <div class="field"><label for="h-s12">Gross 12% rooms / stay (3020)</label><input id="h-s12" name="s12" type="number" step="0.01" min="0" value="0"></div>
                <div class="field"><label for="h-tips">Staff tips collected (2930)</label><input id="h-tips" name="tips" type="number" step="0.01" min="0" value="0"></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Preview balanced voucher</button>
                <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#hosp-output" hx-swap="innerHTML">Load sample settlement</button>
              </div>
            </form>
          `,
        })}
        <div id="hosp-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: cfg.title, description: cfg.lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${basePath}/sample`) {
    const s = cfg.sample;
    const v = buildHospVoucher(cfg.brand, {
      date: '2026-10-24',
      ref: s.ref,
      cashMinor: s.cash * 100,
      cardMinor: s.card * 100,
      vippsMinor: s.vipps * 100,
      feeMinor: s.fee * 100,
      s25Minor: s.s25 * 100,
      s15Minor: s.s15 * 100,
      s12Minor: s.s12 * 100,
      tipsMinor: s.tips * 100,
    });
    return htmlResponse(renderHospPreview(slug, v, true));
  }

  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api` && slug !== 'wolt-foodora') {
      /** @type {Record<string, string>} */
      const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      const input = await fetchHospitalityApi(slug, creds);
      return htmlResponse(renderHospPreview(slug, buildHospVoucher(cfg.brand, input), false));
    }
    if (pathname === `${basePath}/preview`) {
      /** @param {string} k */
      const m = (k) => Math.round(Math.max(0, Number(form.get(k) ?? '0') || 0) * 100);
      const date = String(form.get('date') ?? '').trim();
      const ref = String(form.get('ref') ?? '').trim().slice(0, 60);
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !ref) {
        throw new HttpError(400, 'Enter a valid date and settlement reference.');
      }
      const v = buildHospVoucher(cfg.brand, {
        date,
        ref,
        cashMinor: m('cash'),
        cardMinor: m('card'),
        vippsMinor: m('vipps'),
        feeMinor: m('fee'),
        s25Minor: m('s25'),
        s15Minor: m('s15'),
        s12Minor: m('s12'),
        tipsMinor: m('tips'),
      });
      return htmlResponse(renderHospPreview(slug, v, false));
    }

    if (pathname === `${basePath}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('c_confirm') !== 'on') throw new HttpError(400, 'Confirm the verification checkbox first.');
      const v = /** @type {HospVoucher} */ (JSON.parse(String(form.get('voucherJson') ?? '{}')));
      if (!v.lines?.length || v.debitMinor !== v.creditMinor || v.debitMinor <= 0) {
        throw new HttpError(400, 'Settlement voucher must balance to 0.00.');
      }
      const marker = `${cfg.brand} settlement ${v.ref} ${v.date}`;
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (
        await reaiAll(env, '/api/vouchers', {
          token: session.accessToken,
          tenantId: session.tenantId,
          query: { startDate: v.date, endDate: v.date, includeReversed: 'true' },
        })
      );
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) {
        const url = `${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}`;
        return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${url}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      }
      const created = /** @type {{ id: number, number: string }} */ (
        await reaiRequest(env, '/api/manual-vouchers', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: {
            date: v.date,
            description: marker,
            reviewReason: `${cfg.brand} settlement imported via apps.reai.no. Attach official Z-report / payout PDF before clearing review.`,
            postings: v.lines.map((l, idx) => ({
              accountNumber: l.account,
              postingDate: v.date,
              currencyCode: 'NOK',
              amount: Number(((l.debitMinor - l.creditMinor) / 100).toFixed(2)),
              vatCode: '0',
              rowNumber: idx,
              description: l.description,
            })),
          },
        })
      );
      const url = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Attach your ${cfg.brand} report PDF in ReAI: <a href="${url}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${cfg.brand} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }

  return errorResponse('Unknown hospitality route.', 404);
}
