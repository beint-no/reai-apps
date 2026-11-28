// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard } from '../lib/ui.js';

const SAMPLE = { date: '2026-10-31', ref: 'AUTOPASS-2026-10', tollMinor: 482000, parkingGross25Minor: 312500 };

/** @param {{ date: string, ref: string, tollMinor: number, parkingGross25Minor: number }} s @param {boolean} isSample */
function renderPreview(s, isSample) {
  const parkNet = Math.round((s.parkingGross25Minor * 100) / 125);
  const parkVat = s.parkingGross25Minor - parkNet;
  const total = s.tollMinor + s.parkingGross25Minor;
  /** @type {Array<{ acct: string, desc: string, debit: number, credit: number }>} */
  const lines = [];
  if (s.tollMinor > 0) lines.push({ acct: '7080', desc: 'AutoPASS / Fremtind road tolls (0% VAT)', debit: s.tollMinor, credit: 0 });
  if (parkNet > 0) lines.push({ acct: '7140', desc: 'EasyPark fleet parking net (25% VAT)', debit: parkNet, credit: 0 });
  if (parkVat > 0) lines.push({ acct: '2710', desc: 'Input VAT 25% on parking', debit: parkVat, credit: 0 });
  lines.push({ acct: '2400', desc: 'AutoPASS / EasyPark invoice payable', debit: 0, credit: total });

  return reaiCard({
    eyebrow: 'AUTOPASS & EASYPARK VOUCHER PREVIEW',
    title: `${s.ref} · ${s.date}`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }),
    body: html`
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>Description</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${lines.map((l) => html`<tr><td class="mono">${l.acct}</td><td>${l.desc}</td><td class="num">${l.debit ? formatMinor(l.debit) : ''}</td><td class="num">${l.credit ? formatMinor(l.credit) : ''}</td></tr>`)}</tbody>
      </table></div>
      ${!isSample
        ? html`<form class="stack-sm confirm-box" hx-post="/app/autopass/book" hx-target="#dp-booking" hx-swap="innerHTML">
            <input type="hidden" name="date" value="${s.date}"><input type="hidden" name="ref" value="${s.ref}"><input type="hidden" name="linesJson" value="${JSON.stringify(lines)}">
            <label class="check-row"><input type="checkbox" name="c_dp" required> I verified these figures against the AutoPASS / EasyPark statement.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="dp-booking" class="stack-sm"></div>`
        : reaiCallout({ tone: 'info', body: 'Synthetic AutoPASS / EasyPark preview loaded. Enter your real totals above and connect to ReAI to book.' })}
    `,
  });
}

/**
 * Handles /app/autopass/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/autopass';
  const title = 'AutoPASS / Fremtind Tolls & EasyPark Expenses';
  const lead = 'Book Norwegian fleet road tolls (bompassering, 0% VAT account 7080) and EasyPark corporate parking (25% VAT account 7140) straight into ReAI review vouchers.';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro"><p class="eyebrow">NORWEGIAN FLEET TOLLS & PARKING</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-autopass-web', clientName: 'ReAI AutoPASS & EasyPark (Web)' })}
        ${reaiCard({
          eyebrow: 'AUTOPASS & EASYPARK STATEMENT',
          title: 'Enter monthly tolls (0%) and parking (25%)',
          body: html`<form class="stack" hx-post="${basePath}/preview" hx-target="#dp-output" hx-swap="innerHTML">
            <div class="mapping-grid">
              <div class="field"><label for="dp-d">Date</label><input id="dp-d" name="date" type="date" value="${today}" required></div>
              <div class="field"><label for="dp-r">Invoice ref</label><input id="dp-r" name="ref" type="text" placeholder="AUTOPASS-2026-10" required></div>
              <div class="field"><label for="dp-t">AutoPASS road tolls 0% (7080)</label><input id="dp-t" name="toll" type="number" step="0.01" min="0" value="0"></div>
              <div class="field"><label for="dp-p">EasyPark parking incl. 25% VAT (7140)</label><input id="dp-p" name="parking" type="number" step="0.01" min="0" value="0"></div>
            </div>
            <div class="inline-row"><button type="submit" class="button primary">Preview balanced voucher</button><button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#dp-output" hx-swap="innerHTML">Load sample statement</button></div>
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
      /** @param {string} k */
      const m = (k) => Math.round(Math.max(0, Number(form.get(k) ?? '0') || 0) * 100);
      const date = String(form.get('date') ?? '').trim();
      const ref = String(form.get('ref') ?? '').trim().slice(0, 60);
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !ref) throw new HttpError(400, 'Enter valid date and reference.');
      return htmlResponse(renderPreview({ date, ref, tollMinor: m('toll'), parkingGross25Minor: m('parking') }, false));
    }
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    if (pathname === `${basePath}/book`) {
      if (form.get('c_dp') !== 'on') throw new HttpError(400, 'Confirm verification checkbox first.');
      const date = String(form.get('date') ?? '').trim();
      const ref = String(form.get('ref') ?? '').trim();
      const lines = /** @type {Array<{ acct: string, desc: string, debit: number, credit: number }>} */ (JSON.parse(String(form.get('linesJson') ?? '[]')));
      const postings = lines.filter((l) => l.debit > 0 || l.credit > 0).map((l, idx) => ({ accountNumber: l.acct, postingDate: date, currencyCode: 'NOK', amount: Number(((l.debit > 0 ? l.debit : -l.credit) / 100).toFixed(2)), vatCode: '0', rowNumber: idx, description: l.desc }));
      const created = /** @type {{ id: number, number: string }} */ (await reaiRequest(env, '/api/manual-vouchers', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { date, description: `AutoPASS & EasyPark ${ref} ${date}`, reviewReason: 'Imported from AutoPASS/EasyPark via apps.reai.no.', postings } }));
      const url = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${url}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'AutoPASS error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
