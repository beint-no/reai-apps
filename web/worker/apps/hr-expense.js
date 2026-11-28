// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';

/**
 * @typedef {'simployer' | 'acubiz' | 'quinyx' | 'severa'} HrSlug
 * @typedef {{ date: string, description: string, account: string, amountMinor: number }} ExpRow
 * @typedef {{ date: string, hours: number, project: string, comment: string }} HrHoursRow
 */

/** @type {Record<HrSlug, { brand: string, title: string, lead: string, mode: 'expense' | 'hours', sampleCsv: string }>} */
const HRS = {
  simployer: {
    brand: 'Simployer (Infotjenester)',
    title: 'Simployer Travel & Expense Accounting',
    lead: 'Import approved Simployer travel claims, per diem and employee expense exports into balanced ReAI review vouchers credited to employee payable (2915).',
    mode: 'expense',
    sampleCsv: 'Dato;Beskrivelse;Konto;Belop\n2026-10-14;Flybillett Oslo–Trondheim (Simployer);7140;2490,00\n2026-10-15;Hotellovernatting kundebesøk;7140;1890,00\n2026-10-15;Diett etter statens satser;7150;678,00',
  },
  acubiz: {
    brand: 'Acubiz / Visma Expense / Findity',
    title: 'Acubiz & Visma Expense Import',
    lead: 'Import corporate travel and receipt expense batches from Acubiz, Visma Expense or Findity into balanced ReAI review vouchers mapped to NS 4102 accounts.',
    mode: 'expense',
    sampleCsv: 'Dato;Beskrivelse;Konto;Belop\n2026-10-11;Flytoget kvittering;7140;240,00\n2026-10-13;Kundemiddag representasjon;7350;1680,00\n2026-10-19;Kontorutstyr Elkjøp;6800;1199,00',
  },
  quinyx: {
    brand: 'Quinyx',
    title: 'Quinyx Workforce & Shift Sync',
    lead: 'Import approved Quinyx chain retail and hospitality shift hours directly into ReAI Timesheets ready for Norwegian payroll.',
    mode: 'hours',
    sampleCsv: 'Dato;Timer;Prosjekt;Kommentar\n2026-10-14;7,50;Butikk Oslo S;Godkjent vakt Quinyx\n2026-10-15;8,00;Butikk Oslo S;Godkjent kveldsvakt Quinyx',
  },
  severa: {
    brand: 'Visma Severa',
    title: 'Visma Severa Consulting Hours Sync',
    lead: 'Import approved billable project hours from Visma Severa straight into ReAI Timesheets for invoicing and project profitability.',
    mode: 'hours',
    sampleCsv: 'Dato;Timer;Prosjekt;Kommentar\n2026-10-12;7,50;Prosjekt ERP-rådgivning;Workshop og spesifikasjon\n2026-10-13;8,00;Prosjekt ERP-rådgivning;Teknisk leveranse',
  },
};

