// @ts-check
import { pairVoucherRows } from '../lib/voucher-rows.js';
import { assertPublicHttpsUrl, fetchJson, isoDate, num, pickList, renderApiFetchCard } from '../lib/api-http.js';
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { formatMinor } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * One review voucher line. signedMinor is NOK øre: positive debit, negative credit.
 * The revenue line carries the gross amount and a ReAI output VAT code, so ReAI splits net and VAT.
 * @typedef {{ account: string, vatCode: string, vatRate: number, description: string, signedMinor: number }} PindenaLine
 * @typedef {{ date: string, activityId: string, title: string, paidCount: number, openCount: number, openMinor: number, lines: PindenaLine[] }} PindenaVoucher
 * @typedef {{ RegistrationPersonStructID?: unknown, Status?: string, Paid?: string, TotalPrice?: unknown, Count?: unknown }} PindenaParticipant
 */

const BRAND = 'Pindena';
const BASE_PATH = '/app/pindena';
const TITLE = 'Pindena Course Registration Accounting';
const LEAD = 'Fetch the participants of a Pindena activity and create a balanced review voucher in ReAI for registrations prepaid by card or Vipps, with the VAT treatment you choose.';

/** VAT treatment choices: Pindena offers these four rates (see the Tripletex integration article). */
const VAT_MODES = /** @type {Record<string, { code: string, rate: number, account: string, label: string }>} */ ({
  '6': { code: '6', rate: 0, account: '3200', label: 'Course fees outside the VAT act' },
  '3': { code: '3', rate: 25, account: '3000', label: 'Registrations 25% VAT' },
  '31': { code: '31', rate: 15, account: '3010', label: 'Registrations 15% VAT' },
  '33': { code: '33', rate: 12, account: '3020', label: 'Registrations 12% VAT' },
});

/** @param {unknown} v */
const minor = (v) => Math.round(num(v) * 100);

/**
 * Builds the activity voucher. Only participants with Paid = "Paid" (prepaid at registration) are booked;
 * invoiced, due and unpaid registrations are counted so they can be invoiced from ReAI.
 * @param {{ RegistrationID?: unknown, Title?: string }} activity @param {PindenaParticipant[]} participants @param {string} vatMode @param {string} date @param {string} activityId
 * @returns {PindenaVoucher}
 */
export function buildVoucher(activity, participants, vatMode, date, activityId) {
  const vat = VAT_MODES[vatMode];
  if (!vat) throw new HttpError(400, 'Choose a VAT treatment.');
  let paidMinor = 0, paidCount = 0, openMinor = 0, openCount = 0;
  for (const p of participants) {
    const status = String(p.Status ?? '').toLowerCase();
    if (status && status !== 'registered' && status !== 'confirmed') continue;
    const paid = String(p.Paid ?? '');
    const price = minor(p.TotalPrice);
    if (paid === 'Paid') { paidMinor += price; paidCount++; }
    else if (paid !== 'Credited') { openMinor += price; openCount++; }
  }
  const title = String(activity.Title ?? `Activity ${activityId}`).slice(0, 80);
  /** @type {PindenaLine[]} */
  const lines = paidMinor === 0 ? [] : [
    { account: '1580', vatCode: '0', vatRate: 0, description: `${BRAND} prepaid registrations · ${title}`, signedMinor: paidMinor },
    { account: vat.account, vatCode: vat.code, vatRate: vat.rate, description: `${BRAND} ${vat.label} · ${title}`, signedMinor: -paidMinor },
  ];
  return { date, activityId, title, paidCount, openCount, openMinor, lines };
}

