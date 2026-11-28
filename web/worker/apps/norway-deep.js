// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard } from '../lib/ui.js';

/**
 * @typedef {'fresha' | 'aspit' | 'ledigtime' | 'propely' | 'unibo' | 'ads-spend' | 'autopass' | 'automations'} DeepSlug
 */

/** @type {Record<DeepSlug, { brand: string, eyebrow: string, title: string, lead: string, mode: 'salon' | 'property' | 'reverse-vat' | 'fleet-toll' | 'automations', sample: Record<string, any> }>} */
const DEEP = {
  fresha: {
    brand: 'Fresha',
    eyebrow: 'SALON, BARBERSHOP & BEAUTY POS',
    title: 'Fresha Salon Payout Reconciliation',
    lead: 'Book Fresha salon & barbershop payouts into ReAI separating 25% taxable treatments & retail (3000 + 2700), optional 0% exempt wellness (3100), Fresha fees (7770) and net payout (1580).',
    mode: 'salon',
    sample: { date: '2026-10-31', ref: 'FRS-2026-10', gross25Minor: 9450000, exemptMinor: 0, feeMinor: 236000 },
  },
  aspit: {
    brand: 'Aspit / Physica',
    eyebrow: 'PHYSIOTHERAPY, CHIROPRACTIC & PSYCHOLOGY CLINICS',
    title: 'Aspit & Physica Clinic Settlement',
    lead: 'Book monthly Aspit & Physica clinic settlements (HELFO reimbursements + patient egenandel) separating 0% VAT-exempt healthcare (3100), 25% retail gear (3000 + 2700) and card fees (7770).',
    mode: 'salon',
    sample: { date: '2026-10-31', ref: 'ASP-2026-10', gross25Minor: 680000, exemptMinor: 14200000, feeMinor: 89000 },
  },
  ledigtime: {
    brand: 'Ledigtime & Bokadirekt',
    eyebrow: 'NORWEGIAN & NORDIC SALON BOOKING',
    title: 'Ledigtime / Bokadirekt Settlement',
    lead: 'Reconcile Ledigtime and Bokadirekt salon bookings into ReAI separating 25% hair/beauty services (3000 + 2700), 0% health treatments (3100) and marketplace/card fees (7770).',
    mode: 'salon',
    sample: { date: '2026-10-31', ref: 'LDG-2026-10', gross25Minor: 6120000, exemptMinor: 1450000, feeMinor: 158000 },
  },
  propely: {
    brand: 'Propely',
    eyebrow: 'COMMERCIAL PROPERTY & BOLIGFORVALTNING',
    title: 'Propely Lease & Felleskostnader Journal',
    lead: 'Book monthly Propely commercial & residential property rent rolls into ReAI separating 25% voluntarily VAT-registered rent & felleskostnader (3000 + 2700) from VAT-exempt rent (3100).',
    mode: 'property',
    sample: { date: '2026-10-31', ref: 'PRP-2026-10', gross25Minor: 24500000, exemptMinor: 11200000, feeMinor: 0 },
  },
  unibo: {
    brand: 'Unibo / Borettslag & Sameie',
    eyebrow: 'BOLIGFORVALTNING · BORETTSLAG & SAMEIE',
    title: 'Borettslag & Sameie (Unibo / OBOS) Felleskostnader',
    lead: 'Import monthly housing-association felleskostnader, fellesgjeld interest/principal splits and maintenance reserves from Unibo, OBOS or USBL exports into ReAI.',
    mode: 'property',
    sample: { date: '2026-10-31', ref: 'UNB-2026-10', gross25Minor: 0, exemptMinor: 18600000, feeMinor: 145000 },
  },
  'ads-spend': {
    brand: 'Google Ads, Meta Ads & SaaS VAT',
    eyebrow: 'FOREIGN DIGITAL SERVICES · SNUDD AVREGNING (MVA 14)',
    title: 'Google Ads, Meta Ads & Foreign SaaS Reverse-Charge VAT',
    lead: 'Book foreign digital invoices (Google Ads, Meta Ads, LinkedIn, OpenAI, AWS, Cloudflare) with automatic Norwegian 25% reverse-charge VAT (snudd avregning: debit 2715 / credit 2705) in ReAI.',
    mode: 'reverse-vat',
    sample: { date: '2026-10-31', ref: 'META-INV-2026-10', vendor: 'Meta Platforms Ireland Ltd', account: '7320', netMinor: 2840000 },
  },
  autopass: {
    brand: 'AutoPASS & EasyPark',
    eyebrow: 'NORWEGIAN FLEET TOLLS & PARKING',
    title: 'AutoPASS / Fremtind Tolls & EasyPark Expenses',
    lead: 'Book Norwegian fleet road tolls (bompassering, 0% VAT account 7080) and EasyPark corporate parking (25% VAT account 7140) straight into ReAI review vouchers.',
    mode: 'fleet-toll',
    sample: { date: '2026-10-31', ref: 'AUTOPASS-2026-10', tollMinor: 482000, parkingGross25Minor: 312500 },
  },
  automations: {
    brand: 'Make / Zapier / n8n Hub',
    eyebrow: 'WEBHOOKS & REAI PUBLIC API BLUEPRINTS',
    title: 'Make, Zapier & n8n Automations Hub',
    lead: 'Connect ReAI to 5,000+ apps with ready-to-paste n8n, Make and Zapier HTTP blueprints and verify your live ReAI API token & tenant headers in one click.',
    mode: 'automations',
    sample: {},
  },
};

