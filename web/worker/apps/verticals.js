// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * @typedef {'opus-dental' | 'ongoing-wms'} VerticalSlug
 * @typedef {{ date: string, ref: string, cardMinor: number, cashMinor: number, helfoMinor: number, dentalExemptMinor: number, retail25Minor: number }} DentalSummary
 */

/**
 * @param {DentalSummary} d
 * @param {boolean} isSample
 */
function renderDentalPreview(d, isSample) {
  const retailNet = Math.round((d.retail25Minor * 100) / 125);
  const retailVat = d.retail25Minor - retailNet;
  const debit = d.cardMinor + d.cashMinor + d.helfoMinor;
  const credit = d.dentalExemptMinor + retailNet + retailVat;
  const diff = debit - credit;
  const balanced = diff === 0 && debit > 0;

  return html`
    ${reaiCard({
      eyebrow: 'OPUS DENTAL KASSADAGBOK → REAI VOUCHER',
      title: `${d.ref} · ${d.date}`,
      badge: balanced ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }) : reaiBadge({ text: `Diff ${formatMinor(diff)} NOK`, tone: 'danger' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Patient + HELFO (Debit)', value: `${formatMinor(debit)} NOK`, detail: `HELFO claim ${formatMinor(d.helfoMinor)} on 1570` })}
          ${reaiMetric({ label: 'Exempt dental (3100)', value: `${formatMinor(d.dentalExemptMinor)} NOK`, detail: '0% VAT (mval. § 3-2)' })}
          ${reaiMetric({ label: '25% retail products', value: `${formatMinor(d.retail25Minor)} NOK`, detail: `Net ${formatMinor(retailNet)} + VAT ${formatMinor(retailVat)}` })}
        </div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Account</th><th>Posting</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
          <tbody>
            ${d.cardMinor > 0 ? html`<tr><td class="mono">1580</td><td>Opus Dental · Patient card / Vipps clearing</td><td class="num">${formatMinor(d.cardMinor)}</td><td class="num"></td></tr>` : ''}
            ${d.cashMinor > 0 ? html`<tr><td class="mono">1900</td><td>Opus Dental · Cash receipts</td><td class="num">${formatMinor(d.cashMinor)}</td><td class="num"></td></tr>` : ''}
            ${d.helfoMinor > 0 ? html`<tr><td class="mono">1570</td><td>HELFO reimbursement receivable</td><td class="num">${formatMinor(d.helfoMinor)}</td><td class="num"></td></tr>` : ''}
            ${d.dentalExemptMinor > 0 ? html`<tr><td class="mono">3100</td><td>VAT-exempt dental treatment revenue (0%)</td><td class="num"></td><td class="num">${formatMinor(d.dentalExemptMinor)}</td></tr>` : ''}
            ${retailNet > 0 ? html`<tr><td class="mono">3000</td><td>Dental care retail products 25% (net)</td><td class="num"></td><td class="num">${formatMinor(retailNet)}</td></tr>` : ''}
            ${retailVat > 0 ? html`<tr><td class="mono">2700</td><td>Output VAT 25% payable</td><td class="num"></td><td class="num">${formatMinor(retailVat)}</td></tr>` : ''}
          </tbody>
        </table></div>
        ${balanced && !isSample
          ? html`<form class="stack-sm confirm-box" hx-post="/app/opus-dental/book" hx-target="#op-booking" hx-swap="innerHTML">
              <input type="hidden" name="dentalJson" value="${JSON.stringify(d)}">
              <label class="check-row"><input type="checkbox" name="c_opus" required> I verified this cashbook summary against Opus Dental and will attach the daily report in ReAI.</label>
              <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
            </form><div id="op-booking" class="stack-sm"></div>`
          : isSample
            ? reaiCallout({ tone: 'info', body: 'Synthetic Opus Dental cashbook loaded. Enter your real daily totals above and connect to ReAI to book.' })
            : ''}
      `,
    })}
  `;
}

/**
 * Handles /app/opus-dental/* and /app/ongoing-wms/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @param {VerticalSlug} slug
 * @returns {Promise<Response>}
 */
export async function handleVerticals(request, env, slug) {
  const { pathname } = new URL(request.url);
  const basePath = `/app/${slug}`;
  const isOpus = slug === 'opus-dental';
  const title = isOpus ? 'Opus Dental Clinic Accounting' : 'Ongoing WMS Warehouse Sync';
  const lead = isOpus
    ? 'Book daily Opus Dental clinic cashbooks (kassadagbok) into ReAI separating patient payments (1580), HELFO claims (1570), VAT-exempt treatments (3100) and 25% retail products (3000).'
    : 'Sync Ongoing WMS 3PL warehouse articles into ReAI Products by SKU and verify stock & order fulfillment across Nordic warehouses.';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  }
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro">
        <p class="eyebrow">${isOpus ? 'DENTAL & HEALTHCARE CLINICS' : '3PL WAREHOUSE & LOGISTICS (WMS)'}</p>
        <h1>${title}</h1>
        <p class="lead">${lead}</p>
      </section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${slug}-web`, clientName: `ReAI ${title} (Web)` })}
        ${isOpus
          ? reaiCard({
              eyebrow: 'OPUS DENTAL KASSADAGBOK',
              title: 'Enter daily dental cashbook & HELFO totals (NOK)',
              body: html`
                <form class="stack" hx-post="/app/opus-dental/preview" hx-target="#vt-output" hx-swap="innerHTML">
                  <div class="mapping-grid">
                    <div class="field"><label for="op-date">Date</label><input id="op-date" name="date" type="date" value="${today}" required></div>
                    <div class="field"><label for="op-ref">Cashbook / Day ref</label><input id="op-ref" name="ref" type="text" placeholder="OPUS-2026-1024" required></div>
                    <div class="field"><label for="op-card">Patient card / Vipps (1580)</label><input id="op-card" name="card" type="number" step="0.01" min="0" value="0"></div>
                    <div class="field"><label for="op-cash">Patient cash (1900)</label><input id="op-cash" name="cash" type="number" step="0.01" min="0" value="0"></div>
                    <div class="field"><label for="op-helfo">HELFO reimbursement claim (1570)</label><input id="op-helfo" name="helfo" type="number" step="0.01" min="0" value="0"></div>
                    <div class="field"><label for="op-dent">Exempt dental treatments 0% (3100)</label><input id="op-dent" name="dental" type="number" step="0.01" min="0" value="0"></div>
                    <div class="field"><label for="op-ret">Gross 25% dental products (3000)</label><input id="op-ret" name="retail" type="number" step="0.01" min="0" value="0"></div>
                  </div>
                  <div class="inline-row">
                    <button type="submit" class="button primary">Preview balanced voucher</button>
                    <button type="button" class="button secondary" hx-post="/app/opus-dental/sample" hx-target="#vt-output" hx-swap="innerHTML">Load sample cashbook</button>
                  </div>
                </form>
              `,
            })
          : reaiCard({
              eyebrow: 'ONGOING WMS REST API',
              title: 'Scan Ongoing WMS warehouse articles',
              body: html`
                <p class="muted-note">Connect your Ongoing WMS REST API credentials (used only for this request, never stored) to diff warehouse SKUs against ReAI Products.</p>
                <form class="stack" hx-post="/app/ongoing-wms/scan" hx-target="#vt-output" hx-swap="innerHTML">
                  <div class="mapping-grid">
                    <div class="field"><label for="og-base">Ongoing WMS API URL</label><input id="og-base" name="baseUrl" type="url" required placeholder="https://api.ongoingsystems.se/warehouse/api/v1"></div>
                    <div class="field"><label for="og-owner">Goods Owner ID</label><input id="og-owner" name="goodsOwnerId" type="number" min="1" required placeholder="42"></div>
                    <div class="field"><label for="og-user">API Username</label><input id="og-user" name="username" type="text" required placeholder="WSI user"></div>
                    <div class="field"><label for="og-pass">API Password</label><input id="og-pass" name="password" type="password" autocomplete="off" required placeholder="WSI password"></div>
                  </div>
                  <div class="inline-row">
                    <button type="submit" class="button primary">Scan Ongoing WMS SKUs</button>
                    <button type="button" class="button secondary" hx-post="/app/ongoing-wms/sample" hx-target="#vt-output" hx-swap="innerHTML">Load sample warehouse</button>
                  </div>
                </form>
              `,
            })}
        <div id="vt-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  /**
   * @param {Array<{ sku: string, name: string, price: number, stock: number, exists: boolean }>} articles
   * @param {boolean} isSample
   */
  const renderWms = (articles, isSample) =>
    reaiCard({
      eyebrow: 'ONGOING WMS → REAI PRODUCTS',
      title: `${articles.length} warehouse articles scanned`,
      badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${articles.filter((a) => !a.exists).length} new SKUs`, tone: 'success' }),
      body: html`<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Article / SKU</th><th>Name</th><th class="num">3PL Stock</th><th class="num">Price (NOK)</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>${articles.map(
          (a, idx) => html`<tr id="og-row-${idx}">
            <td class="mono">${a.sku}</td>
            <td><strong>${a.name}</strong></td>
            <td class="num">${a.stock}</td>
            <td class="num">${formatMinor(Math.round(a.price * 100))}</td>
            <td>${a.exists ? reaiBadge({ text: 'In ReAI', tone: 'neutral' }) : reaiBadge({ text: 'New SKU', tone: 'success' })}</td>
            <td>${a.exists || isSample
              ? html`<span class="muted-note">${isSample && !a.exists ? 'Demo only' : 'Synced'}</span>`
              : html`<form hx-post="/app/ongoing-wms/sync-article" hx-target="#og-row-${idx}" hx-swap="outerHTML">
                  <input type="hidden" name="sku" value="${a.sku}">
                  <input type="hidden" name="name" value="${a.name}">
                  <input type="hidden" name="price" value="${a.price.toFixed(2)}">
                  <button type="submit" class="button primary">Create in ReAI</button>
                </form>`}</td>
          </tr>`,
        )}</tbody>
      </table></div>`,
    });

  if (pathname === `${basePath}/sample`) {
    if (isOpus) {
      return htmlResponse(renderDentalPreview({ date: '2026-10-24', ref: 'OPUS-2026-1024', cardMinor: 2840000, cashMinor: 185000, helfoMinor: 1120000, dentalExemptMinor: 3920000, retail25Minor: 225000 }, true));
    }
    return htmlResponse(
      renderWms(
        [
          { sku: 'OG-1001', name: 'Nordic Wool Beanie (Black)', price: 399, stock: 148, exists: true },
          { sku: 'OG-1002', name: 'Alpine Insulated Flask 1L', price: 549, stock: 64, exists: false },
          { sku: 'OG-1003', name: 'Waterproof Trail Pack 28L', price: 1490, stock: 22, exists: false },
        ],
        true,
      ),
    );
  }

  try {
    const form = await request.formData();

    if (isOpus && pathname === '/app/opus-dental/preview') {
      /** @param {string} k */
      const m = (k) => Math.round(Math.max(0, Number(form.get(k) ?? '0') || 0) * 100);
      const date = String(form.get('date') ?? '').trim();
      const ref = String(form.get('ref') ?? '').trim().slice(0, 60);
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !ref) throw new HttpError(400, 'Enter a valid date and reference.');
      return htmlResponse(renderDentalPreview({ date, ref, cardMinor: m('card'), cashMinor: m('cash'), helfoMinor: m('helfo'), dentalExemptMinor: m('dental'), retail25Minor: m('retail') }, false));
    }

    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');

    if (isOpus && pathname === '/app/opus-dental/book') {
      if (form.get('c_opus') !== 'on') throw new HttpError(400, 'Confirm the verification checkbox first.');
      const d = /** @type {DentalSummary} */ (JSON.parse(String(form.get('dentalJson') ?? '{}')));
      const retailNet = Math.round((d.retail25Minor * 100) / 125);
      const retailVat = d.retail25Minor - retailNet;
      if (d.cardMinor + d.cashMinor + d.helfoMinor !== d.dentalExemptMinor + retailNet + retailVat) {
        throw new HttpError(400, 'Cashbook must balance to 0.00.');
      }
      const marker = `Opus Dental ${d.ref} ${d.date}`;
      /** @type {Array<Record<string, unknown>>} */
      const postings = [];
      let idx = 0;
      const push = (/** @type {string} */ acct, /** @type {number} */ minor, /** @type {string} */ desc) => {
        if (minor === 0) return;
        postings.push({ accountNumber: acct, postingDate: d.date, currencyCode: 'NOK', amount: Number((minor / 100).toFixed(2)), vatCode: '0', rowNumber: idx++, description: desc });
      };
      push('1580', d.cardMinor, 'Opus Dental · Patient card/Vipps');
      push('1900', d.cashMinor, 'Opus Dental · Cash');
      push('1570', d.helfoMinor, 'Opus Dental · HELFO claim');
      push('3100', -d.dentalExemptMinor, 'Opus Dental · Exempt dental treatments');
      push('3000', -retailNet, 'Opus Dental · Dental retail 25% net');
      push('2700', -retailVat, 'Opus Dental · Output VAT 25%');

      const created = /** @type {{ id: number, number: string }} */ (
        await reaiRequest(env, '/api/manual-vouchers', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: { date: d.date, description: marker, reviewReason: 'Opus Dental daily cashbook imported via apps.reai.no. Attach Opus report PDF before clearing review.', postings },
        })
      );
      const url = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${url}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }

    if (!isOpus && pathname === '/app/ongoing-wms/scan') {
      const rawUrl = String(form.get('baseUrl') ?? '').trim();
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'https:' || parsed.hostname === 'localhost') throw new HttpError(400, 'Use a public https:// Ongoing WMS API URL.');
      const goodsOwnerId = Number(form.get('goodsOwnerId') ?? '0');
      const auth = btoa(`${String(form.get('username') ?? '')}:${String(form.get('password') ?? '')}`);
      const url = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}/articles?goodsOwnerId=${goodsOwnerId}&maxArticlesToGet=50`;
      const [wRes, pRaw] = await Promise.all([
        fetch(url, { headers: { authorization: `Basic ${auth}`, accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(20_000) }),
        reaiAll(env, '/api/products', { token: session.accessToken, tenantId: session.tenantId }),
      ]);
      if (!wRes.ok) throw new HttpError(400, `Ongoing WMS returned HTTP ${wRes.status}. Verify Goods Owner ID and credentials.`);
      const wItems = /** @type {Array<any>} */ (await wRes.json());
      const skus = new Set();
      for (const p of /** @type {Array<{ variants?: Array<{ sku?: string | null }> }>} */ (pRaw)) {
        for (const v of p.variants ?? []) {
          if (v.sku) skus.add(v.sku.trim().toLowerCase());
        }
      }
      const articles = (Array.isArray(wItems) ? wItems : []).map((a) => ({
        sku: String(a.articleNumber ?? a.articleSystemId ?? '').trim(),
        name: String(a.articleName ?? a.articleNumber ?? 'Article').trim(),
        price: Number(a.price ?? 0),
        stock: Number(a.inventoryInfo?.numberOfItems ?? 0),
        exists: Boolean(a.articleNumber && skus.has(String(a.articleNumber).trim().toLowerCase())),
      }));
      return htmlResponse(renderWms(articles, false));
    }

    if (!isOpus && pathname === '/app/ongoing-wms/sync-article') {
      const sku = String(form.get('sku') ?? '').trim();
      const name = String(form.get('name') ?? '').trim();
      const price = Number(form.get('price') ?? '0');
      const created = /** @type {{ id: number }} */ (
        await reaiRequest(env, '/api/products', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: { title: name, stockItem: true, variants: [{ sku, sellingPrice: price >= 0 ? price : 0 }] },
        })
      );
      return htmlResponse(html`<tr><td class="mono">${sku}</td><td><strong>${name}</strong></td><td class="num">—</td><td class="num">${formatMinor(Math.round(price * 100))}</td><td>${reaiBadge({ text: `Created #${created.id}`, tone: 'success' })}</td><td><span class="muted-note">Synced</span></td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${title} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }

  return errorResponse('Unknown vertical route.', 404);
}
