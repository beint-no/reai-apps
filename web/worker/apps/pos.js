// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * @typedef {'z-report' | 'front-systems'} PosSlug
 * @typedef {{ account: string, description: string, debitMinor: number, creditMinor: number, vatCode: string }} PosPosting
 * @typedef {{ date: string, register: string, zNumber: string, postings: PosPosting[], totalDebitMinor: number, totalCreditMinor: number }} ZSummary
 */

/**
 * @param {number} grossMinor
 * @param {number} vatPct
 */
function splitVatMinor(grossMinor, vatPct) {
  if (vatPct <= 0 || grossMinor === 0) {
    return { netMinor: grossMinor, vatMinor: 0 };
  }
  const netMinor = Math.round((grossMinor * 100) / (100 + vatPct));
  return { netMinor, vatMinor: grossMinor - netMinor };
}

/**
 * Builds balanced double-entry POS Z-report postings from payment totals and gross sales by VAT rate.
 * @param {{ date: string, register: string, zNumber: string, cashMinor: number, cardMinor: number, vippsMinor: number, sales25Minor: number, sales15Minor: number, sales12Minor: number, sales0Minor: number, giftCardMinor: number }} input
 * @returns {ZSummary}
 */
function buildZSummary(input) {
  /** @type {PosPosting[]} */
  const postings = [];
  const label = `${input.register} Z-${input.zNumber}`;
  if (input.cashMinor > 0) {
    postings.push({ account: '1900', description: `${label} · Cash drawer`, debitMinor: input.cashMinor, creditMinor: 0, vatCode: '0' });
  }
  if (input.cardMinor > 0) {
    postings.push({ account: '1580', description: `${label} · Card terminal clearing`, debitMinor: input.cardMinor, creditMinor: 0, vatCode: '0' });
  }
  if (input.vippsMinor > 0) {
    postings.push({ account: '1580', description: `${label} · Vipps clearing`, debitMinor: input.vippsMinor, creditMinor: 0, vatCode: '0' });
  }

  let totalVatMinor = 0;
  for (const [gross, pct, acct, title] of [
    /** @type {const} */ ([input.sales25Minor, 25, '3000', 'Sales 25% VAT (net)']),
    /** @type {const} */ ([input.sales15Minor, 15, '3010', 'Food/beverage sales 15% VAT (net)']),
    /** @type {const} */ ([input.sales12Minor, 12, '3020', 'Low-rate sales 12% VAT (net)']),
    /** @type {const} */ ([input.sales0Minor, 0, '3100', 'VAT-exempt / 0% sales']),
  ]) {
    if (gross > 0) {
      const { netMinor, vatMinor } = splitVatMinor(gross, pct);
      totalVatMinor += vatMinor;
      postings.push({ account: acct, description: `${label} · ${title}`, debitMinor: 0, creditMinor: netMinor, vatCode: '0' });
    }
  }
  if (input.giftCardMinor > 0) {
    postings.push({ account: '2900', description: `${label} · Gift cards issued`, debitMinor: 0, creditMinor: input.giftCardMinor, vatCode: '0' });
  }
  if (totalVatMinor > 0) {
    postings.push({ account: '2700', description: `${label} · Output VAT payable`, debitMinor: 0, creditMinor: totalVatMinor, vatCode: '0' });
  }

  const totalDebitMinor = postings.reduce((s, p) => s + p.debitMinor, 0);
  const totalCreditMinor = postings.reduce((s, p) => s + p.creditMinor, 0);
  return { date: input.date, register: input.register, zNumber: input.zNumber, postings, totalDebitMinor, totalCreditMinor };
}

/**
 * @param {string} slug
 * @param {ZSummary} summary
 * @param {boolean} isSample
 */