/**
 * Fetches one activity and its registered or confirmed participants from the Pindena API.
 * Docs (Basic Auth username and password issued by Pindena on request):
 * https://faq.pameldingssystem.no/article/479-api-vis-aktivitet (GET /api/v1/activities/<id>: RegistrationID, Title)
 * https://faq.pameldingssystem.no/article/244-deltagerlisteapi (GET /api/v1/activities/<id>/participants:
 * Status, Paid = NotPaid|Paid|Invoiced|Due|Credited, Count, TotalPrice; without updated_* only registered/confirmed).
 * The API runs on the organisation's own Pindena address, for example https://yourorg.pameldingssystem.no.
 * @param {Record<string, string>} creds
 * @param {import('../lib/api-http.js').FetchLike} [fetchImpl]
 * @returns {Promise<PindenaVoucher>}
 */
export async function fetchApi(creds, fetchImpl = fetch) {
  const username = (creds.username ?? '').trim();
  const password = (creds.password ?? '').trim();
  const activityId = (creds.activityId ?? '').trim();
  const date = isoDate(creds.date);
  if (!username || !password) throw new HttpError(400, 'Enter the Pindena API username and password.');
  if (!/^[0-9]+$/.test(activityId)) throw new HttpError(400, 'Enter the numeric Pindena activity ID.');
  const base = assertPublicHttpsUrl(creds.baseUrl ?? '');
  const root = `${base.origin}/api/v1/activities/${activityId}`;
  const init = { headers: { authorization: `Basic ${btoa(`${username}:${password}`)}`, accept: 'application/json' } };
  const act = await fetchJson(root, init, BRAND, fetchImpl);
  const activity = act && typeof act === 'object' && !Array.isArray(act) ? (act.data && typeof act.data === 'object' && !Array.isArray(act.data) ? act.data : act) : {};
  const participants = /** @type {PindenaParticipant[]} */ (pickList(await fetchJson(`${root}/participants`, init, BRAND, fetchImpl), ['data', 'participants', 'items']));
  const v = buildVoucher(activity, participants, String(creds.vatMode ?? ''), date, activityId);
  if (v.lines.length === 0) throw new HttpError(400, `${BRAND} activity ${activityId} has no prepaid registrations to book (${v.openCount} invoiced or unpaid).`);
  return v;
}

/** @returns {PindenaVoucher} */
function sampleVoucher() {
  return buildVoucher(
    { RegistrationID: 1042, Title: 'Grunnkurs i regnskap, november' },
    [
      { RegistrationPersonStructID: 1, Status: 'confirmed', Paid: 'Paid', Count: 1, TotalPrice: 3900 },
      { RegistrationPersonStructID: 2, Status: 'registered', Paid: 'Paid', Count: 2, TotalPrice: 7800 },
      { RegistrationPersonStructID: 3, Status: 'registered', Paid: 'Invoiced', Count: 1, TotalPrice: 3900 },
      { RegistrationPersonStructID: 4, Status: 'confirmed', Paid: 'Paid', Count: 1, TotalPrice: 3900 },
    ],
    '6',
    '2026-11-20',
    '1042',
  );
}

/** @param {PindenaLine} l */
function vatPartMinor(l) {
  if (l.vatRate <= 0 || l.vatCode === '0') return 0;
  return l.signedMinor - Math.round((l.signedMinor * 100) / (100 + l.vatRate));
}

