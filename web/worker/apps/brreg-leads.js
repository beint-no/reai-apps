// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiRequest } from '../lib/reai.js';
import { appShell, reaiBadge, reaiCallout, reaiCard } from '../lib/ui.js';
import { extractNorwegianOrg } from './recman-core.js';

/**
 * Handles /app/brreg-leads/* routes.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handle(request, env) {
  const { pathname } = new URL(request.url);
  const basePath = '/app/brreg-leads';
  const title = 'Brreg Company Search & Lead Importer';
  const lead = 'Search Norway’s live official Brønnøysundregistrene (Enhetsregisteret) by name, NACE industry code or municipality and save companies straight to ReAI Leads (POST /api/leads) in one click.';

  if (pathname === basePath && (request.method === 'GET' || request.method === 'HEAD')) return Response.redirect(new URL(`${basePath}/`, request.url), 301);
  if (pathname === `${basePath}/` && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro"><p class="eyebrow">LIVE BRØNNØYSUNDREGISTRENE → REAI LEADS</p><h1>${title}</h1><p class="lead">${lead}</p></section>
      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-brreg-leads-web', clientName: 'ReAI Brreg Prospecting (Web)' })}
        ${reaiCard({
          eyebrow: 'LIVE BRREG ENHETSSØK (OPEN PUBLIC API)',
          title: 'Search Norwegian companies & import to ReAI Leads',
          body: html`<form class="stack" hx-post="${basePath}/search" hx-target="#pw-output" hx-swap="innerHTML">
            <div class="mapping-grid">
              <div class="field"><label for="br-q">Company name or keyword</label><input id="br-q" name="q" type="text" placeholder="e.g. Bygg, Frisør, Regnskap"></div>
              <div class="field"><label for="br-nace">NACE code (optional)</label><input id="br-nace" name="nace" type="text" placeholder="e.g. 62.010"></div>
              <div class="field"><label for="br-form">Org form</label><select id="br-form" name="orgform"><option value="AS">AS (Aksjeselskap)</option><option value="ENK">ENK (Enkeltpersonforetak)</option><option value="">Any</option></select></div>
            </div>
            <div class="inline-row"><button type="submit" class="button primary">Search Brreg live</button><button type="button" class="button secondary" hx-post="${basePath}/sample" hx-target="#pw-output" hx-swap="innerHTML">Load sample results</button></div>
          </form>`,
        })}
        <div id="pw-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(appShell({ title, description: lead, activePath: `${basePath}/`, body }));
  }

  if (request.method !== 'POST') return errorResponse('Method not allowed.', 405);
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (pathname === `${basePath}/sample`) {
    return htmlResponse(reaiCard({
      eyebrow: 'BRREG SAMPLE PROSPECTS',
      title: '2 Norwegian companies matched',
      badge: reaiBadge({ text: 'Sample', tone: 'accent' }),
      body: html`<div class="table-wrap"><table class="data-table">
        <thead><tr><th>Org.nr</th><th>Company</th><th>City</th><th>NACE</th><th>Employees</th></tr></thead>
        <tbody>
          <tr><td class="mono">935606403</td><td><strong>Fjord Demo Teknologi AS</strong></td><td>Oslo</td><td class="mono">62.010</td><td class="num">14</td></tr>
          <tr><td class="mono">923609016</td><td><strong>Vestland Byggservice AS</strong></td><td>Bergen</td><td class="mono">41.200</td><td class="num">28</td></tr>
        </tbody>
      </table></div>`,
    }));
  }

  try {
    const form = await request.formData();
    if (pathname === `${basePath}/search`) {
      const q = String(form.get('q') ?? '').trim();
      const nace = String(form.get('nace') ?? '').trim();
      const orgform = String(form.get('orgform') ?? '').trim();
      const params = new URLSearchParams({ size: '25' });
      if (q) params.set('navn', q);
      if (nace) params.set('naeringskode', nace);
      if (orgform) params.set('organisasjonsform', orgform);
      const res = await fetch(`https://data.brreg.no/enhetsregisteret/api/enheter?${params}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new HttpError(502, `Brreg Enhetsregisteret returned HTTP ${res.status}.`);
      const data = /** @type {any} */ (await res.json());
      const rows = /** @type {any[]} */ (data?._embedded?.enheter ?? []);
      return htmlResponse(reaiCard({
        eyebrow: 'BRØNNØYSUNDREGISTRENE LIVE RESULTS',
        title: `${rows.length} Norwegian companies found`,
        badge: reaiBadge({ text: 'Live Brreg API', tone: 'success' }),
        body: html`<div class="table-wrap"><table class="data-table">
          <thead><tr><th>Org.nr</th><th>Company</th><th>City</th><th>NACE</th><th class="num">Employees</th><th>Action</th></tr></thead>
          <tbody>${rows.map(
            (r, idx) => html`<tr id="br-r-${idx}">
              <td class="mono">${r.organisasjonsnummer}</td><td><strong>${r.navn}</strong></td><td>${r.forretningsadresse?.poststed ?? '—'}</td>
              <td class="mono">${r.naeringskode1?.kode ?? '—'}</td><td class="num">${r.antallAnsatte ?? 0}</td>
              <td><form hx-post="/app/brreg-leads/import-lead" hx-target="#br-r-${idx}" hx-swap="outerHTML"><input type="hidden" name="orgnr" value="${r.organisasjonsnummer}"><input type="hidden" name="name" value="${r.navn}"><button type="submit" class="button primary">Save lead</button></form></td>
            </tr>`,
          )}</tbody>
        </table></div>`,
      }));
    }
    const session = await readSession(env, request);
    if (!session || session.tenantId <= 0) throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
    if (pathname === `${basePath}/import-lead`) {
      const orgnr = extractNorwegianOrg(String(form.get('orgnr') ?? ''));
      const name = String(form.get('name') ?? '');
      if (!orgnr) throw new HttpError(400, 'Invalid 9-digit Norwegian org number.');
      const saved = /** @type {{ organizationNumber: string, companyName: string }} */ (
        await reaiRequest(env, '/api/leads', { token: session.accessToken, tenantId: session.tenantId, method: 'POST', body: { organizationNumber: orgnr } })
      );
      return htmlResponse(html`<tr><td class="mono">${orgnr}</td><td colspan="4"><strong>${saved.companyName || name}</strong></td><td>${reaiBadge({ text: 'Saved in ReAI Leads', tone: 'success' })}</td></tr>`);
    }
  } catch (err) {
    return htmlResponse(reaiCallout({ tone: 'danger', title: 'Brreg Prospecting error', body: err instanceof Error ? err.message : 'Failed.' }));
  }
  return errorResponse('Unknown Brreg route.', 404);
}