/** @param {string} raw */
function moneyMinor(raw) {
  const n = Number(raw.replace(/[\s\u00A0]/g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

/** @param {string} csvText @returns {ExpRow[]} */
function parseExpCsv(csvText) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const dIdx = norm.findIndex((h) => h.includes('dato') || h.includes('date'));
  const descIdx = norm.findIndex((h) => h.includes('beskrivelse') || h.includes('desc') || h.includes('tekst'));
  const aIdx = norm.findIndex((h) => h.includes('konto') || h.includes('account'));
  const mIdx = norm.findIndex((h) => h.includes('belop') || h.includes('beløp') || h.includes('amount'));
  if (dIdx < 0 || mIdx < 0) throw new HttpError(400, 'CSV must include Dato/Date and Beløp/Amount.');
  return doc.rows
    .map((r) => ({
      date: (r[dIdx] ?? '').trim().slice(0, 10),
      description: descIdx >= 0 ? (r[descIdx] ?? '').trim() || 'Expense' : 'Expense',
      account: aIdx >= 0 && /^[0-9]{4}$/.test((r[aIdx] ?? '').trim()) ? (r[aIdx] ?? '').trim() : '7140',
      amountMinor: moneyMinor(r[mIdx] ?? '0'),
    }))
    .filter((x) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x.date) && x.amountMinor > 0);
}

/** @param {string} csvText @returns {HrHoursRow[]} */
function parseHrHoursCsv(csvText) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const dIdx = norm.findIndex((h) => h.includes('dato') || h.includes('date'));
  const hIdx = norm.findIndex((h) => h.includes('timer') || h.includes('hour'));
  const pIdx = norm.findIndex((h) => h.includes('prosjekt') || h.includes('project'));
  const cIdx = norm.findIndex((h) => h.includes('kommentar') || h.includes('note') || h.includes('desc'));
  if (dIdx < 0 || hIdx < 0) throw new HttpError(400, 'CSV must include Dato/Date and Timer/Hours.');
  return doc.rows
    .map((r) => ({
      date: (r[dIdx] ?? '').trim().slice(0, 10),
      hours: Number(Number((r[hIdx] ?? '').replace(',', '.').replace(/[^0-9.]/g, '')).toFixed(2)),
      project: pIdx >= 0 ? (r[pIdx] ?? '').trim() || '—' : '—',
      comment: cIdx >= 0 ? (r[cIdx] ?? '').trim() || 'Imported shift' : 'Imported shift',
    }))
    .filter((x) => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(x.date) && x.hours >= 0.01 && x.hours <= 24);
}

/**
 * Handles /app/{simployer,acubiz,quinyx,severa}/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @param {HrSlug} slug
 * @returns {Promise<Response>}
 */