/**
 * Handles /app/{fresha,aspit,ledigtime,propely,unibo,ads-spend,autopass,automations}/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @param {DeepSlug} slug
 * @returns {Promise<Response>}
 */
export async function handleNorwayDeep(request, env, slug) {
  const cfg = DEEP[slug];
  const { pathname } = new URL(request.url);
  const basePath = `/app/${slug}`;

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  }

  /** @param {Record<string, any>} s @param {boolean} isSample */
  const renderVoucherPreview = (s, isSample) => {
    /** @type {Array<{ acct: string, desc: string, debit: number, credit: number }>} */
    const lines = [];
    if (cfg.mode === 'reverse-vat') {
      const vat = Math.round(s.netMinor * 0.25);
      lines.push({ acct: s.account || '7320', desc: `${s.vendor} · Foreign digital service net`, debit: s.netMinor, credit: 0 });
      lines.push({ acct: '2715', desc: 'Deductible reverse-charge VAT 25% (MVA 14)', debit: vat, credit: 0 });
      lines.push({ acct: '2705', desc: 'Payable reverse-charge VAT 25% (MVA 14)', debit: 0, credit: vat });
      lines.push({ acct: '2400', desc: `${s.vendor} · Supplier / card payable`, debit: 0, credit: s.netMinor });
    } else if (cfg.mode === 'fleet-toll') {
      const parkNet = Math.round((s.parkingGross25Minor * 100) / 125);
      const parkVat = s.parkingGross25Minor - parkNet;
      const total = s.tollMinor + s.parkingGross25Minor;
      if (s.tollMinor > 0) lines.push({ acct: '7080', desc: 'AutoPASS / Fremtind road tolls (0% VAT)', debit: s.tollMinor, credit: 0 });
      if (parkNet > 0) lines.push({ acct: '7140', desc: 'EasyPark fleet parking net (25% VAT)', debit: parkNet, credit: 0 });
      if (parkVat > 0) lines.push({ acct: '2710', desc: 'Input VAT 25% on parking', debit: parkVat, credit: 0 });
      lines.push({ acct: '2400', desc: 'AutoPASS / EasyPark invoice payable', debit: 0, credit: total });
    } else {
      const net25 = Math.round((s.gross25Minor * 100) / 125);
      const vat25 = s.gross25Minor - net25;
      const netClearing = s.gross25Minor + s.exemptMinor - s.feeMinor;
      lines.push({ acct: '1580', desc: `${cfg.brand} net settlement clearing`, debit: netClearing, credit: 0 });
      if (s.feeMinor > 0) lines.push({ acct: '7770', desc: `${cfg.brand} platform / management fee`, debit: s.feeMinor, credit: 0 });
      if (net25 > 0) lines.push({ acct: '3000', desc: `${cfg.brand} 25% taxable revenue net`, debit: 0, credit: net25 });
      if (vat25 > 0) lines.push({ acct: '2700', desc: 'Output VAT 25%', debit: 0, credit: vat25 });
      if (s.exemptMinor > 0) lines.push({ acct: '3100', desc: `${cfg.brand} 0% VAT-exempt revenue`, debit: 0, credit: s.exemptMinor });
    }

    return reaiCard({
      eyebrow: `${cfg.brand.toUpperCase()} VOUCHER PREVIEW`,
      title: `${s.ref} · ${s.date}`,
      badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }),
      body: html`
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Account</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
          <tbody>${lines.map((l) => html`<tr><td class="mono">${l.acct}</td><td>${l.desc}</td><td class="num">${l.debit ? formatMinor(l.debit) : ''}</td><td class="num">${l.credit ? formatMinor(l.credit) : ''}</td></tr>`)}</tbody>
        </table></div>
        ${!isSample
          ? html`<form class="stack-sm confirm-box" hx-post="${basePath}/book" hx-target="#dp-booking" hx-swap="innerHTML">
              <input type="hidden" name="date" value="${s.date}">
              <input type="hidden" name="ref" value="${s.ref}">
              <input type="hidden" name="linesJson" value="${JSON.stringify(lines)}">
              <label class="check-row"><input type="checkbox" name="c_dp" required> I verified these figures against the source statement from ${cfg.brand}.</label>
              <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
            </form><div id="dp-booking" class="stack-sm"></div>`
          : reaiCallout({ tone: 'info', body: `Synthetic ${cfg.brand} preview loaded. Enter your real totals above and connect to ReAI to book.` })}
      `,
    });
  };

  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const today = new Date().toISOString().slice(0, 10);

    let formCard;
    if (cfg.mode === 'automations') {
      formCard = reaiCard({
        eyebrow: 'N8N · MAKE · ZAPIER BLUEPRINTS',
        title: 'Ready-to-paste ReAI REST API request templates',
        body: html`
          <p class="muted-note">Every Make, Zapier or n8n workflow talks directly to <code>https://app.reai.no/api/*</code> with two headers: <code>Authorization: Bearer &lt;token&gt;</code> and <code>X-Tenant-Id: &lt;tenantId&gt;</code>.</p>
          <div class="table-wrap"><table class="data-table">
            <thead><tr><th>Workflow</th><th>Endpoint</th><th>Use case</th></tr></thead>
            <tbody>
              <tr><td><strong>Create Customer</strong></td><td class="mono">POST /api/customers</td><td>Sync new CRM / Stripe / Webflow buyers</td></tr>
              <tr><td><strong>Create Draft Order</strong></td><td class="mono">POST /api/orders</td><td>Turn won deals or form submissions into invoices</td></tr>
              <tr><td><strong>Save Brreg Lead</strong></td><td class="mono">POST /api/leads</td><td>Enrich incoming signups from Brønnøysund</td></tr>
              <tr><td><strong>Log Driving Trip</strong></td><td class="mono">POST /api/driving-log/trips</td><td>Automate mileage from GPS / calendar triggers</td></tr>
              <tr><td><strong>Post Review Voucher</strong></td><td class="mono">POST /api/manual-vouchers</td><td>Automate daily payouts & platform settlements</td></tr>
            </tbody>
          </table></div>
          <div class="inline-row">
            <button type="button" class="button primary" hx-post="${basePath}/test-me" hx-target="#dp-output" hx-swap="innerHTML">Test live /api/me connection</button>
            <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#dp-output" hx-swap="innerHTML">Show n8n JSON snippet</button>
          </div>
        `,
      });
    } else if (cfg.mode === 'reverse-vat') {
      formCard = reaiCard({
        eyebrow: 'FOREIGN DIGITAL INVOICE (SNUDD AVREGNING)',
        title: 'Enter foreign ad / SaaS invoice amount (NOK)',
        body: html`<form class="stack" hx-post="${basePath}/preview" hx-target="#dp-output" hx-swap="innerHTML">
          <div class="mapping-grid">
            <div class="field"><label for="dp-d">Invoice date</label><input id="dp-d" name="date" type="date" value="${today}" required></div>
            <div class="field"><label for="dp-r">Invoice ref</label><input id="dp-r" name="ref" type="text" placeholder="META-2026-10" required></div>
            <div class="field"><label for="dp-v">Vendor</label><input id="dp-v" name="vendor" type="text" value="Google Ireland / Meta Ads" required></div>
            <div class="field"><label for="dp-a">Expense account</label><select id="dp-a" name="account"><option value="7320">7320 — Reklame / annonsering</option><option value="6995">6995 — Programvare / SaaS-lisenser</option><option value="6553">6553 — Skyinfrastruktur / API</option></select></div>
            <div class="field"><label for="dp-n">Net amount ex. VAT (NOK)</label><input id="dp-n" name="net" type="number" step="0.01" min="0" value="0" required></div>
          </div>
          <div class="inline-row">
            <button type="submit" class="button primary">Preview reverse-charge voucher</button>
            <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#dp-output" hx-swap="innerHTML">Load sample Meta Ads invoice</button>
          </div>
        </form>`,
      });
    } else if (cfg.mode === 'fleet-toll') {
      formCard = reaiCard({
        eyebrow: 'AUTOPASS & EASYPARK STATEMENT',
        title: 'Enter monthly tolls (0%) and parking (25%)',
        body: html`<form class="stack" hx-post="${basePath}/preview" hx-target="#dp-output" hx-swap="innerHTML">
          <div class="mapping-grid">
            <div class="field"><label for="dp-d">Date</label><input id="dp-d" name="date" type="date" value="${today}" required></div>
            <div class="field"><label for="dp-r">Invoice ref</label><input id="dp-r" name="ref" type="text" placeholder="AUTOPASS-2026-10" required></div>
            <div class="field"><label for="dp-t">AutoPASS road tolls 0% (7080)</label><input id="dp-t" name="toll" type="number" step="0.01" min="0" value="0"></div>
            <div class="field"><label for="dp-p">EasyPark parking incl. 25% VAT (7140)</label><input id="dp-p" name="parking" type="number" step="0.01" min="0" value="0"></div>
          </div>
          <div class="inline-row">
            <button type="submit" class="button primary">Preview balanced voucher</button>
            <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#dp-output" hx-swap="innerHTML">Load sample statement</button>
          </div>
        </form>`,
      });
    } else {
      formCard = reaiCard({
        eyebrow: `${cfg.brand.toUpperCase()} SETTLEMENT`,
        title: 'Enter period totals (NOK)',
        body: html`<form class="stack" hx-post="${basePath}/preview" hx-target="#dp-output" hx-swap="innerHTML">
          <div class="mapping-grid">
            <div class="field"><label for="dp-d">Date</label><input id="dp-d" name="date" type="date" value="${today}" required></div>
            <div class="field"><label for="dp-r">Reference</label><input id="dp-r" name="ref" type="text" placeholder="${cfg.sample.ref}" required></div>
            <div class="field"><label for="dp-25">Gross 25% taxable (3000)</label><input id="dp-25" name="gross25" type="number" step="0.01" min="0" value="0"></div>
            <div class="field"><label for="dp-0">0% VAT-exempt (3100)</label><input id="dp-0" name="exempt" type="number" step="0.01" min="0" value="0"></div>
            <div class="field"><label for="dp-f">Platform / management fee (7770)</label><input id="dp-f" name="fee" type="number" step="0.01" min="0" value="0"></div>
          </div>
          <div class="inline-row">
            <button type="submit" class="button primary">Preview balanced voucher</button>
            <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#dp-output" hx-swap="innerHTML">Load sample report</button>
          </div>
        </form>`,
      });
    }

    const body = html`
      <section class="app-intro"><p class="eyebrow">${cfg.eyebrow}</p><h1>${cfg.title}</h1><p class="lead">${cfg.lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${slug}-web`, clientName: `ReAI ${cfg.brand} (Web)` })}
        ${formCard}
        <div id="dp-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: cfg.title, description: cfg.lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${basePath}/sample`) {
    if (cfg.mode === 'automations') {
      return htmlResponse(
        reaiCard({
          eyebrow: 'N8N / MAKE HTTP NODE SNIPPET',
          title: 'Create customer in ReAI on webhook trigger',
          badge: reaiBadge({ text: 'Ready to copy', tone: 'accent' }),
          body: html`<pre><code>POST https://app.reai.no/api/customers
Authorization: Bearer YOUR_REAI_ACCESS_TOKEN
X-Tenant-Id: YOUR_TENANT_ID
Content-Type: application/json

{"name":"Nordic Demo AS","organizationNumber":"935606403","countryCode":"NO"}</code></pre>`,
        }),
      );
    }
    return htmlResponse(renderVoucherPreview(cfg.sample, true));
  }

  try {
    const form = await request.formData();
    if (pathname === `${basePath}/preview`) {
      /** @param {string} k */
      const m = (k) => Math.round(Math.max(0, Number(form.get(k) ?? '0') || 0) * 100);
      const date = String(form.get('date') ?? '').trim();
      const ref = String(form.get('ref') ?? '').trim().slice(0, 60);
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !ref) throw new HttpError(400, 'Enter valid date and reference.');
      if (cfg.mode === 'reverse-vat') {
        return htmlResponse(renderVoucherPreview({ date, ref, vendor: String(form.get('vendor') ?? 'Foreign SaaS').trim(), account: String(form.get('account') ?? '7320').trim(), netMinor: m('net') }, false));
      }
      if (cfg.mode === 'fleet-toll') {
        return htmlResponse(renderVoucherPreview({ date, ref, tollMinor: m('toll'), parkingGross25Minor: m('parking') }, false));
      }
      return htmlResponse(renderVoucherPreview({ date, ref, gross25Minor: m('gross25'), exemptMinor: m('exempt'), feeMinor: m('fee') }, false));
    }

    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');

    if (cfg.mode === 'automations' && pathname === `${basePath}/test-me`) {
      const me = /** @type {any} */ (await reaiRequest(env, '/api/me', { token: session.accessToken, tenantId: session.tenantId }));
      return htmlResponse(
        reaiCallout({
          tone: 'success',
          title: 'ReAI Public API verified',
          body: html`Authenticated against <code>${reaiOrigin(env)}/api/me</code> for tenant <code>${session.tenantId}</code> (${me.email || me.name || 'OK'}).`,
        }),
      );
    }

    if (pathname === `${basePath}/book`) {
      if (form.get('c_dp') !== 'on') throw new HttpError(400, 'Confirm verification checkbox first.');
      const date = String(form.get('date') ?? '').trim();
      const ref = String(form.get('ref') ?? '').trim();
      const lines = /** @type {Array<{ acct: string, desc: string, debit: number, credit: number }>} */ (JSON.parse(String(form.get('linesJson') ?? '[]')));
      const postings = lines
        .filter((l) => l.debit > 0 || l.credit > 0)
        .map((l, idx) => ({
          accountNumber: l.acct,
          postingDate: date,
          currencyCode: 'NOK',
          amount: Number(((l.debit > 0 ? l.debit : -l.credit) / 100).toFixed(2)),
          vatCode: '0',
          rowNumber: idx,
          description: l.desc,
        }));
      const created = /** @type {{ id: number, number: string }} */ (
        await reaiRequest(env, '/api/manual-vouchers', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: { date, description: `${cfg.brand} ${ref} ${date}`, reviewReason: `Imported from ${cfg.brand} via apps.reai.no.`, postings },
        })
      );
      const url = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${url}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${cfg.brand} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }

  return errorResponse('Unknown app route.', 404);
}