function renderZPreview(slug, summary, isSample) {
  const diff = summary.totalDebitMinor - summary.totalCreditMinor;
  const balanced = diff === 0 && summary.totalDebitMinor > 0;
  return html`
    ${reaiCard({
      eyebrow: 'BALANCED DAILY Z-REPORT VOUCHER',
      title: `${summary.register} · Z-${summary.zNumber} (${summary.date})`,
      badge: balanced
        ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' })
        : reaiBadge({ text: `Out of balance by ${formatMinor(Math.abs(diff))} NOK`, tone: 'danger' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Payments (Debit)', value: `${formatMinor(summary.totalDebitMinor)} NOK`, detail: 'Cash, card terminal, Vipps' })}
          ${reaiMetric({ label: 'Sales + VAT (Credit)', value: `${formatMinor(summary.totalCreditMinor)} NOK`, detail: 'Split by Norwegian VAT rate' })}
          ${reaiMetric({ label: 'Cash difference', value: `${formatMinor(diff)} NOK`, detail: balanced ? 'Ready to book' : 'Adjust totals before booking' })}
        </div>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Description</th>
                <th class="num">Debit</th>
                <th class="num">Credit</th>
              </tr>
            </thead>
            <tbody>
              ${summary.postings.map(
                (p) => html`<tr>
                  <td class="mono">${p.account}</td>
                  <td>${p.description}</td>
                  <td class="num">${p.debitMinor > 0 ? formatMinor(p.debitMinor) : ''}</td>
                  <td class="num">${p.creditMinor > 0 ? formatMinor(p.creditMinor) : ''}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>

        ${balanced && !isSample
          ? html`<form class="stack-sm confirm-box" hx-post="/app/${slug}/book" hx-target="#pos-booking" hx-swap="innerHTML">
              <input type="hidden" name="summaryJson" value="${JSON.stringify(summary)}">
              <label class="check-row"><input type="checkbox" name="c_zreport" required> I verified these totals against the official Z-report from the cash register and will attach the PDF/receipt in ReAI.</label>
              <div>
                <button type="submit" class="button primary">Create review voucher in ReAI</button>
              </div>
            </form>
            <div id="pos-booking" class="stack-sm"></div>`
          : isSample
            ? reaiCallout({ tone: 'info', body: 'Sample preview loaded. Enter your real Z-report figures or API key above and connect to ReAI to create the review voucher.' })
            : ''}
      `,
    })}
  `;
}

/**
 * Fetches daily sales summary from Front Systems API v2.
 * @param {string} apiKey
 * @param {string} date
 * @returns {Promise<ZSummary>}
 */