/** @param {PindenaVoucher} v @param {boolean} isSample */
function renderPreview(v, isSample) {
  const debit = v.lines.filter((l) => l.signedMinor > 0).reduce((s, l) => s + l.signedMinor, 0);
  const credit = v.lines.filter((l) => l.signedMinor < 0).reduce((s, l) => s - l.signedMinor, 0);
  const balanced = debit === credit && debit > 0;
  const outputVat = -v.lines.reduce((s, l) => s + vatPartMinor(l), 0);
  return reaiCard({
    eyebrow: `${BRAND.toUpperCase()} → REAI REVIEW VOUCHER`,
    title: `${v.title} · ${v.date}`,
    badge: balanced ? reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }) : reaiBadge({ text: 'Nothing to book', tone: 'danger' }),
    body: html`
      <div class="metric-grid">
        ${reaiMetric({ label: 'Prepaid registrations', value: `${formatMinor(debit)} NOK`, detail: `${v.paidCount} participant${v.paidCount === 1 ? '' : 's'}` })}
        ${reaiMetric({ label: 'Invoiced or unpaid (not booked)', value: `${formatMinor(v.openMinor)} NOK`, detail: `${v.openCount} participant${v.openCount === 1 ? '' : 's'}` })}
        ${reaiMetric({ label: 'Estimated output VAT', value: `${formatMinor(outputVat)} NOK`, detail: 'ReAI calculates VAT from the VAT code' })}
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Account</th><th>VAT code</th><th>Posting</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${v.lines.map((l) => html`<tr><td class="mono">${l.account}</td><td class="mono">${l.vatCode}</td><td>${l.description}</td><td class="num">${l.signedMinor > 0 ? formatMinor(l.signedMinor) : ''}</td><td class="num">${l.signedMinor < 0 ? formatMinor(-l.signedMinor) : ''}</td></tr>`)}</tbody>
      </table></div>
      ${v.openCount > 0 ? reaiCallout({ tone: 'info', body: 'Invoiced, due and unpaid registrations are not booked here. Invoice those participants from ReAI.' }) : ''}
      ${balanced && !isSample
        ? html`<form class="stack-sm confirm-box" hx-post="${BASE_PATH}/book" hx-target="#pindena-book" hx-swap="innerHTML">
            <input type="hidden" name="voucherJson" value="${JSON.stringify(v)}">
            <label class="check-row"><input type="checkbox" name="confirm" required> I checked these registrations against the Pindena payment report and the payout from the payment provider.</label>
            <div><button type="submit" class="button primary">Create review voucher in ReAI</button></div>
          </form><div id="pindena-book" class="stack-sm"></div>`
        : isSample ? reaiCallout({ tone: 'info', body: `Synthetic ${BRAND} activity loaded. Connect to ReAI and fetch a real activity to book.` }) : ''}
    `,
  });
}

/**
 * Verifies the VAT codes used exist in ReAI with the expected rate and gross (vat_inclusive) basis.
 * @param {import('../lib/types.d.ts').Env} env @param {{ accessToken: string, tenantId: number }} session @param {PindenaLine[]} lines
 */
async function assertVatCodes(env, session, lines) {
  const codes = /** @type {Array<{ code: string, rate: number, amountBasis: string, reverseCharge: boolean }>} */ (
    await reaiRequest(env, '/api/vat-codes', { token: session.accessToken, tenantId: session.tenantId })
  );
  for (const l of lines) {
    if (l.vatCode === '0') continue;
    const c = codes.find((x) => x.code === l.vatCode);
    if (!c || Math.round(c.rate) !== l.vatRate || c.reverseCharge || (l.vatRate > 0 && c.amountBasis !== 'vat_inclusive')) {
      throw new HttpError(400, `ReAI VAT code ${l.vatCode} (${l.vatRate}%) is not available as an output VAT code for this company.`);
    }
  }
}

