// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { WELLNESS_API_UI, fetchWellnessApi, renderApiFetchCard } from '../lib/provider-api.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * @typedef {'fixit' | 'hano' | 'pasientsky' | 'membro' | 'easypractice'} WellnessSlug
 * @typedef {{ date: string, ref: string, cardMinor: number, cashMinor: number, claimMinor: number, feeMinor: number, exemptMinor: number, taxable25Minor: number }} WellnessVoucher
 */

/** @type {Record<WellnessSlug, { brand: string, title: string, lead: string, eyebrow: string, claimLabel: string, exemptLabel: string, sample: WellnessVoucher }>} */
const WELLNESS = {
  fixit: {
    brand: 'Fixit',
    title: 'Fixit Hair Salon POS & Booking Accounting',
    lead: 'Book daily Fixit hair & beauty salon Z-reports into ReAI splitting 25% treatments & retail products (3000), card/Vipps clearing (1580), cash (1900) and fees (7770).',
    eyebrow: 'HAIR SALONS & BEAUTY POS',
    claimLabel: 'Gift card redemptions / invoice (1570)',
    exemptLabel: 'VAT-exempt services 0% (3100)',
    sample: { date: '2026-10-24', ref: 'FIX-2026-1024', cardMinor: 2480000, cashMinor: 195000, claimMinor: 0, feeMinor: 45000, exemptMinor: 0, taxable25Minor: 2720000 },
  },
  hano: {
    brand: 'Hano',
    title: 'Hano Salon, Spa & Clinic Accounting',
    lead: 'Book daily Hano salon, spa and therapy settlements into ReAI with clean separation of 0% health treatments (3100), 25% salon & product sales (3000) and card fees (7770).',
    eyebrow: 'SALON, SPA & THERAPY POS',
    claimLabel: 'Receivables / invoice sales (1570)',
    exemptLabel: 'VAT-exempt health treatments (3100)',
    sample: { date: '2026-10-24', ref: 'HANO-2026-1024', cardMinor: 1920000, cashMinor: 80000, claimMinor: 0, feeMinor: 35000, exemptMinor: 685000, taxable25Minor: 1350000 },
  },
  pasientsky: {
    brand: 'PasientSky',
    title: 'PasientSky Clinic & HELFO Accounting',
    lead: 'Book PasientSky clinic settlements into ReAI separating patient card/Vipps payments (1580), HELFO claims (1570), VAT-exempt healthcare (3100) and 25% goods (3000).',
    eyebrow: 'MEDICAL & HEALTHCARE CLINICS',
    claimLabel: 'HELFO / insurance claims (1570)',
    exemptLabel: 'VAT-exempt medical services (3100)',
    sample: { date: '2026-10-24', ref: 'PSKY-2026-1024', cardMinor: 1840000, cashMinor: 60000, claimMinor: 1450000, feeMinor: 25000, exemptMinor: 3250000, taxable25Minor: 125000 },
  },
  membro: {
    brand: 'Membro & Xplor Gym',
    title: 'Membro / Xplor Fitness Center Accounting',
    lead: 'Book Norwegian gym & fitness center settlements separating VAT-exempt training memberships (3100, 0%) from 25% PT/merchandise/solarium sales (3000) and AvtaleGiro/card fees (7770).',
    eyebrow: 'GYMS & FITNESS CENTERS',
    claimLabel: 'AvtaleGiro / invoice clearing (1570)',
    exemptLabel: 'VAT-exempt gym memberships 0% (3100)',
    sample: { date: '2026-10-31', ref: 'GYM-2026-10', cardMinor: 14200000, cashMinor: 0, claimMinor: 3800000, feeMinor: 295000, exemptMinor: 16420000, taxable25Minor: 1875000 },
  },
  easypractice: {
    brand: 'EasyPractice & MakePlans',
    title: 'EasyPractice / MakePlans Therapist Billing',
    lead: 'Book therapist, psychologist, osteopath and clinic settlements from EasyPractice or MakePlans into ReAI separating 0% exempt treatments (3100) from 25% taxable sessions (3000).',
    eyebrow: 'THERAPISTS & BOOKING CLINICS',
    claimLabel: 'Invoiced / insurance receivable (1570)',
    exemptLabel: 'VAT-exempt therapy 0% (3100)',
    sample: { date: '2026-10-31', ref: 'EP-2026-10', cardMinor: 5240000, cashMinor: 0, claimMinor: 960000, feeMinor: 110000, exemptMinor: 5810000, taxable25Minor: 500000 },
  },
};

