// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { SETTLEMENT_API_UI, fetchPayoutSettlementApi, renderApiFetchCard } from '../lib/provider-api.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * @typedef {'ticketco' | 'checkin' | 'spond-rubic'} MemberSlug
 * @typedef {{ date: string, ref: string, exemptMinor: number, taxable25Minor: number, feeMinor: number }} MemberSummary
 */

/** @type {Record<MemberSlug, { brand: string, title: string, lead: string, eyebrow: string, sample: MemberSummary }>} */
const MEMBERS = {
  ticketco: {
    brand: 'TicketCo',
    title: 'TicketCo Event & Festival Settlement',
    lead: 'Book TicketCo event payout statements into ReAI splitting VAT-exempt culture/concert tickets (3100, 0%) from 25% bar/merchandise sales (3000) and ticketing fees (7770).',
    eyebrow: 'EVENTS & TICKETING',
    sample: { date: '2026-10-25', ref: 'TC-2026-8841', exemptMinor: 14800000, taxable25Minor: 3125000, feeMinor: 540000 },
  },
  checkin: {
    brand: 'Checkin',
    title: 'Checkin Conference & Course Settlement',
    lead: 'Import Checkin participant registration settlements into balanced ReAI vouchers separating VAT-exempt courses/education (3100) from 25% conference/catering packages (3000) and fees (7770).',
    eyebrow: 'COURSES, CONFERENCES & EVENTS',
    sample: { date: '2026-10-26', ref: 'CHK-2026-4410', exemptMinor: 8400000, taxable25Minor: 4250000, feeMinor: 325000 },
  },
  'spond-rubic': {
    brand: 'Spond Club & Rubic',
    title: 'Spond Club & Rubic Membership Accounting',
    lead: 'Reconcile Spond Club and Rubic sports/association payouts into ReAI separating VAT-exempt membership & activity fees (3100) from 25% club gear sales (3000) and payment fees (7770).',
    eyebrow: 'SPORTS CLUBS & ASSOCIATIONS',
    sample: { date: '2026-10-31', ref: 'SPOND-2026-10', exemptMinor: 9650000, taxable25Minor: 1250000, feeMinor: 272500 },
  },
};

/**
 * @param {MemberSlug} slug
 * @param {MemberSummary} s
 * @param {boolean} isSample
 */
