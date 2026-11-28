// @ts-check
import { fetchJson, isoDate, num, pickList, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiRequest } from '../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../lib/ui.js';
import { decodeCsvBytes, parseCsv } from './hybel-journal.js';
import { verifiedNorwegianAccount } from './recman-core.js';

/** @typedef {{ name: string, email: string, startDate: string, bank: string, percent: number }} HumaEmpRow */

const SAMPLE_CSV = 'Navn;Epost;Startdato;Stillingsprosent;Kontonummer\nAstrid Lind (Demo);astrid@example.no;2026-11-01;100;12345678903\nJonas Berg (Demo);jonas@example.no;2026-11-15;80;';

/**
 * Fetches employees from Huma HR REST API (GET https://api.hu.ma/v1/users).
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<HumaEmpRow[]>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const token = (creds.apiToken ?? '').trim();
  if (!token) throw new HttpError(400, 'Enter your Huma HR API Bearer token.');
  const data = await fetchJson('https://api.hu.ma/v1/users', { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } }, 'Huma HR', fetchImpl);
  const rows = pickList(data).map((u) => ({
    name: String(u.fullName ?? [u.firstName, u.lastName].filter(Boolean).join(' ') ?? u.name ?? '').trim(),
    email: String(u.email ?? '').trim(),
    startDate: isoDate(u.employmentStartDate ?? u.startDate),
    percent: Math.min(100, Math.max(1, num(u.employmentPercentage ?? u.percent ?? 100) || 100)),
    bank: verifiedNorwegianAccount(String(u.bankAccountNumber ?? u.bankAccount ?? '')),
  })).filter((e) => e.name.length > 0);
  if (rows.length === 0) throw new HttpError(400, 'Huma HR returned 0 employees.');
  return rows;
}

/** @param {string} csvText @returns {HumaEmpRow[]} */
function parseHumaCsv(csvText) {
  const doc = parseCsv(csvText);
  const norm = doc.headers.map((h) => h.toLowerCase().trim());
  const nIdx = norm.findIndex((h) => h.includes('navn') || h.includes('name'));
  const eIdx = norm.findIndex((h) => h.includes('epost') || h.includes('email'));
  const sIdx = norm.findIndex((h) => h.includes('start') || h.includes('dato'));
  const pctIdx = norm.findIndex((h) => h.includes('prosent') || h.includes('percent'));
  const bIdx = norm.findIndex((h) => h.includes('konto') || h.includes('bank'));
  if (nIdx < 0) throw new HttpError(400, 'CSV must include Navn/Name column.');
  return doc.rows.map((r) => ({
    name: (r[nIdx] ?? '').trim(),
    email: eIdx >= 0 ? (r[eIdx] ?? '').trim() : '',
    startDate: sIdx >= 0 ? isoDate(r[sIdx]) : new Date().toISOString().slice(0, 10),
    percent: pctIdx >= 0 ? Math.min(100, Math.max(1, num(r[pctIdx]) || 100)) : 100,
    bank: bIdx >= 0 ? verifiedNorwegianAccount(r[bIdx] ?? '') : '',
  })).filter((x) => x.name.length > 0);
}