export async function handleHrExpense(request, env, slug) {
  const cfg = HRS[slug];
  const { pathname } = new URL(request.url);
  const basePath = `/app/${slug}`;

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  }
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    /** @type {Array<{ id: number, name: string }>} */
    let employees = [];
    /** @type {Array<{ id: number, name: string }>} */
    let projects = [];
    if (cfg.mode === 'hours' && session && session.tenantId > 0) {
      try {
        const [e, p] = await Promise.all([
          reaiRequest(env, '/api/employees', { token: session.accessToken, tenantId: session.tenantId }).catch(() => []),
          reaiAll(env, '/api/projects', { token: session.accessToken, tenantId: session.tenantId }).catch(() => []),
        ]);
        employees = Array.isArray(e) ? /** @type {Array<{ id: number, name: string }>} */ (e) : [];
        projects = /** @type {Array<{ id: number, name: string, archived?: boolean }>} */ (p).filter((x) => !x.archived);
      } catch {
        // leave empty
      }
    }
    const body = html`
      <section class="app-intro"><p class="eyebrow">${cfg.mode === 'expense' ? 'TRAVEL & EXPENSE MANAGEMENT' : 'WORKFORCE & CONSULTING PSA'}</p><h1>${cfg.title}</h1><p class="lead">${cfg.lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: `reai-${slug}-web`, clientName: `ReAI ${cfg.brand} (Web)` })}
        ${reaiCard({
          eyebrow: `IMPORT FROM ${cfg.brand.toUpperCase()}`,
          title: `Upload ${cfg.brand} export CSV`,
          body: html`<form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#hr-output" hx-swap="innerHTML">
            ${cfg.mode === 'expense'
              ? html`<div class="inline-row"><div class="field"><label for="hr-cl">Employee / card clearing account (4 digits)</label><input id="hr-cl" name="clearingAccount" type="text" pattern="[0-9]{4}" value="2915" required></div></div>`
              : html`<div class="mapping-grid">
                  <div class="field"><label for="hr-emp">ReAI employee</label><select id="hr-emp" name="employeeId"><option value="0">${employees.length > 0 ? 'Select employee…' : 'Connect to ReAI first'}</option>${employees.map((e) => html`<option value="${e.id}">${e.name}</option>`)}</select></div>
                  <div class="field"><label for="hr-proj">ReAI project (optional)</label><select id="hr-proj" name="projectId"><option value="0">No project</option>${projects.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select></div>
                </div>`}
            ${reaiDropzone({ inputId: 'hr-csv', name: 'file', accept: '.csv,text/csv,text/plain', label: `Choose ${cfg.brand} CSV`, hint: cfg.mode === 'expense' ? 'CSV with Dato, Beskrivelse, Konto and Beløp.' : 'CSV with Dato, Timer, Prosjekt and Kommentar.' })}
            <div class="inline-row">
              <button type="submit" class="button primary">Preview</button>
              <button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#hr-output" hx-swap="innerHTML">Load sample export</button>
            </div>
          </form>`,
        })}
        <div id="hr-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: cfg.title, description: cfg.lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  /** @param {ExpRow[]} lines @param {string} clearing @param {boolean} isSample */
  const renderExpenses = (lines, clearing, isSample) => {
    const total = lines.reduce((s, l) => s + l.amountMinor, 0);
    const lastDate = lines.map((l) => l.date).sort().at(-1) ?? '';
    return reaiCard({
      eyebrow: `${cfg.brand.toUpperCase()} → REAI REVIEW VOUCHER`,
      title: `${lines.length} expense lines · ${formatMinor(total)} NOK`,
      badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Expense lines', value: String(lines.length), detail: 'NS 4102 accounts' })}
          ${reaiMetric({ label: 'Total debit', value: `${formatMinor(total)} NOK`, detail: 'Travel, per diem & receipts' })}
          ${reaiMetric({ label: 'Credit account', value: clearing, detail: 'Employee payable / card clearing' })}
        </div>
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Date</th><th>Description</th><th>Account</th><th class="num">Amount (NOK)</th></tr></thead>
          <tbody>
            ${lines.map((l) => html`<tr><td class="mono">${l.date}</td><td>${l.description}</td><td class="mono">${l.account}</td><td class="num">${formatMinor(l.amountMinor)}</td></tr>`)}
            <tr><td class="mono">${lastDate}</td><td><strong>${cfg.brand} payable clearing (credit)</strong></td><td class="mono">${clearing}</td><td class="num"><strong>-${formatMinor(total)}</strong></td></tr>
          </tbody>
        </table></div>
        ${!isSample
          ? html`<form class="stack-sm confirm-box" hx-post="${basePath}/book" hx-target="#hr-booking" hx-swap="innerHTML">
              <input type="hidden" name="linesJson" value="${JSON.stringify(lines)}">
              <input type="hidden" name="clearingAccount" value="${clearing}">
              <label class="check-row"><input type="checkbox" name="c_exp" required> I verified these approved expenses and will attach receipt PDFs in ReAI.</label>
              <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
            </form><div id="hr-booking" class="stack-sm"></div>`
          : reaiCallout({ tone: 'info', body: `Synthetic ${cfg.brand} batch loaded. Upload your real export above and connect to ReAI to book.` })}
      `,
    });
  };

  /** @param {HrHoursRow[]} rows @param {number} empId @param {number} projId @param {boolean} isSample */
  const renderHours = (rows, empId, projId, isSample) =>
    reaiCard({
      eyebrow: `${cfg.brand.toUpperCase()} → REAI TIMESHEETS`,
      title: `${rows.length} entries (${rows.reduce((s, r) => s + r.hours, 0).toFixed(2)} h)`,
      badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: 'Ready', tone: 'success' }),
      body: html`<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Date</th><th>Project / Unit</th><th>Comment</th><th class="num">Hours</th><th>Action</th></tr></thead>
        <tbody>${rows.map(
          (r, idx) => html`<tr id="hr-h-${idx}">
            <td class="mono">${r.date}</td>
            <td>${r.project}</td>
            <td>${r.comment}</td>
            <td class="num">${r.hours.toFixed(2)}</td>
            <td>${isSample || empId <= 0
              ? html`<span class="muted-note">${isSample ? 'Demo only' : 'Select employee above'}</span>`
              : html`<form hx-post="${basePath}/import" hx-target="#hr-h-${idx}" hx-swap="outerHTML">
                  <input type="hidden" name="employeeId" value="${empId}">
                  <input type="hidden" name="projectId" value="${projId}">
                  <input type="hidden" name="date" value="${r.date}">
                  <input type="hidden" name="hours" value="${r.hours.toFixed(2)}">
                  <input type="hidden" name="comment" value="[${cfg.brand}] ${r.comment}">
                  <button type="submit" class="button primary">Post to ReAI</button>
                </form>`}</td>
          </tr>`,
        )}</tbody>
      </table></div>`,
    });

  if (pathname === `${basePath}/sample`) {
    if (cfg.mode === 'expense') return htmlResponse(renderExpenses(parseExpCsv(cfg.sampleCsv), '2915', true));
    return htmlResponse(renderHours(parseHrHoursCsv(cfg.sampleCsv), 1, 0, true));
  }

  try {
    const form = await request.formData();
    if (pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a CSV file or load sample.');
      const text = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
      if (cfg.mode === 'expense') return htmlResponse(renderExpenses(parseExpCsv(text), String(form.get('clearingAccount') ?? '2915').trim(), false));
      return htmlResponse(renderHours(parseHrHoursCsv(text), Number(form.get('employeeId') ?? '0'), Number(form.get('projectId') ?? '0'), false));
    }

    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');

    if (cfg.mode === 'expense' && pathname === `${basePath}/book`) {
      if (form.get('c_exp') !== 'on') throw new HttpError(400, 'Confirm verification checkbox first.');
      const lines = /** @type {ExpRow[]} */ (JSON.parse(String(form.get('linesJson') ?? '[]')));
      const clearing = String(form.get('clearingAccount') ?? '2915').trim();
      const total = lines.reduce((s, l) => s + l.amountMinor, 0);
      const lastDate = lines.map((l) => l.date).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
      const created = /** @type {{ id: number, number: string }} */ (
        await reaiRequest(env, '/api/manual-vouchers', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: {
            date: lastDate,
            description: `${cfg.brand} expenses ${lastDate} (${lines.length} lines)`,
            reviewReason: `Imported ${cfg.brand} expense batch via apps.reai.no. Attach receipt PDFs before clearing review.`,
            postings: [
              ...lines.map((l, idx) => ({ accountNumber: l.account, postingDate: l.date, currencyCode: 'NOK', amount: Number((l.amountMinor / 100).toFixed(2)), vatCode: '0', rowNumber: idx, description: `${cfg.brand}: ${l.description}` })),
              { accountNumber: clearing, postingDate: lastDate, currencyCode: 'NOK', amount: Number((-total / 100).toFixed(2)), vatCode: '0', rowNumber: lines.length, description: `${cfg.brand} payable clearing` },
            ],
          },
        })
      );
      const url = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${url}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }

    if (cfg.mode === 'hours' && pathname === `${basePath}/import`) {
      const employeeId = Number(form.get('employeeId') ?? '0');
      const projectId = Number(form.get('projectId') ?? '0');
      const date = String(form.get('date') ?? '').trim();
      const hours = Number(form.get('hours') ?? '0');
      const comment = String(form.get('comment') ?? '').trim().slice(0, 1000);
      const created = /** @type {{ id: number }} */ (
        await reaiRequest(env, '/api/timesheets', {
          token: session.accessToken,
          tenantId: session.tenantId,
          method: 'POST',
          body: { employeeId, date, hours: Number(hours.toFixed(2)), ...(projectId > 0 ? { projectId } : {}), comment },
        })
      );
      return htmlResponse(html`<tr><td class="mono">${date}</td><td>${projectId > 0 ? `Project #${projectId}` : '—'}</td><td>${comment}</td><td class="num">${hours.toFixed(2)}</td><td>${reaiBadge({ text: `Logged #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${cfg.brand} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }

  return errorResponse('Unknown HR/expense route.', 404);
}