/**
 * Handles /app/pindena/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === BASE_PATH && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${BASE_PATH}/`, request.url), 301);
  if (pathname === `${BASE_PATH}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const vatSelect = html`<div class="field">
      <label for="api-vatMode">VAT treatment</label>
      <select id="api-vatMode" name="vatMode" required>
        ${Object.entries(VAT_MODES).map(([code, m]) => html`<option value="${code}">${m.label} (VAT code ${code})</option>`)}
      </select>
    </div>`;
    const body = html`
      <section class="app-intro"><p class="eyebrow">COURSES & EVENTS</p><h1>${TITLE}</h1><p class="lead">${LEAD}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-pindena-web', clientName: `ReAI ${BRAND} (Web)` })}
        ${renderApiFetchCard({
          basePath: BASE_PATH,
          targetId: 'pindena-output',
          brand: BRAND,
          hint: 'Pindena issues the API username and password on request. Enter your Pindena address and the activity ID shown in the activity list.',
          fields: [
            { name: 'baseUrl', label: 'Pindena address', type: 'url', placeholder: 'https://yourorg.pameldingssystem.no' },
            { name: 'username', label: 'API username' },
            { name: 'password', label: 'API password', type: 'password' },
            { name: 'activityId', label: 'Activity ID', placeholder: '1042' },
            { name: 'date', label: 'Voucher date', type: 'date', defaultValue: '$TODAY' },
          ],
          extraFields: vatSelect,
          sampleAction: true,
        })}
        <div id="pindena-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title: TITLE, description: LEAD, activePath: `${BASE_PATH}/`, body }));
  }
  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (pathname === `${BASE_PATH}/sample`) return htmlResponse(renderPreview(sampleVoucher(), true));
  try {
    const form = await request.formData();
    if (pathname === `${BASE_PATH}/fetch-api`) {
      /** @type {Record<string, string>} */ const creds = {};
      for (const [k, v] of form.entries()) creds[k] = String(v);
      return htmlResponse(renderPreview(await fetchApi(creds), false));
    }
    if (pathname === `${BASE_PATH}/book`) {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      if (form.get('confirm') !== 'on') throw new HttpError(400, 'Confirm that you checked the registrations first.');
      const v = /** @type {PindenaVoucher} */ (JSON.parse(String(form.get('voucherJson') ?? '{}')));
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v.date ?? '') || !/^[0-9]+$/.test(v.activityId ?? '') || !Array.isArray(v.lines) || v.lines.length === 0) throw new HttpError(400, 'Invalid voucher.');
      if (!v.lines.every((l) => /^[0-9]{4}$/.test(l.account) && /^[0-9]{1,2}$/.test(l.vatCode) && Number.isInteger(l.signedMinor))) throw new HttpError(400, 'Invalid voucher line.');
      if (v.lines.reduce((s, l) => s + l.signedMinor, 0) !== 0) throw new HttpError(400, 'Voucher must balance to 0.00.');
      await assertVatCodes(env, session, v.lines);
      const marker = `${BRAND} activity ${v.activityId} prepaid`;
      const around = (/** @type {number} */ days) => new Date(Date.parse(`${v.date}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);
      const existing = /** @type {Array<{ id: number, number: string, description?: string | null }>} */ (await reaiAll(env, '/api/vouchers', { token: session.accessToken, tenantId: session.tenantId, query: { startDate: around(-120), endDate: around(120), includeReversed: 'true' } }));
      const dup = existing.find((x) => typeof x.description === 'string' && x.description.startsWith(marker));
      if (dup) return htmlResponse(reaiCallout({ tone: 'warn', title: `Already booked (${dup.number})`, body: html`Duplicate prevented: <a href="${reaiOrigin(env)}/voucher/${dup.id}?tenantId=${session.tenantId}" target="_blank" rel="noopener">Open voucher ${dup.number} ↗</a>.` }));
      const created = /** @type {{ id: number, number: string, webUrl?: string }} */ (await reaiRequest(env, '/api/manual-vouchers', {
        token: session.accessToken,
        tenantId: session.tenantId,
        method: 'POST',
        body: {
          date: v.date,
          description: `${marker} (${v.paidCount} participants): ${v.title}`.slice(0, 250),
          reviewReason: `${BRAND} prepaid registrations imported via apps.reai.no. Check against the Pindena payment report.`,
          postings: pairVoucherRows(v.lines.map((l) => ({ accountNumber: l.account, postingDate: v.date, currencyCode: 'NOK', amount: Number((l.signedMinor / 100).toFixed(2)), vatCode: l.vatCode, description: l.description }))),
        },
      }));
      const href = created.webUrl ?? `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${session.tenantId}`;
      return htmlResponse(reaiCallout({ tone: 'success', title: `Created review voucher ${created.number}`, body: html`Open in ReAI: <a href="${href}" target="_blank" rel="noopener">Open voucher ${created.number} ↗</a>.` }));
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: `${BRAND} error`, body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown route.', 404);
}
