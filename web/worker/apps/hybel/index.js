// @ts-check
import { readSession, renderConnectPanel } from '../../lib/auth.js';
import { html, htmlResponse } from '../../lib/html.js';
import { HttpError, errorResponse, requireSameOrigin } from '../../lib/http.js';
import { reaiAll, reaiOrigin, reaiRequest } from '../../lib/reai.js';
import { pairVoucherRows } from '../../lib/voucher-rows.js';
import { appShell, reaiBadge, reaiCallout, reaiCard, reaiDropzone, reaiMetric } from '../../lib/ui.js';
import {
  SAMPLE_HYBEL_CSV,
  buildJournal,
  decodeCsvBytes,
  formatNok,
  guessColumnMap,
  parseCsv,
} from './journal.js';

const SUBSIDIARY_RESTRICTED_ACCOUNTS = new Set(['1500', '2400', '2910']);

/**
 * @param {string} month
 * @returns {string}
 */
function monthEnd(month) {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const m = Number(monthStr);
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * Builds ReAI postings: each Hybel source entry (date + reference) is paired on its own with
 * `pairVoucherRows`, so voucher rows never mix two Hybel entries. All lines use VAT code 0, which the
 * ReAI contract prescribes for non-VAT postings (residential rent is outside VAT).
 * @param {import('./journal.js').ParsedEntry[]} entries
 * @param {Record<string, number>} bankAccounts
 */
export function buildReaiPostings(entries, bankAccounts) {
  /** @type {Map<string, import('./journal.js').ParsedEntry[]>} */
  const groups = new Map();
  for (const entry of entries) {
    const key = `${entry.date}|${entry.reference}`;
    const list = groups.get(key);
    if (list) {
      list.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }
  /** @type {Array<Record<string, unknown>>} */
  const postings = [];
  let rowOffset = 0;
  for (const key of [...groups.keys()].sort()) {
    const rows = groups.get(key) ?? [];
    const ref = rows[0]?.reference ?? '';
    const paired = pairVoucherRows(rows.map((entry) => ({
      accountNumber: entry.account,
      postingDate: entry.date,
      currencyCode: 'NOK',
      amount: entry.minor / 100,
      vatCode: '0',
      description: entry.description,
      ...(bankAccounts[entry.account] !== undefined ? { companyBankId: bankAccounts[entry.account] } : {}),
    })));
    /** @type {Map<number, string[]>} */
    const descByRow = new Map();
    for (const p of paired) {
      const list = descByRow.get(p.rowNumber) ?? [];
      for (const part of p.description.split(' / ')) if (part && !list.includes(part)) list.push(part);
      descByRow.set(p.rowNumber, list);
    }
    for (const p of paired) {
      postings.push({
        ...p,
        amount: Number(p.amount.toFixed(2)),
        rowNumber: rowOffset + p.rowNumber,
        description: `Hybel ${ref}: ${(descByRow.get(p.rowNumber) ?? []).sort().join(' / ')}`.slice(0, 1000),
      });
    }
    rowOffset += paired.length / 2;
  }
  return postings;
}

/** Up to this many account prefixes per chart-of-accounts lookup (limit is capped at 100 accounts). */
const ACCOUNT_PREFIX_BATCH = 20;

/**
 * @param {import('../../lib/types.d.ts').Env} env
 * @param {import('../../lib/types.d.ts').SessionData} session
 * @param {{ sourceOrganization: string, journal: import('./journal.js').ParsedJournal }} input
 */
async function validateAgainstReai(env, session, input) {
  const { sourceOrganization, journal } = input;
  if (!/^[0-9]{9}$/.test(sourceOrganization)) {
    throw new HttpError(400, 'Enter the 9-digit Norwegian organization number shown on the Hybel report.');
  }
  const company = session.tenants.find((t) => t.id === session.tenantId);
  if (!company) {
    throw new HttpError(400, 'Select a ReAI company in the connection card above before validating.');
  }
  const settings = /** @type {import('../../lib/types.d.ts').CompanySettings} */ (
    await reaiRequest(env, '/api/company-settings', {
      token: session.accessToken,
      tenantId: company.id,
    })
  );
  if (company.currencyCode !== 'NOK' || settings.company.organizationNumber !== sourceOrganization) {
    throw new HttpError(
      400,
      'Source organization number must match the selected Norwegian NOK company in ReAI.',
    );
  }

  const uniqueAccounts = [...new Set(journal.entries.map((e) => e.account))].sort();
  /** @type {string[][]} */
  const prefixBatches = [];
  for (let i = 0; i < uniqueAccounts.length; i += ACCOUNT_PREFIX_BATCH) prefixBatches.push(uniqueAccounts.slice(i, i + ACCOUNT_PREFIX_BATCH));
  const [accountBatches, availableBanks] = await Promise.all([
    Promise.all(
      prefixBatches.map((batch) => {
        const qs = new URLSearchParams(batch.map((n) => ['accountNumberPrefix', n]));
        qs.set('limit', '100');
        return reaiRequest(env, `/api/chart-of-accounts/accounts?${qs}`, {
          token: session.accessToken,
          tenantId: company.id,
        });
      }),
    ),
    reaiRequest(env, '/api/company-banks', {
      token: session.accessToken,
      tenantId: company.id,
    }),
  ]);

  const accounts = /** @type {import('../../lib/types.d.ts').LedgerAccount[]} */ (accountBatches.flat());
  // A batch that hit the 100-account cap may have cut off some prefixes; look those up one by one.
  const capped = prefixBatches.filter((_, i) => (/** @type {unknown[]} */ (accountBatches[i])).length >= 100).flat()
    .filter((n) => !accounts.some((a) => a.accountNumber === n));
  for (const n of capped) {
    accounts.push(...(/** @type {import('../../lib/types.d.ts').LedgerAccount[]} */ (await reaiRequest(env, '/api/chart-of-accounts/accounts', {
      token: session.accessToken,
      tenantId: company.id,
      query: { accountNumberPrefix: n, limit: '100' },
    }))));
  }
  const banks = /** @type {import('../../lib/types.d.ts').CompanyBank[]} */ (availableBanks);
  /** @type {Record<string, number>} */
  const bankAccounts = {};

  for (const accountNumber of uniqueAccounts) {
    const matches = accounts.filter((a) => a.accountNumber === accountNumber);
    if (!matches.some((a) => !a.restrictedToSystemUsage)) {
      throw new HttpError(400, `Account ${accountNumber} is missing or restricted in ReAI.`);
    }
    const subsidiaries = matches.map((a) => a.subsidiaryLedger).filter((s) => s !== null);
    if (subsidiaries.some((s) => s.type !== 'bank') || SUBSIDIARY_RESTRICTED_ACCOUNTS.has(accountNumber)) {
      throw new HttpError(
        400,
        `Account ${accountNumber} requires a subsidiary ledger. Use Hybel's general-ledger export and keep tenant detail in Hybel.`,
      );
    }
    if (accountNumber.startsWith('19') || subsidiaries.some((s) => s.type === 'bank')) {
      const bankMatches = banks.filter(
        (b) => b.ledgerAccountNumber === accountNumber && !b.archived && b.currencyCode === 'NOK',
      );
      if (bankMatches.length !== 1 || !bankMatches[0]) {
        throw new HttpError(400, `Account ${accountNumber} must match exactly one active NOK bank account in ReAI.`);
      }
      bankAccounts[accountNumber] = bankMatches[0].id;
    }
  }

  const marker = `Hybel journal ${sourceOrganization} ${journal.month}`;
  const vouchers = /** @type {import('../../lib/types.d.ts').VoucherSummary[]} */ (
    await reaiAll(env, '/api/vouchers', {
      token: session.accessToken,
      tenantId: company.id,
      query: {
        startDate: `${journal.month}-01`,
        endDate: monthEnd(journal.month),
        includeReversed: 'true',
      },
    })
  );
  const existing = vouchers.find((v) => typeof v.description === 'string' && v.description.startsWith(marker)) ?? null;
  return {
    companyId: company.id,
    companyName: settings.company.name,
    organizationNumber: sourceOrganization,
    marker,
    bankAccounts,
    existingVoucher: existing
      ? {
          id: existing.id,
          number: existing.number,
          url: `${reaiOrigin(env)}/voucher/${existing.id}?tenantId=${company.id}`,
        }
      : null,
  };
}

/**
 * @param {string} name
 * @param {string} label
 * @param {string[]} headers
 * @param {number} selected
 */
function columnSelect(name, label, headers, selected) {
  return html`<div class="field">
    <label for="col-${name}">${label}</label>
    <select id="col-${name}" name="col_${name}">
      <option value="-1"${selected < 0 ? html` selected` : ''}>— Not mapped —</option>
      ${headers.map(
        (h, i) => html`<option value="${i}"${i === selected ? html` selected` : ''}>${h || `Column ${i + 1}`}</option>`,
      )}
    </select>
  </div>`;
}

/**
 * Renders the HTMX workspace fragment after parsing a CSV (sample or uploaded).
 * @param {{ filename: string, csvText: string, csv: import('./journal.js').CsvDocument, map: import('./journal.js').ColumnMap, journal: import('./journal.js').ParsedJournal | null, error?: string, isSample?: boolean }} state
 */
function renderWorkspace(state) {
  const { filename, csvText, csv, map, journal, error, isSample } = state;
  return html`
    ${reaiCard({
      eyebrow: 'STEP 2 · COLUMN MAPPING',
      title: filename,
      badge: isSample
        ? reaiBadge({ text: 'Synthetic sample', tone: 'accent' })
        : reaiBadge({ text: `${csv.rows.length} CSV rows`, tone: 'neutral' }),
      body: html`
        <form class="stack" hx-post="/app/hybel/parse" hx-target="#hybel-workspace" hx-swap="innerHTML">
          <input type="hidden" name="filename" value="${filename}">
          <input type="hidden" name="csvText" value="${csvText}">
          ${isSample ? html`<input type="hidden" name="isSample" value="1">` : ''}
          <div class="mapping-grid">
            ${columnSelect('date', 'Date *', csv.headers, map.date)}
            ${columnSelect('account', 'Account *', csv.headers, map.account)}
            ${columnSelect('reference', 'Voucher / BatchID *', csv.headers, map.reference)}
            ${columnSelect('amount', 'Signed amount', csv.headers, map.amount)}
            ${columnSelect('debit', 'Debit (if split)', csv.headers, map.debit)}
            ${columnSelect('credit', 'Credit (if split)', csv.headers, map.credit)}
            ${columnSelect('description', 'Description', csv.headers, map.description)}
            ${columnSelect('vat', 'VAT code', csv.headers, map.vat)}
          </div>
          <div class="inline-row">
            <button type="submit" class="button secondary">Re-validate mapping</button>
            <span class="muted-note">Only NOK general-ledger lines with VAT code 0 are accepted.</span>
          </div>
        </form>
      `,
    })}

    ${error
      ? reaiCallout({ tone: 'danger', title: 'Validation failed', body: error })
      : ''}

    ${journal
      ? html`
        ${reaiCard({
          eyebrow: 'STEP 3 · BALANCED JOURNAL PREVIEW',
          title: `Month ${journal.month}`,
          badge: reaiBadge({ text: 'Balanced (0.00 diff)', tone: 'success' }),
          body: html`
            <div class="metric-grid">
              ${reaiMetric({ label: 'Period', value: journal.month, detail: `Last date ${journal.lastDate}` })}
              ${reaiMetric({ label: 'Postings', value: String(journal.entries.length), detail: `${journal.groupCount} source references` })}
              ${reaiMetric({ label: 'Total debit / credit', value: `${formatNok(journal.debitMinor)} NOK`, detail: 'Every reference balances' })}
            </div>
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Account</th>
                    <th>Reference</th>
                    <th>Description</th>
                    <th class="num">Debit</th>
                    <th class="num">Credit</th>
                  </tr>
                </thead>
                <tbody>
                  ${journal.entries.slice(0, 200).map(
                    (e) => html`<tr>
                      <td class="mono">${e.date}</td>
                      <td class="mono">${e.account}</td>
                      <td class="mono">${e.reference}</td>
                      <td>${e.description}</td>
                      <td class="num">${e.minor > 0 ? formatNok(e.minor) : ''}</td>
                      <td class="num">${e.minor < 0 ? formatNok(-e.minor) : ''}</td>
                    </tr>`,
                  )}
                </tbody>
              </table>
            </div>
            ${journal.entries.length > 200
              ? html`<p class="muted-note">Showing first 200 of ${journal.entries.length} validated postings.</p>`
              : ''}
            <p class="fingerprint">SHA-256 trail: <code>${journal.fingerprint}</code></p>
          `,
        })}

        ${reaiCard({
          eyebrow: 'STEP 4 · VALIDATE & BOOK IN REAI',
          title: 'Verify company & accounts',
          body: html`
            <form class="stack" hx-post="/app/hybel/validate" hx-target="#hybel-booking" hx-swap="innerHTML">
              <input type="hidden" name="csvText" value="${csvText}">
              <input type="hidden" name="col_date" value="${map.date}">
              <input type="hidden" name="col_account" value="${map.account}">
              <input type="hidden" name="col_reference" value="${map.reference}">
              <input type="hidden" name="col_amount" value="${map.amount}">
              <input type="hidden" name="col_debit" value="${map.debit}">
              <input type="hidden" name="col_credit" value="${map.credit}">
              <input type="hidden" name="col_description" value="${map.description}">
              <input type="hidden" name="col_vat" value="${map.vat}">
              <div class="inline-row">
                <div class="field">
                  <label for="hybel-orgnr">Source report organization number (9 digits)</label>
                  <input id="hybel-orgnr" name="sourceOrganization" type="text" inputmode="numeric" pattern="[0-9]{9}" maxlength="9" required placeholder="999888777">
                </div>
                <button type="submit" class="button primary">Validate against ReAI</button>
              </div>
              <p class="muted-note">Checks company org number, chart of accounts, active NOK bank accounts and existing vouchers before allowing booking.</p>
            </form>
            <div id="hybel-booking" class="stack-sm"></div>
          `,
        })}
      `
      : ''}
  `;
}

/**
 * @param {FormData} form
 * @param {string[]} headers
 * @returns {import('./journal.js').ColumnMap}
 */
function readColumnMap(form, headers) {
  const hasExplicit = form.has('col_date');
  if (!hasExplicit) {
    return guessColumnMap(headers);
  }
  /** @param {string} key */
  const num = (key) => {
    const raw = form.get(`col_${key}`);
    const parsed = typeof raw === 'string' ? Number(raw) : -1;
    return Number.isInteger(parsed) && parsed >= 0 && parsed < headers.length ? parsed : -1;
  };
  return {
    date: num('date'),
    account: num('account'),
    reference: num('reference'),
    amount: num('amount'),
    debit: num('debit'),
    credit: num('credit'),
    description: num('description'),
    vat: num('vat'),
  };
}

/**
 * Handles /app/hybel/* SSR and HTMX routes.
 * @param {Request} request
 * @param {import('../../lib/types.d.ts').Env} env
 * @returns {Promise<Response>}
 */
export async function handleHybel(request, env) {
  const { pathname } = new URL(request.url);

  if (pathname === '/app/hybel' && (request.method === 'GET' || request.method === 'HEAD')) {
    return Response.redirect(new URL('/app/hybel/', request.url), 301);
  }

  if (pathname === '/app/hybel/' && (request.method === 'GET' || request.method === 'HEAD')) {
    const session = await readSession(env, request);
    const body = html`
      <section class="app-intro">
        <p class="eyebrow">REAL ESTATE & RENTALS · EXPERIMENTAL</p>
        <h1>Hybel Journal</h1>
        <p class="lead">Preview a monthly Hybel CSV journal, verify every account and reference against ReAI, and create one balanced voucher flagged for accountant review.</p>
      </section>

      <div class="stack">
        ${renderConnectPanel(session, { clientId: 'reai-hybel-web', clientName: 'ReAI Hybel Journal (Web)' })}

        ${reaiCard({
          eyebrow: 'STEP 1 · LOAD JOURNAL CSV',
          title: 'Upload Hybel Bilagsjournal',
          body: html`
            <form class="stack-sm" hx-post="/app/hybel/parse" hx-encoding="multipart/form-data" hx-target="#hybel-workspace" hx-swap="innerHTML">
              ${reaiDropzone({
                inputId: 'hybel-csv-file',
                name: 'file',
                accept: '.csv,text/csv,text/plain',
                label: 'Choose Hybel CSV',
                hint: 'Drop a UTF-8 or Windows-1252 CSV file here (up to 10 MB, semicolon or comma separated).',
              })}
              <div class="inline-row">
                <button type="submit" class="button secondary">Parse uploaded file</button>
                <button type="button" class="button secondary" hx-post="/app/hybel/sample" hx-target="#hybel-workspace" hx-swap="innerHTML">Load synthetic sample CSV</button>
              </div>
            </form>
          `,
        })}

        <div id="hybel-workspace" class="stack"></div>
      </div>
    `;
    return htmlResponse(
      appShell({
        title: 'Hybel Journal',
        description: 'Validate a monthly Hybel CSV journal and create a review voucher in ReAI.',
        activePath: '/app/hybel/',
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

  if (pathname === '/app/hybel/sample') {
    const csv = parseCsv(SAMPLE_HYBEL_CSV);
    const map = guessColumnMap(csv.headers);
    const journal = await buildJournal(csv, map);
    return htmlResponse(
      renderWorkspace({
        filename: 'hybel-sample-2026-10.csv',
        csvText: SAMPLE_HYBEL_CSV,
        csv,
        map,
        journal,
        isSample: true,
      }),
    );
  }

  if (pathname === '/app/hybel/parse') {
    const form = await request.formData();
    const file = form.get('file');
    let csvText = '';
    let filename = 'journal.csv';
    const isSample = form.get('isSample') === '1';

    if (file && typeof file === 'object' && 'arrayBuffer' in file && file.size > 0) {
      filename = file.name || 'journal.csv';
      csvText = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
    } else if (typeof form.get('csvText') === 'string' && String(form.get('csvText')).trim() !== '') {
      csvText = String(form.get('csvText'));
      const givenName = form.get('filename');
      if (typeof givenName === 'string' && givenName.trim()) {
        filename = givenName.trim();
      }
    } else {
      return htmlResponse(
        reaiCallout({ tone: 'warn', title: 'No file selected', body: 'Choose a Hybel CSV file or load the synthetic sample CSV.' }),
      );
    }

    try {
      const csv = parseCsv(csvText);
      const map = readColumnMap(form, csv.headers);
      try {
        const journal = await buildJournal(csv, map);
        return htmlResponse(renderWorkspace({ filename, csvText, csv, map, journal, isSample }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not validate journal rows.';
        return htmlResponse(renderWorkspace({ filename, csvText, csv, map, journal: null, error: message, isSample }));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not parse CSV file.';
      return htmlResponse(reaiCallout({ tone: 'danger', title: 'Could not read CSV', body: message }));
    }
  }

  if (pathname === '/app/hybel/validate' || pathname === '/app/hybel/voucher') {
    try {
      const session = await readSession(env, request);
      if (!session) {
        throw new HttpError(401, 'Connect to ReAI above before validating or booking.');
      }
      const form = await request.formData();
      const csvText = typeof form.get('csvText') === 'string' ? String(form.get('csvText')) : '';
      const sourceOrganization =
        typeof form.get('sourceOrganization') === 'string' ? String(form.get('sourceOrganization')).trim() : '';
      if (!csvText) {
        throw new HttpError(400, 'Missing CSV content. Re-upload or load the sample journal.');
      }
      const csv = parseCsv(csvText);
      const map = readColumnMap(form, csv.headers);
      const journal = await buildJournal(csv, map);
      const check = await validateAgainstReai(env, session, { sourceOrganization, journal });

      if (check.existingVoucher) {
        return htmlResponse(
          reaiCallout({
            tone: 'warn',
            title: `Already exists in ReAI (${check.existingVoucher.number})`,
            body: html`A voucher for <strong>${check.companyName}</strong> (${journal.month}) already exists. Review it in ReAI instead of importing again: <a href="${check.existingVoucher.url}" target="_blank" rel="noopener">Open voucher ${check.existingVoucher.number} ↗</a>.`,
          }),
        );
      }

      if (pathname === '/app/hybel/validate') {
        return htmlResponse(html`
          ${reaiCallout({
            tone: 'success',
            title: `Validated against ${check.companyName}`,
            body: `Matched org.nr ${check.organizationNumber}, verified all general-ledger and NOK bank accounts, and found no existing voucher for ${journal.month}. Confirm the four checks below to create the review voucher.`,
          })}
          <form class="stack-sm confirm-box" hx-post="/app/hybel/voucher" hx-target="#hybel-booking" hx-swap="innerHTML">
            <input type="hidden" name="csvText" value="${csvText}">
            <input type="hidden" name="sourceOrganization" value="${sourceOrganization}">
            <input type="hidden" name="col_date" value="${map.date}">
            <input type="hidden" name="col_account" value="${map.account}">
            <input type="hidden" name="col_reference" value="${map.reference}">
            <input type="hidden" name="col_amount" value="${map.amount}">
            <input type="hidden" name="col_debit" value="${map.debit}">
            <input type="hidden" name="col_credit" value="${map.credit}">
            <input type="hidden" name="col_description" value="${map.description}">
            <input type="hidden" name="col_vat" value="${map.vat}">
            <label class="check-row"><input type="checkbox" name="c_company" required> I confirm the target company is <strong>${check.companyName}</strong> (${check.organizationNumber}).</label>
            <label class="check-row"><input type="checkbox" name="c_source" required> I will attach the original Hybel journal and period report to the voucher in ReAI.</label>
            <label class="check-row"><input type="checkbox" name="c_vat" required> I confirm all lines are NOK with VAT code 0 and tenant subledgers remain in Hybel.</label>
            <label class="check-row"><input type="checkbox" name="c_not_booked" required> I confirm ${journal.month} has not already been booked manually in ReAI.</label>
            <div>
              <button type="submit" class="button primary">Create review voucher in ReAI</button>
            </div>
          </form>
        `);
      }

      if (
        form.get('c_company') !== 'on' ||
        form.get('c_source') !== 'on' ||
        form.get('c_vat') !== 'on' ||
        form.get('c_not_booked') !== 'on'
      ) {
        throw new HttpError(400, 'Confirm all four checklist items before creating the voucher.');
      }

      const created = /** @type {import('../../lib/types.d.ts').VoucherSummary} */ (
        await reaiRequest(env, '/api/manual-vouchers', {
          token: session.accessToken,
          tenantId: check.companyId,
          method: 'POST',
          body: {
            date: journal.lastDate,
            description: `${check.marker} sha256:${journal.fingerprint}`,
            reviewReason:
              'Check the attached Hybel journal/period report, BatchIDs, cutoff, bank entries and VAT code 0. Tenant-level subledger remains in Hybel. Attach source documentation before clearing review.',
            postings: buildReaiPostings(journal.entries, check.bankAccounts),
          },
        })
      );
      const voucherUrl = `${reaiOrigin(env)}/voucher/${created.id}?tenantId=${check.companyId}`;
      return htmlResponse(
        reaiCallout({
          tone: 'success',
          title: `Created review voucher ${created.number}`,
          body: html`Voucher flagged for accountant review in <strong>${check.companyName}</strong>. Attach the original Hybel PDF/CSV reports before clearing review: <a href="${voucherUrl}" target="_blank" rel="noopener">Open voucher ${created.number} in ReAI ↗</a>.`,
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Validation failed.';
      return htmlResponse(reaiCallout({ tone: 'danger', title: 'Could not complete ReAI check', body: message }));
    }
  }

  return errorResponse('Unknown Hybel route.', 404);
}