async function fetchFrontSystemsDay(apiKey, date) {
  const url = new URL('https://api.frontsystems.no/v2/Sales');
  url.searchParams.set('fromDate', `${date}T00:00:00Z`);
  url.searchParams.set('toDate', `${date}T23:59:59Z`);
  const res = await fetch(url, {
    headers: { 'x-api-key': apiKey, accept: 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    throw new HttpError(
      400,
      res.status === 401 || res.status === 403
        ? 'Front Systems rejected this X-API-Key.'
        : `Front Systems API returned HTTP ${res.status}.`,
    );
  }
  const sales = /** @type {Array<any>} */ (await res.json());
  let cashMinor = 0;
  let cardMinor = 0;
  let vippsMinor = 0;
  let sales25Minor = 0;
  let sales15Minor = 0;
  let sales12Minor = 0;
  let sales0Minor = 0;
  for (const s of Array.isArray(sales) ? sales : []) {
    const payments = Array.isArray(s.payments) ? s.payments : [];
    for (const p of payments) {
      const m = Math.round(Number(p.amount ?? 0) * 100);
      const t = String(p.paymentType ?? p.name ?? '').toLowerCase();
      if (t.includes('cash') || t.includes('kontant')) {
        cashMinor += m;
      } else if (t.includes('vipps')) {
        vippsMinor += m;
      } else {
        cardMinor += m;
      }
    }
    const lines = Array.isArray(s.saleLines) ? s.saleLines : [];
    for (const l of lines) {
      const m = Math.round(Number(l.price ?? l.total ?? 0) * 100);
      const vat = Number(l.vatPercent ?? 25);
      if (vat >= 24) {
        sales25Minor += m;
      } else if (vat >= 14) {
        sales15Minor += m;
      } else if (vat >= 11) {
        sales12Minor += m;
      } else {
        sales0Minor += m;
      }
    }
  }
  return buildZSummary({
    date,
    register: 'Front Systems Store',
    zNumber: date.replace(/-/g, ''),
    cashMinor,
    cardMinor,
    vippsMinor,
    sales25Minor,
    sales15Minor,
    sales12Minor,
    sales0Minor,
    giftCardMinor: 0,
  });
}

/**
 * Handles /app/z-report/* and /app/front-systems/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @param {PosSlug} slug
 * @returns {Promise<Response>}
 */
export async function handlePos(request, env, slug) {
  const { pathname } = new URL(request.url);
  const basePath = `/app/${slug}`;
  const isFront = slug === 'front-systems';
  const title = isFront ? 'Front Systems POS' : 'POS Daily Z-Report (Dagsoppgjør)';
  const lead = isFront
    ? 'Pull daily retail store sales from Front Systems API v2, verify VAT and payment splits, and post a balanced review voucher in ReAI.'
    : 'Turn any Norwegian cash register Z-report (Amendo, Baemingo, Mystore POS, Kassasystem) into a balanced ReAI review voucher with automatic 25%/15%/12%/0% VAT splitting.';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  }

  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const today = new Date().toISOString().slice(0, 10);
    const body = html`
      <section class="app-intro">
        <p class="eyebrow">POS & RETAIL · KASSEOPPGJØR</p>
        <h1>${title}</h1>
        <p class="lead">${lead}</p>
      </section>

      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${slug}-web`, clientName: `ReAI ${title} (Web)` })}

        ${isFront
          ? reaiCard({
              eyebrow: 'FRONT SYSTEMS API V2',
              title: 'Fetch daily store sales',
              body: html`
                <p class="muted-note">Paste your Front Systems API key (<code>X-API-Key</code>). Used only for this single HTTPS request and never stored.</p>
                <form class="stack" hx-post="${basePath}/preview" hx-target="#pos-output" hx-swap="innerHTML">
                  <div class="inline-row">
                    <div class="field">
                      <label for="fs-key">Front Systems API key</label>
                      <input id="fs-key" name="apiKey" type="password" autocomplete="off" required placeholder="Front Systems X-API-Key">
                    </div>
                    <div class="field">
                      <label for="fs-date">Sales date</label>
                      <input id="fs-date" name="date" type="date" value="${today}" required>
                    </div>
                  </div>
                  <div class="inline-row">
                    <button type="submit" class="button primary">Fetch daily Z-report</button>
                    <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#pos-output" hx-swap="innerHTML">Load sample day</button>
                  </div>
                </form>
              `,
            })
          : reaiCard({
              eyebrow: 'DAILY Z-REPORT ENTRY',
              title: 'Enter Z-report totals (incl. VAT)',
              body: html`
                <form class="stack" hx-post="${basePath}/preview" hx-target="#pos-output" hx-swap="innerHTML">
                  <div class="mapping-grid">
                    <div class="field"><label for="z-date">Date</label><input id="z-date" name="date" type="date" value="${today}" required></div>
                    <div class="field"><label for="z-reg">Register / POS name</label><input id="z-reg" name="register" type="text" value="Kasse 1" required></div>
                    <div class="field"><label for="z-num">Z-report number</label><input id="z-num" name="zNumber" type="text" placeholder="1042" required></div>
                    <div class="field"><label for="z-cash">Cash received (1900)</label><input id="z-cash" name="cash" type="number" step="0.01" min="0" value="0"></div>
                    <div class="field"><label for="z-card">Card terminal (1580)</label><input id="z-card" name="card" type="number" step="0.01" min="0" value="0"></div>
                    <div class="field"><label for="z-vipps">Vipps (1580)</label><input id="z-vipps" name="vipps" type="number" step="0.01" min="0" value="0"></div>
                    <div class="field"><label for="z-s25">Gross sales 25% VAT (3000)</label><input id="z-s25" name="sales25" type="number" step="0.01" min="0" value="0"></div>
                    <div class="field"><label for="z-s15">Gross sales 15% food VAT (3010)</label><input id="z-s15" name="sales15" type="number" step="0.01" min="0" value="0"></div>
                    <div class="field"><label for="z-s12">Gross sales 12% VAT (3020)</label><input id="z-s12" name="sales12" type="number" step="0.01" min="0" value="0"></div>
                    <div class="field"><label for="z-s0">VAT-exempt sales 0% (3100)</label><input id="z-s0" name="sales0" type="number" step="0.01" min="0" value="0"></div>
                    <div class="field"><label for="z-gift">Gift cards sold (2900)</label><input id="z-gift" name="giftCard" type="number" step="0.01" min="0" value="0"></div>
                  </div>
                  <div class="inline-row">
                    <button type="submit" class="button primary">Preview balanced voucher</button>
                    <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#pos-output" hx-swap="innerHTML">Load sample Z-report</button>
                  </div>
                </form>
              `,
            })}

        <div id="pos-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') {
    return errorResponse('Method not allowed.', 405);
  }
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  if (pathname === `${basePath}/sample`) {
    const summary = buildZSummary({
      date: '2026-10-24',
      register: isFront ? 'Front Systems Flagship Oslo' : 'Kasse 1 · Hovedbutikk',
      zNumber: '1042',
      cashMinor: 245000,
      cardMinor: 1895000,
      vippsMinor: 610000,
      sales25Minor: 2150000,
      sales15Minor: 450000,
      sales12Minor: 0,
      sales0Minor: 50000,
      giftCardMinor: 100000,
    });
    return htmlResponse(renderZPreview(slug, summary, true));
  }

  try {
    const form = await request.formData();

    if (pathname === `${basePath}/preview`) {
      if (isFront) {
        const apiKey = String(form.get('apiKey') ?? '').trim();
        const date = String(form.get('date') ?? '').trim();
        if (!apiKey || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
          throw new HttpError(400, 'Enter a Front Systems API key and valid date.');
        }
        const summary = await fetchFrontSystemsDay(apiKey, date);
        return htmlResponse(renderZPreview(slug, summary, false));
      }
      /** @param {string} k */
      const minor = (k) => Math.round(Math.max(0, Number(form.get(k) ?? '0') || 0) * 100);
      const date = String(form.get('date') ?? '').trim();
      const register = String(form.get('register') ?? 'Kasse 1').trim().slice(0, 60);
      const zNumber = String(form.get('zNumber') ?? '').trim().slice(0, 40);
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !zNumber) {
        throw new HttpError(400, 'Enter a valid date and Z-report number.');
      }
      const summary = buildZSummary({
        date,
        register,
        zNumber,
        cashMinor: minor('cash'),
        cardMinor: minor('card'),
        vippsMinor: minor('vipps'),
        sales25Minor: minor('sales25'),
        sales15Minor: minor('sales15'),
        sales12Minor: minor('sales12'),
        sales0Minor: minor('sales0'),
        giftCardMinor: minor('giftCard'),
      });
      return htmlResponse(renderZPreview(slug, summary, false));
    }

    if (pathname === `${basePath}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) {
        throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      }
      if (form.get('c_zreport') !== 'on') {
        throw new HttpError(400, 'Confirm the Z-report verification checkbox first.');
      }
      const summary = /** @type {ZSummary} */ (JSON.parse(String(form.get('summaryJson') ?? '{}')));
      if (!summary.postings?.length || summary.totalDebitMinor !== summary.totalCreditMinor || summary.totalDebitMinor <= 0) {
        throw new HttpError(400, 'Z-report voucher must be balanced and non-zero.');
      }
      const marker = `POS Z-report ${summary.register} Z-${summary.zNumber} ${summary.date}`;
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (
        await reaiAll(env, '/api/vouchers', {
          token: session.accessToken,
          tenantId: session.tenantId,
          query: { startDate: summary.date, endDate: summary.date, includeReversed: 'true' },
        })
      );
      const dup = existing.find((v) => typeof v.description === 'string' && v.description.startsWith(marker));
      if (dup) {
        const url = `${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}`;
        return htmlResponse(
          reaiCallout({
            tone: 'warn',
            title: `Already booked (${dup.number})`,
            body: html`A voucher for this Z-report already exists: <a href="${url}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.`,
          }),
        );
      }

      const postings = summary.postings.map((p, idx) => ({
        accountNumber: p.account,
        postingDate: summary.date,
        currencyCode: 'NOK',
        amount: Number(((p.debitMinor - p.creditMinor) / 100).toFixed(2)),
        vatCode: p.vatCode,
        rowNumber: idx,
        description: p.description,
      }));

      const created = /** @type {{ id: number, number: string }} */ (
        await reaiRequest(env, '/api/manual-vouchers', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: {
            date: summary.date,
            description: marker,
            reviewReason: 'Daily POS Z-report imported via apps.reai.no. Attach the original register Z-report PDF before clearing review.',
            postings,
          },
        })
      );
      const url = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(
        reaiCallout({
          tone: 'success',
          title: `Created review voucher ${created.number}`,
          body: html`Open in ReAI to attach your Z-report PDF and approve: <a href="${url}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.`,
        }),
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'POS operation failed.';
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'POS sync error', body: msg }));
  }

  return errorResponse('Unknown POS route.', 404);
}
