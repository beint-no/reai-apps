// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard } from '../lib/ui.js';

const SAMPLE = { date: '2026-10-31', ref: 'META-INV-2026-10', vendor: 'Meta Platforms Ireland Ltd', account: '7320', netMinor: 2840000 };

/** @param {{ date: string, ref: string, vendor: string, account: string, netMinor: number }} s @param {boolean} isSample */
function renderPreview(s, isSample) {
  const vat = Math.round(s.netMinor * 0.25);
  const lines = [
    { acct: s.account || '7320', desc: `${s.vendor} · Foreign digital service net`, debit: s.netMinor, credit: 0 },
    { acct: '2715', desc: 'Deductible reverse-charge VAT 25% (MVA 14)', debit: vat, credit: 0 },
    { acct: '2705', desc: 'Payable reverse-charge VAT 25% (MVA 14)', debit: 0, credit: vat },
    { acct: '2400', desc: `${s.vendor} · Supplier / card payable`, debit: 0, credit: s.netMinor },
  ];
  return reaiCard({
    eyebrow: 'FOREIGN DIGITAL INVOICE · REVERSE-CHARGE VAT',
    title: `${s.ref} · ${s.date}`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }),
    body: html`
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${lines.map((l) => html`<tr><td class="mono">${l.acct}</td><td>${l.desc}</td><td class="num">${l.debit ? formatMinor(l.debit) : ''}</td><td class="num">${l.credit ? formatMinor(l.credit) : ''}</td></tr>`)}</tbody>
      </table></div>
      ${!isSample
        ? html`<form class="stack-sm confirm-box" hx-post="/app/ads-spend/book" hx-target="#dp-booking" hx-swap="innerHTML">
            <input type="hidden" name="date" value="${s.date}"><input type="hidden" name="ref" value="${s.ref}"><input type="hidden" name="linesJson" value="${JSON.stringify(lines)}">
            <label class="check-row"><input type="checkbox" name="c_dp" required> I verified these figures against the foreign ad / SaaS invoice.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="dp-booking" class="stack-sm"></div>`
        : reaiCallout({ tone: 'info', body: 'Synthetic Meta Ads invoice loaded. Enter your real foreign digital invoice above and connect to ReAI to book.' })}
    `,
  });
}

/**
 * Handles /app/ads-spend/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/ads-spend';
  const title = 'Google Ads, Meta Ads & Foreign SaaS Reverse-Charge VAT';
  const lead = 'Book foreign digital invoices (Google Ads, Meta Ads, LinkedIn, OpenAI, AWS, Cloudflare) with automatic Norwegian 25% reverse-charge VAT (snudd avregning: debit 2715 / credit 2705) in ReAI.';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro"><p class="eyebrow">FOREIGN DIGITAL SERVICES · SNUDD AVREGNING (MVA 14)</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-ads-spend-web', clientName: 'ReAI Ads & SaaS VAT (Web)' })}
        ${reaiCard({
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
            <div class="inline-row"><button type="submit" class="button primary">Preview reverse-charge voucher</button><button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#dp-output" hx-swap="innerHTML">Load sample Meta Ads invoice</button></div>
          </form>`,
        })}
        <div id="dp-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) return htmlResponse(renderPreview(SAMPLE, true));

  try {
    const form = await request.formData();
    if (pathname === `${basePath}/preview`) {
      const date = String(form.get('date') ?? '').trim();
      const ref = String(form.get('ref') ?? '').trim().slice(0, 60);
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !ref) throw new HttpError(400, 'Enter valid date and reference.');
      const netMinor = Math.round(Math.max(0, Number(form.get('net') ?? '0') || 0) * 100);
      return htmlResponse(renderPreview({ date, ref, vendor: String(form.get('vendor') ?? 'Foreign SaaS').trim(), account: String(form.get('account') ?? '7320').trim(), netMinor }, false));
    }
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    if (pathname === `${basePath}/book`) {
      if (form.get('c_dp') !== 'on') throw new HttpError(400, 'Confirm verification checkbox first.');
      const date = String(form.get('date') ?? '').trim();
      const ref = String(form.get('ref') ?? '').trim();
      const lines = /** @type {Array<{ acct: string, desc: string, debit: number, credit: number }>} */ (JSON.parse(String(form.get('linesJson') ?? '[]')));
      const postings = lines.filter((l) => l.debit > 0 || l.credit > 0).map((l, idx) => ({ accountNumber: l.acct, postingDate: date, currencyCode: 'NOK', amount: Number(((l.debit > 0 ? l.debit : -l.credit) / 100).toFixed(2)), vatCode: '0', rowNumber: idx, description: l.desc }));
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { date, description: `Foreign digital VAT ${ref} ${date}`, reviewReason: 'Reverse-charge VAT voucher imported via apps.reai.no.', postings } }));
      const url = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${url}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Ads & SaaS VAT error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
