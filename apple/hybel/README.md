# ReAI Hybel Journal

Experimental native Mac bridge from a Hybel monthly journal export to a ReAI review voucher. macOS 15 or later, Apple Silicon. Free, open source. Install the signed, notarized DMG from the ReAI Apps site and drag the app to Applications. Updates replace the app; local credentials and checkpoints remain. Remove the app to uninstall, disconnect to delete its Keychain entry, and revoke its access in your ReAI profile.

## Current scope

Hybel documents [CSV journal exports](https://hjelpesenter.hybel.no/knowledge/hvordan-kan-jeg-importere-husleie-forfall-og-innbetalinger-til-mitt-regnskapssystem) and [provider-managed accounting integrations](https://hjelpesenter.hybel.no/knowledge/har-hybel-st%C3%B8tte-for-api-integrasjoner-med-regnskapssystemer). These do not establish an independent Hybel read API or key format. This release uses the ReAI API and a local CSV, with no direct Hybel API connection or automatic synchronization. It is an independent ReAI app, not a Hybel-endorsed integration. A real Hybel export has not yet been verified; header mapping and validation make unsupported files fail before posting.

1. Connect to ReAI in your browser and approve the company, or use a ReAI user API key. Multi-company keys require explicit company selection. Access uses your existing ReAI permissions.
2. In Hybel, open Rapporter and export one complete calendar month's **Bilagsjournal** as CSV. Retain the period report and tenant subledger/SAF-T evidence too. Use an export containing the general-ledger account and amount per line, not a tenant-level subledger-only report. Convert an Excel export to CSV if necessary. No PDF or Excel parsing is included.
3. Open the CSV, enter the organization number printed on the source report, then map date, account, voucher/BatchID, description, signed amount (or separate debit and credit amounts), and VAT code when present. Positive = debit, negative = credit. Dates: yyyy-MM-dd, dd.MM.yyyy or dd/MM/yyyy. UTF-8 and Windows-1252, comma or semicolon separated, quoted fields supported. Up to 10 MB / 5,000 lines.
4. Validate. All date/reference groups must balance. Only NOK and VAT code 0 are supported. Account numbers must exist and be usable in the selected company. Bank accounts must resolve to exactly one active NOK account. Customer/supplier/employee/general/asset subsidiary accounts require a different import path. This version does not reproduce customer invoices, credit notes, projects, departments, settlements or tenant-level ledger closures. Do not use files whose omitted dimensions matter.
5. Review every line, confirm ownership, completeness, VAT treatment, absence of previous booking and retention of evidence. Create the review voucher. A second confirmation names the target company. The app preserves source dates/references, pairs related debit/credit postings, and flags the voucher for an accountant.
6. Open the voucher in ReAI and attach the original journal and period report before clearing review. Reconcile bank entries without booking them again. The app does not send invoices, make/approve payments or close a period.

## Recovery and storage

The app checks the selected company's voucher history for its company/month marker before writing. A private checkpoint is saved **before** POST in `~/Library/Application Support/ReAIHybelJournal/<tenant>-<month>.json`, with fingerprint and successful voucher ID. A timeout or failed read-back never causes an automatic retry. Revalidation reports an existing server voucher or blocks on the checkpoint. An accountant must inspect actual server history, including reversed entries, before deciding whether a failed attempt is safe to retry; do not delete a checkpoint merely because a response failed. Multiple concurrent installations can still race: use one operator per company/month. Earlier bookings made outside the app must be checked separately.

ReAI credentials stay in macOS Keychain under `no.reai.hybeljournal`. CSV contents remain in memory; original files are not modified. The app sends only the validated journal to `https://app.reai.no` over HTTPS, with company context on every scoped request. There is no analytics or background accounting job.

## Development

From the repository root: `tools/apple/build.py hybel`. Never distribute an ad-hoc build. Merge reviewed changes and use the shared **Release app** action on main to sign, notarize and publish. No third-party Swift packages are used.
