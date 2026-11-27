// @ts-check
import { readSession, renderConnectPanel } from '../lib/auth.js';
import { html, htmlResponse } from '../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../lib/reai.js';
import { currentMonthIso, loadActiveBanks, loadPendingBankTransactions, monthBounds } from '../lib/reconcile.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiMetric } from '../lib/ui.js';

/**
 * @typedef {{ label: string, tone: 'success' | 'warn' | 'danger' | 'neutral', summary: string, actionUrl?: string, actionLabel?: string }} CheckItem
 */

/**
 * @param {{ companyName: string, orgnr: string, month: string, locked: boolean, pendingBankTotal: number, needsReviewCount: number, waitingClientCount: number, supplierTasksCount: number, checks: CheckItem[], isSample?: boolean }} data
 */
function renderReport(data) {
  const ready = data.pendingBankTotal === 0 && data.needsReviewCount === 0 && data.supplierTasksCount === 0;
  return html`
    ${reaiCard({
      eyebrow: 'MONTH-END CLOSE SUMMARY',
      title: `${data.companyName} · ${data.month}`,
      badge: data.isSample
        ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' })
        : reaiBadge({ text: data.locked ? 'Period locked' : ready ? 'Ready to close' : 'Items need attention', tone: data.locked || ready ? 'success' : 'warn' }),
      body: html`
        <div class="metric-grid">
          ${reaiMetric({ label: 'Period lock', value: data.locked ? 'Locked' : 'Open', detail: data.orgnr ? `Org.nr ${data.orgnr}` : 'Accounting period status' })}
          ${reaiMetric({ label: 'Pending bank rows', value: String(data.pendingBankTotal), detail: 'Across active bank accounts' })}
          ${reaiMetric({ label: 'Vouchers in review', value: String(data.needsReviewCount + data.waitingClientCount), detail: `${data.needsReviewCount} needs review · ${data.waitingClientCount} waiting` })}
          ${reaiMetric({ label: 'Supplier tasks', value: String(data.supplierTasksCount), detail: 'Overdue or awaiting payment' })}
        </div>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Check</th>
                <th>Status</th>
                <th>Summary</th>
                <th>Link</th>
              </tr>
            </thead>
            <tbody>
              ${data.checks.map(
                (c) => html`<tr>
                  <td><strong>${c.label}</strong></td>
                  <td>${reaiBadge({ text: c.tone === 'success' ? 'Clear' : c.tone === 'warn' ? 'Review' : 'Action', tone: c.tone })}</td>
                  <td>${c.summary}</td>
                  <td>${c.actionUrl ? html`<a href="${c.actionUrl}" target="_blank" rel="noopener">${c.actionLabel ?? 'Open in ReAI'} ↗</a>` : '—'}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>
      `,
    })}
  `;
}

/**
 * Handles /app/close-check/* — read-only Month-End Close Checker exercising 6 ReAI Public APIs in parallel.
 * @param {Request} request
 * @param {import('../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handleCloseCheck(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === '/app/close-check' && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL('/app/close-check/', request.url), 301);
  }

  if (pathname === '/app/close-check/' && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const defaultMonth = currentMonthIso();
    const body = html`
      <section class="app-intro">
        <p class="eyebrow">OPERATIONS · READ-ONLY PUBLIC API CHECK</p>
        <h1>Month-End Close Checker</h1>
        <p class="lead">Inspect accounting period locks, pending bank transactions, manual vouchers awaiting review and open supplier-invoice follow-up tasks in one parallel scan.</p>
      </section>

      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-close-check-web', clientName: 'ReAI Close Checker (Web)' })}

        ${reaiCard({
          eyebrow: 'RUN CHECKLIST',
          title: 'Select closing month',
          body: html`
            <form class="inline-row" hx-post="/app/close-check/run" hx-target="#close-check-output" hx-swap="innerHTML">
              <div class="field">
                <label for="close-month">Month (YYYY-MM)</label>
                <input id="close-month" name="month" type="text" pattern="[0-9]{4}-[0-9]{2}" value="${defaultMonth}" required>
              </div>
              <button type="submit" class="button primary">Run month-end check</button>
              <button type="button" class="button secondary" hx-post="/app/close-check/sample" hx-target="#close-check-output" hx-swap="innerHTML">Load sample report</button>
            </form>
            <p class="muted-note">Read-only: calls <code>/api/company-settings</code>, <code>/api/accounting-periods</code>, <code>/api/company-banks</code>, <code>/api/bank-reconciliations</code>, <code>/api/vouchers</code> and <code>/api/supplier-invoices/tasks</code>.</p>
          `,
        })}

        <div id="close-check-output" class="stack"></div>
      </div>
    `;
    return htmlResponse(
      appShell({
        title: 'Month-End Close Checker',
        description: 'Read-only month-end close checklist across ReAI bank, voucher and supplier APIs.',
        activePath: '/app/close-check/',
        body,
      }),
    );
  }

  if (request.method !== 'POST') {
    return errorResponse('Method not allowed.', 405);
  }
  const originError = requireSameOrigin(request);
  if (originError) {
    return originError;
  }

  if (pathname === '/app/close-check/sample') {
    return htmlResponse(
      renderReport({
        companyName: 'Fjord Eiendom AS',
        orgnr: '935606403',
        month: '2026-10',
        locked: false,
        pendingBankTotal: 2,
        needsReviewCount: 1,
        waitingClientCount: 0,
        supplierTasksCount: 3,
        isSample: true,
        checks: [
          { label: 'Accounting period lock', tone: 'warn', summary: '2026-10 is open for posting.' },
          { label: 'Bank reconciliation (Driftskonto 1920)', tone: 'warn', summary: '2 pending bank transactions remain in 2026-10.' },
          { label: 'Manual voucher review queue', tone: 'warn', summary: '1 voucher flagged needs_review (0 waiting_for_client).' },
          { label: 'Supplier invoice follow-up tasks', tone: 'warn', summary: '3 registered supplier invoices are overdue or awaiting payment approval.' },
        ],
      }),
    );
  }

  if (pathname === '/app/close-check/run') {
    try {
      const session = await readSession(env, request);
      if (!session || session.tenantId <= 0) {
        throw new HttpError(401, 'Connect to ReAI and choose a company above first.');
      }
      const form = await request.formData();
      const bounds = monthBounds(String(form.get('month') ?? '').trim());
      const origin = reaiOrigin(env);
      const tenantId = session.tenantId;

      const [settings, periods, banks, needsReview, waitingClient, supplierTasks] = await Promise.all([
        reaiRequest(env, '/api/company-settings', { token: session.accessToken, tenantId }),
        reaiRequest(env, '/api/accounting-periods', { token: session.accessToken, tenantId }).catch(() => []),
        loadActiveBanks(env, session).catch(() => []),
        reaiAll(env, '/api/vouchers', { token: session.accessToken, tenantId, query: { reviewStatus: 'needs_review' } }).catch(() => []),
        reaiAll(env, '/api/vouchers', { token: session.accessToken, tenantId, query: { reviewStatus: 'waiting_for_client' } }).catch(() => []),
        reaiRequest(env, '/api/supplier-invoices/tasks', { token: session.accessToken, tenantId }).catch(() => []),
      ]);

      const bankChecks = await Promise.all(
        banks.map(async (bank) => {
          const pending = await loadPendingBankTransactions(env, session, bank.id, bounds.month).catch(() => []);
          return { bank, pendingCount: pending.length };
        }),
      );

      const companySettings = /** @type {import('../lib/types.d.ts').CompanySettings} */ (settings);
      const periodList = /** @type {Array<{ startDate: string, endDate: string }>} */ (periods);
      const locked = periodList.some((p) => p.startDate <= bounds.start && p.endDate >= bounds.lastDay);
      const pendingBankTotal = bankChecks.reduce((sum, b) => sum + b.pendingCount, 0);
      const supplierList = Array.isArray(supplierTasks) ? supplierTasks : [];

      /** @type {CheckItem[]} */
      const checks = [
        {
          label: 'Accounting period lock',
          tone: locked ? 'success' : 'warn',
          summary: locked ? `${bounds.month} is covered by an accounting period lock.` : `${bounds.month} is currently open for posting.`,
          actionUrl: `${origin}/settings?tenantId=${tenantId}`,
          actionLabel: 'Period settings',
        },
        ...bankChecks.map((b) => ({
          label: `Bank reconciliation (${b.bank.displayName})`,
          tone: /** @type {'success' | 'warn'} */ (b.pendingCount === 0 ? 'success' : 'warn'),
          summary:
            b.pendingCount === 0
              ? `No pending bank transactions in ${bounds.month}.`
              : `${b.pendingCount} pending bank transaction${b.pendingCount === 1 ? '' : 's'} in ${bounds.month}.`,
          actionUrl: `${origin}/bank?tenantId=${tenantId}`,
          actionLabel: 'Open bank',
        })),
        {
          label: 'Voucher review queue',
          tone: needsReview.length === 0 && waitingClient.length === 0 ? 'success' : 'warn',
          summary: `${needsReview.length} needs_review · ${waitingClient.length} waiting_for_client across the company.`,
          actionUrl: `${origin}/vouchers?tenantId=${tenantId}`,
          actionLabel: 'Review vouchers',
        },
        {
          label: 'Supplier invoice follow-up tasks',
          tone: supplierList.length === 0 ? 'success' : 'warn',
          summary:
            supplierList.length === 0
              ? 'No overdue or unapproved supplier invoice tasks.'
              : `${supplierList.length} supplier invoice${supplierList.length === 1 ? '' : 's'} need payment or approval.`,
          actionUrl: `${origin}/supplier-invoice?tenantId=${tenantId}`,
          actionLabel: 'Supplier invoices',
        },
      ];

      return htmlResponse(
        renderReport({
          companyName: companySettings.company.name,
          orgnr: companySettings.company.organizationNumber ?? '',
          month: bounds.month,
          locked,
          pendingBankTotal,
          needsReviewCount: needsReview.length,
          waitingClientCount: waitingClient.length,
          supplierTasksCount: supplierList.length,
          checks,
        }),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Close check failed.';
      return htmlResponse(reaiCallout({ tone: 'danger', title: 'Could not run close check', body: msg }));
    }
  }

  return errorResponse('Unknown close-check route.', 404);
}