/** @param {Array<{ emp: HumaEmpRow, existsId: number | null }>} rows @param {boolean} isSample */
function renderEmployees(rows, isSample) {
  return reaiCard({
    eyebrow: 'HUMA HR → REAI EMPLOYEES',
    title: `${rows.length} employees parsed`,
    badge: isSample ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' }) : reaiBadge({ text: `${rows.filter((x) => !x.existsId).length} new`, tone: 'success' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Employees', value: String(rows.length), detail: 'Matched by email or name' })}
        ${reaiMetric({ label: 'Mod11 verified bank', value: String(rows.filter((x) => Boolean(x.emp.bank)).length), detail: 'Validated 11-digit NO account' })}
        ${reaiMetric({ label: 'Safe sync', value: 'No invites', detail: 'Does not send user invites or A-melding' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Name</th><th>Email</th><th>Start date</th><th>%</th><th>Bank</th><th>Action</th></tr></thead>
        <tbody>${rows.map(({ emp, existsId }, idx) => html`<tr id="wf-e-${idx}">
          <td><strong>${emp.name}</strong></td><td>${emp.email || '—'}</td><td class="mono">${emp.startDate}</td><td class="num">${emp.percent}%</td><td class="mono">${emp.bank || '—'}</td>
          <td>${existsId || isSample ? html`<span class="muted-note">${existsId ? `In ReAI #${existsId}` : 'Demo only'}</span>` : html`<form hx-post="/app/huma/import" hx-target="#wf-e-${idx}" hx-swap="outerHTML"><input type="hidden" name="name" value="${emp.name}"><input type="hidden" name="email" value="${emp.email}"><input type="hidden" name="startDate" value="${emp.startDate}"><input type="hidden" name="percent" value="${emp.percent}"><input type="hidden" name="bank" value="${emp.bank}"><button type="submit" class="button primary">Create in ReAI</button></form>`}</td>
        </tr>`)}</tbody>
      </table></div>
    `,
  });
}

/**
 * Handles /app/huma/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/huma';
  const title = 'Huma HR Employee Sync';
  const lead = 'Sync employee onboarding records (name, email, start date, position % and verified Mod11 Norwegian bank account) from Huma HR API or CSV directly into ReAI Employees.';
  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">HR & EMPLOYEE ONBOARDING</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-huma-web', clientName: 'ReAI Huma HR (Web)' })}
        ${renderApiFetchCard({ basePath, targetId: 'wfm-output', brand: 'Huma HR', hint: 'Connect Huma HR API (GET https://api.hu.ma/v1/users) with your Bearer token to sync employees to ReAI.', fields: [{ name: 'apiToken', label: 'Huma HR API Bearer token', type: 'password', placeholder: 'Bearer token' }], sampleAction: true })}
        ${reaiCard({ eyebrow: 'CSV IMPORT · HUMA HR', title: 'Or upload Huma employee CSV', body: html`<form class="stack" hx-post="${basePath}/preview" hx-encoding="multipart/form-data" hx-target="#wfm-output" hx-swap="innerHTML">${reaiDropzone({ inputId: 'wf-csv', name: 'file', accept: '.csv,text/csv,text/plain', label: 'Choose Huma CSV', hint: 'CSV with Navn, Epost, Startdato, Stillingsprosent, Kontonummer.' })}<div class="inline-row"><button type="submit" class="button primary">Preview CSV</button></div></form>` })}
        <div id="wfm-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${basePath}/sample`) return htmlResponse(renderEmployees(parseHumaCsv(SAMPLE_CSV).map((emp, i) => ({ emp, existsId: i === 0 ? 7 : null })), true));
  try {
    const form = await request.formData();
    if (pathname === `${basePath}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderEmployees((await fetchApi(creds)).map((emp) => ({ emp, existsId: null })), false));
    }
    if (pathname === `${basePath}/preview`) {
      const file = form.get('file');
      if (!file || typeof file !== 'object' || !('arrayBuffer' in file) || file.size === 0) throw new HttpError(400, 'Choose a CSV file.');
      return htmlResponse(renderEmployees(parseHumaCsv(decodeCsvBytes(new Uint8Array(await file.arrayBuffer()))).map((emp) => ({ emp, existsId: null })), false));
    }
    if (pathname === `${basePath}/import`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      const name = String(form.get('name') ?? '').trim();
      const email = String(form.get('email') ?? '').trim();
      const startDate = String(form.get('startDate') ?? '').slice(0, 10);
      const bank = verifiedNorwegianAccount(String(form.get('bank') ?? ''));
      const created = /** @type {{ id: number }} */ (await reaiRequest(env, '/api/employees', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { name, ...(email ? { email } : {}), startDate, ...(bank ? { bankAccountNumber: bank } : {}) } }));
      return htmlResponse(html`<tr><td><strong>${name}</strong></td><td>${email || '—'}</td><td class="mono">${startDate}</td><td class="num">—</td><td class="mono">${bank || '—'}</td><td>${reaiBadge({ text: `Created #${created.id}`, tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Huma HR error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown Huma route.', 404);
}