function renderMemberPreview(slug, s, isSample) {
  const cfg = MEMBERS[slug];
  const vat25Net = Math.round((s.taxable25Minor * 100) / 125);
  const vatMinor = s.taxable25Minor - vat25Net;
  const netPayout = s.exemptMinor + s.taxable25Minor - s.feeMinor;
  return html`
    ${reaiCard({
      eyebrow: `${cfg.brand.toUpperCase()} SETTLEMENT VOUCHER`,
      title: `${s.ref} · ${s.date}`,
      badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Net bank / clearing (1580)', value: `${formatMinor(netPayout)} NOK`, detail: 'Matches incoming payout' })}
          ${reaiMetric({ label: 'VAT-exempt revenue (3100)', value: `${formatMinor(s.exemptMinor)} NOK`, detail: 'Culture / courses / membership' })}
          ${reaiMetric({ label: '25% taxable + fees', value: `${formatMinor(s.taxable25Minor)} NOK`, detail: `Fees ${formatMinor(s.feeMinor)} on 7770` })}
        </div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Account</th><th>Posting</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
          <tbody>
            <tr><td class="mono">1580</td><td>${cfg.brand} net settlement clearing</td><td class="num">${formatMinor(netPayout)}</td><td class="num"></td></tr>
            ${s.feeMinor > 0 ? html`<tr><td class="mono">7770</td><td>Platform & payment processing fees</td><td class="num">${formatMinor(s.feeMinor)}</td><td class="num"></td></tr>` : ''}
            ${s.exemptMinor > 0 ? html`<tr><td class="mono">3100</td><td>VAT-exempt tickets / courses / memberships (0%)</td><td class="num"></td><td class="num">${formatMinor(s.exemptMinor)}</td></tr>` : ''}
            ${vat25Net > 0 ? html`<tr><td class="mono">3000</td><td>Taxable sales / catering / merchandise (25% net)</td><td class="num"></td><td class="num">${formatMinor(vat25Net)}</td></tr>` : ''}
            ${vatMinor > 0 ? html`<tr><td class="mono">2700</td><td>Output VAT 25% payable</td><td class="num"></td><td class="num">${formatMinor(vatMinor)}</td></tr>` : ''}
          </tbody>
        </table></div>
        ${!isSample && netPayout > 0
          ? html`<form class="stack-sm confirm-box" hx-post="/app/${slug}/book" hx-target="#mb-booking" hx-swap="innerHTML">
              <input type="hidden" name="summaryJson" value="${JSON.stringify(s)}">
              <label class="check-row"><input type="checkbox" name="c_member" required> I verified these amounts against the official ${cfg.brand} payout statement and will attach the PDF in ReAI.</label>
              <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
            </form><div id="mb-booking" class="stack-sm"></div>`
          : isSample
            ? reaiCallout({ tone: 'info', body: `Enter your real ${cfg.brand} payout figures above and connect to ReAI to create the review voucher.` })
            : ''}
      `,
    })}
  `;
}

/**
 * Handles /app/{ticketco,checkin,spond-rubic}/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @param {MemberSlug} slug
 * @returns {Promise<Response>}
 */
export async function handleMembership(request, env, slug) {
  const cfg = MEMBERS[slug];
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
        ${slug === 'ticketco' || slug === 'checkin'
          ? renderApiFetchCard({
              basePath,
              targetId: 'mb-output',
              brand: SETTLEMENT_API_UI[slug].brand,
              hint: SETTLEMENT_API_UI[slug].hint,
              fields: SETTLEMENT_API_UI[slug].fields,
              sampleAction: true,
            })
          : ''}
        ${reaiCard({
          eyebrow: `${cfg.brand.toUpperCase()} PAYOUT STATEMENT`,
          title: 'Enter settlement summary (NOK)',
          body: html`
            <form class="stack" hx-post="${basePath}/preview" hx-target="#mb-output" hx-swap="innerHTML">
              <div class="mapping-grid">
                <div class="field"><label for="mb-date">Payout date</label><input id="mb-date" name="date" type="date" value="${today}" required></div>
                <div class="field"><label for="mb-ref">Settlement reference</label><input id="mb-ref" name="ref" type="text" placeholder="${cfg.sample.ref}" required></div>
                <div class="field"><label for="mb-ex">VAT-exempt sales / dues (3100)</label><input id="mb-ex" name="exempt" type="number" step="0.01" min="0" value="0"></div>
                <div class="field"><label for="mb-25">Gross 25% taxable sales (3000)</label><input id="mb-25" name="taxable25" type="number" step="0.01" min="0" value="0"></div>
                <div class="field"><label for="mb-fee">Platform & payment fees (7770)</label><input id="mb-fee" name="fee" type="number" step="0.01" min="0" value="0"></div>
              </div>
              <div class="inline-row">
                <button type="submit" class="button primary">Preview balanced voucher</button>
                <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#mb-output" hx-swap="innerHTML">Load sample settlement</button>
              </div>
            </form>
          `,
        })}
        <div id="mb-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: cfg.title, description: cfg.lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${basePath}/sample`) {
    return htmlResponse(renderMemberPreview(slug, cfg.sample, true));
  }

  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api` && (slug === 'ticketco' || slug === 'checkin')) {
      /** @type {Record<string, string>} */
      const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      const summary = await fetchPayoutSettlementApi(slug, creds);
      return htmlResponse(renderMemberPreview(slug, summary, false));
    }
    if (pathname === `${basePath}/preview`) {
      /** @param {string} k */
      const m = (k) => Math.round(Math.max(0, Number(form.get(k) ?? '0') || 0) * 100);
      const date = String(form.get('date') ?? '').trim();
      const ref = String(form.get('ref') ?? '').trim().slice(0, 60);
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !ref) throw new HttpError(400, 'Enter a valid date and reference.');
      return htmlResponse(renderMemberPreview(slug, { date, ref, exemptMinor: m('exempt'), taxable25Minor: m('taxable25'), feeMinor: m('fee') }, false));
    }
    if (pathname === `${basePath}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('c_member') !== 'on') throw new HttpError(400, 'Confirm the verification checkbox first.');
      const s = /** @type {MemberSummary} */ (JSON.parse(String(form.get('summaryJson') ?? '{}')));
      const vat25Net = Math.round((s.taxable25Minor * 100) / 125);
      const vatMinor = s.taxable25Minor - vat25Net;
      const netPayout = s.exemptMinor + s.taxable25Minor - s.feeMinor;
      if (netPayout <= 0) throw new HttpError(400, 'Net settlement must be positive.');
      const marker = `${cfg.brand} payout ${s.ref} ${s.date}`;
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (
        await reaiAll(env, '/api/vouchers', { token: session.accessToken, tenantId: session.tenantId, query: { startDate: s.date, endDate: s.date, includeReversed: 'true' } })
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
        postings.push({ accountNumber: acct, postingDate: s.date, currencyCode: 'NOK', amount: Number((minor / 100).toFixed(2)), vatCode: '0', rowNumber: idx++, description: desc });
      };
      push('1580', netPayout, `${cfg.brand} net settlement`);
      push('7770', s.feeMinor, `${cfg.brand} platform & payment fees`);
      push('3100', -s.exemptMinor, `${cfg.brand} VAT-exempt revenue`);
      push('3000', -vat25Net, `${cfg.brand} taxable 25% revenue`);
      push('2700', -vatMinor, 'Output VAT 25%');

      const created = /** @type {{ id: number, number: string }} */ (
        await reaiRequest(env, '/api/manual-vouchers', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: { date: s.date, description: marker, reviewReason: `${cfg.brand} payout imported via apps.reai.no. Attach source PDF before clearing review.`, postings },
        })
      );
      const url = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${url}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${cfg.brand} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }

  return errorResponse('Unknown membership route.', 404);
}
