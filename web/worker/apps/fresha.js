// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard } from '../lib/ui.js';

const SAMPLE = {"date": "2026-10-31", "ref": "FRS-2026-10", "gross25Minor": 9450000, "exemptMinor": 0, "feeMinor": 236000};

/** @param {{ date: string, ref: string, gross25Minor: number, exemptMinor: number, feeMinor: number }} s @param {boolean} isSample */
function renderVoucherPreview(s, isSample) {
  const net25 = Math.round((s.gross25Minor * 100) / 125);
  const vat25 = s.gross25Minor - net25;
  const netClearing = s.gross25Minor + s.exemptMinor - s.feeMinor;
  /** @type {Array<{ acct: string, desc: string, debit: number, credit: number }>} */
  const lines = [{ acct: '1580', desc: 'Fresha net settlement clearing', debit: netClearing, credit: 0 }];
  if (s.feeMinor > 0) lines.push({ acct: '7770', desc: 'Fresha platform / management fee', debit: s.feeMinor, credit: 0 });
  if (net25 > 0) lines.push({ acct: '3000', desc: 'Fresha 25% taxable revenue net', debit: 0, credit: net25 });
  if (vat25 > 0) lines.push({ acct: '2700', desc: 'Output VAT 25%', debit: 0, credit: vat25 });
  if (s.exemptMinor > 0) lines.push({ acct: '3100', desc: 'Fresha 0% VAT-exempt revenue', debit: 0, credit: s.exemptMinor });

  return reaiCard({
    eyebrow: 'FRESHA VOUCHER PREVIEW',
    title: `${s.ref} · ${s.date}`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }),
    body: html`
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${lines.map((l) => html`<tr><td class="mono">${l.acct}</td><td>${l.desc}</td><td class="num">${l.debit ? formatMinor(l.debit) : ''}</td><td class="num">${l.credit ? formatMinor(l.credit) : ''}</td></tr>`)}</tbody>
      </table></div>
      ${!isSample
        ? html`<form class="stack-sm confirm-box" hx-post="/app/fresha/book" hx-target="#dp-booking" hx-swap="innerHTML">
            <input type="hidden" name="date" value="${s.date}"><input type="hidden" name="ref" value="${s.ref}"><input type="hidden" name="linesJson" value="${JSON.stringify(lines)}">
            <label class="check-row"><input type="checkbox" name="c_dp" required> I verified these figures against the source statement from Fresha.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="dp-booking" class="stack-sm"></div>`
        : reaiCallout({ tone: 'info', body: 'Synthetic Fresha preview loaded. Enter your real totals above and connect to ReAI to book.' })}
    `,
  });
}

/**
 * Handles /app/fresha/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/fresha';
  const title = "Fresha Salon Payout Reconciliation";
  const lead = "Book Fresha salon & barbershop payouts into ReAI separating 25% taxable treatments & retail (3000 + 2700), optional 0% exempt wellness (3100), Fresha fees (7770) and net payout (1580).";

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro"><p class="eyebrow">SALON, BARBERSHOP & BEAUTY POS</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-fresha-web', clientName: 'ReAI Fresha (Web)' })}
        ${reaiCard({
          eyebrow: 'FRESHA SETTLEMENT',
          title: 'Enter period totals (NOK)',
          body: html`<form class="stack" hx-post="${basePath}/preview" hx-target="#dp-output" hx-swap="innerHTML">
            <div class="mapping-grid">
              <div class="field"><label for="dp-d">Date</label><input id="dp-d" name="date" type="date" value="${today}" required></div>
              <div class="field"><label for="dp-r">Reference</label><input id="dp-r" name="ref" type="text" placeholder="FRS-2026-10" required></div>
              <div class="field"><label for="dp-25">Gross 25% taxable (3000)</label><input id="dp-25" name="gross25" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="dp-0">0% VAT-exempt (3100)</label><input id="dp-0" name="exempt" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="dp-f">Platform / management fee (7770)</label><input id="dp-f" name="fee" type="number" step="0.01" min="0" value="0"></div>
            </div>
            <div class="inline-row"><button type="submit" class="button primary">Preview balanced voucher</button><button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#dp-output" hx-swap="innerHTML">Load sample report</button></div>
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
  if (pathname === `${basePath}/sample`) return htmlResponse(renderVoucherPreview(SAMPLE, true));

  try {
    const form = await request.formData();
    if (pathname === `${basePath}/preview`) {
      /** @param {string} k */
      const m = (k) => Math.round(Math.max(0, Number(form.get(k) ?? '0') || 0) * 100);
      const date = String(form.get('date') ?? '').trim();
      const ref = String(form.get('ref') ?? '').trim().slice(0, 60);
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !ref) throw new HttpError(400, 'Enter valid date and reference.');
      return htmlResponse(renderVoucherPreview({ date, ref, gross25Minor: m('gross25'), exemptMinor: m('exempt'), feeMinor: m('fee') }, false));
    }
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    if (pathname === `${basePath}/book`) {
      if (form.get('c_dp') !== 'on') throw new HttpError(400, 'Confirm verification checkbox first.');
      const date = String(form.get('date') ?? '').trim();
      const ref = String(form.get('ref') ?? '').trim();
      const lines = /** @type {Array<{ acct: string, desc: string, debit: number, credit: number }>} */ (JSON.parse(String(form.get('linesJson') ?? '[]')));
      const postings = lines.filter((l) => l.debit > 0 || l.credit > 0).map((l, idx) => ({ accountNumber: l.acct, postingDate: date, currencyCode: 'NOK', amount: Number(((l.debit > 0 ? l.debit : -l.credit) / 100).toFixed(2)), vatCode: '0', rowNumber: idx, description: l.desc }));
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { date, description: `Fresha ${ref} ${date}`, reviewReason: 'Imported from Fresha via apps.reai.no.', postings } }));
      const url = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${url}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Fresha error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown app route.', 404);
}