/** @param {WellnessSlug} slug @param {WellnessVoucher} v @param {boolean} isSample */
function renderWellness(slug, v, isSample) {
  const cfg = WELLNESS[slug];
  const vatNet = Math.round((v.taxable25Minor * 100) / 125);
  const vatAmt = v.taxable25Minor - vatNet;
  const debit = v.cardMinor + v.cashMinor + v.claimMinor + v.feeMinor;
  const credit = v.exemptMinor + vatNet + vatAmt;
  const diff = debit - credit;
  const balanced = diff === 0 && debit > 0;
  return reaiCard({
    eyebrow: `${cfg.brand.toUpperCase()} SETTLEMENT VOUCHER`,
    title: `${v.ref} · ${v.date}`,
    badge: balanced ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }) : reaiBadge({ text: `Diff ${formatMinor(diff)} NOK`, tone: 'danger' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Settlements + fees (Debit)', value: `${formatMinor(debit)} NOK`, detail: 'Card, cash, claims & fees' })}
        ${reaiMetric({ label: 'Exempt 0% (3100)', value: `${formatMinor(v.exemptMinor)} NOK`, detail: cfg.exemptLabel })}
        ${reaiMetric({ label: '25% taxable (3000 + 2700)', value: `${formatMinor(v.taxable25Minor)} NOK`, detail: `Net ${formatMinor(vatNet)} + VAT ${formatMinor(vatAmt)}` })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Posting</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>
          ${v.cardMinor > 0 ? html`<tr><td class="mono">1580</td><td>${cfg.brand} · Card / Vipps clearing</td><td class="num">${formatMinor(v.cardMinor)}</td><td class="num"></td></tr>` : ''}
          ${v.cashMinor > 0 ? html`<tr><td class="mono">1900</td><td>${cfg.brand} · Cash</td><td class="num">${formatMinor(v.cashMinor)}</td><td class="num"></td></tr>` : ''}
          ${v.claimMinor > 0 ? html`<tr><td class="mono">1570</td><td>${cfg.brand} · ${cfg.claimLabel}</td><td class="num">${formatMinor(v.claimMinor)}</td><td class="num"></td></tr>` : ''}
          ${v.feeMinor > 0 ? html`<tr><td class="mono">7770</td><td>${cfg.brand} · Payment / platform fees</td><td class="num">${formatMinor(v.feeMinor)}</td><td class="num"></td></tr>` : ''}
          ${v.exemptMinor > 0 ? html`<tr><td class="mono">3100</td><td>${cfg.exemptLabel}</td><td class="num"></td><td class="num">${formatMinor(v.exemptMinor)}</td></tr>` : ''}
          ${vatNet > 0 ? html`<tr><td class="mono">3000</td><td>Taxable 25% sales (net)</td><td class="num"></td><td class="num">${formatMinor(vatNet)}</td></tr>` : ''}
          ${vatAmt > 0 ? html`<tr><td class="mono">2700</td><td>Output VAT 25%</td><td class="num"></td><td class="num">${formatMinor(vatAmt)}</td></tr>` : ''}
        </tbody>
      </table></div>
      ${balanced && !isSample
        ? html`<form class="stack-sm confirm-box" hx-post="/app/${slug}/book" hx-target="#wl-booking" hx-swap="innerHTML">
            <input type="hidden" name="voucherJson" value="${JSON.stringify(v)}">
            <label class="check-row"><input type="checkbox" name="c_wl" required> I verified these figures against my ${cfg.brand} report and will attach the PDF in ReAI.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="wl-booking" class="stack-sm"></div>`
        : isSample
          ? reaiCallout({ tone: 'info', body: `Synthetic ${cfg.brand} preview loaded. Enter your real totals above and connect to ReAI to book.` })
          : ''}
    `,
  });
}

/**
 * Handles /app/{fixit,hano,pasientsky,membro,easypractice}/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @param {WellnessSlug} slug
 * @returns {Promise<Response>}
 */
export async function handleWellnessGym(request, env, slug) {
  const cfg = WELLNESS[slug];
  const { pathname } = new URL(request.url);
  const basePath = `/app/${slug}`;

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  }
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro"><p class="eyebrow">${cfg.eyebrow}</p><h1>${cfg.title}</h1><p class="lead">${cfg.lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${slug}-web`, clientName: `ReAI ${cfg.brand} (Web)` })}
        ${WELLNESS_API_UI[slug]
          ? renderApiFetchCard({
              basePath,
              targetId: 'wl-output',
              brand: WELLNESS_API_UI[slug].brand,
              hint: WELLNESS_API_UI[slug].hint,
              fields: WELLNESS_API_UI[slug].fields,
              sampleAction: true,
            })
          : ''}
        ${reaiCard({
          eyebrow: `${cfg.brand.toUpperCase()} SETTLEMENT ENTRY`,
          title: 'Enter settlement totals (NOK incl. VAT)',
          body: html`<form class="stack" hx-post="${basePath}/preview" hx-target="#wl-output" hx-swap="innerHTML">
            <div class="mapping-grid">
              <div class="field"><label for="wl-d">Date</label><input id="wl-d" name="date" type="date" value="${today}" required></div>
              <div class="field"><label for="wl-r">Report ref</label><input id="wl-r" name="ref" type="text" placeholder="${cfg.sample.ref}" required></div>
              <div class="field"><label for="wl-c">Card / Vipps (1580)</label><input id="wl-c" name="card" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="wl-k">Cash (1900)</label><input id="wl-k" name="cash" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="wl-cl">${cfg.claimLabel}</label><input id="wl-cl" name="claim" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="wl-f">Payment / platform fees (7770)</label><input id="wl-f" name="fee" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="wl-ex">${cfg.exemptLabel}</label><input id="wl-ex" name="exempt" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="wl-25">Gross 25% taxable sales (3000)</label><input id="wl-25" name="taxable25" type="number" step="0.01" min="0" value="0"></div>
            </div>
            <div class="inline-row">
              <button type="submit" class="button primary">Preview balanced voucher</button>
              <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#wl-output" hx-swap="innerHTML">Load sample settlement</button>
            </div>
          </form>`,
        })}
        <div id="wl-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: cfg.title, description: cfg.lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${basePath}/sample`) return htmlResponse(renderWellness(slug, cfg.sample, true));

  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api` && (slug === 'easypractice' || slug === 'hano' || slug === 'fixit')) {
      /** @type {Record<string, string>} */
      const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderWellness(slug, await fetchWellnessApi(slug, creds), false));
    }
    if (pathname === `${basePath}/preview`) {
      /** @param {string} k */
      const m = (k) => Math.round(Math.max(0, Number(form.get(k) ?? '0') || 0) * 100);
      const date = String(form.get('date') ?? '').trim();
      const ref = String(form.get('ref') ?? '').trim().slice(0, 60);
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !ref) throw new HttpError(400, 'Enter valid date and reference.');
      return htmlResponse(renderWellness(slug, { date, ref, cardMinor: m('card'), cashMinor: m('cash'), claimMinor: m('claim'), feeMinor: m('fee'), exemptMinor: m('exempt'), taxable25Minor: m('taxable25') }, false));
    }
    if (pathname === `${basePath}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('c_wl') !== 'on') throw new HttpError(400, 'Confirm verification checkbox first.');
      const v = /** @type {WellnessVoucher} */ (JSON.parse(String(form.get('voucherJson') ?? '{}')));
      const vatNet = Math.round((v.taxable25Minor * 100) / 125);
      const vatAmt = v.taxable25Minor - vatNet;
      if (v.cardMinor + v.cashMinor + v.claimMinor + v.feeMinor !== v.exemptMinor + vatNet + vatAmt) throw new HttpError(400, 'Voucher must balance to 0.00.');
      const marker = `${cfg.brand} ${v.ref} ${v.date}`;
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (
        await reaiAll(env, '/api/vouchers', { token: session.accessToken, tenantId: session.tenantId, query: { startDate: v.date, endDate: v.date, includeReversed: 'true' } })
      );
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) {
        const url = `${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}`;
        return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${url}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      }
      /** @type {Array<Record<string, unknown>>} */
      const postings = [];
      let idx = 0;
      const push = (/** @type {string} */ acct, /** @type {number} */ minor, /** @type {string} */ desc) => {
        if (minor === 0) return;
        postings.push({ accountNumber: acct, postingDate: v.date, currencyCode: 'NOK', amount: Number((minor / 100).toFixed(2)), vatCode: '0', rowNumber: idx++, description: desc });
      };
      push('1580', v.cardMinor, `${cfg.brand} card/Vipps`);
      push('1900', v.cashMinor, `${cfg.brand} cash`);
      push('1570', v.claimMinor, `${cfg.brand} claims`);
      push('7770', v.feeMinor, `${cfg.brand} fees`);
      push('3100', -v.exemptMinor, `${cfg.brand} VAT-exempt revenue`);
      push('3000', -vatNet, `${cfg.brand} 25% net sales`);
      push('2700', -vatAmt, 'Output VAT 25%');

      const created = /** @type {{ id: number, number: string }} */ (
        await reaiRequest(env, '/api/manual-vouchers', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: { date: v.date, description: marker, reviewReason: `${cfg.brand} report imported via apps.reai.no. Attach PDF before clearing review.`, postings },
        })
      );
      const url = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${url}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${cfg.brand} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }

  return errorResponse('Unknown wellness route.', 404);
}
