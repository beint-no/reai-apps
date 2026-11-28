# Pleo Expenses Import

Route `/app/pleo/`. Docs pages: `web/content/{nb,en}/web-apps/pleo/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developers.pleo.io/docs/current/authentication/standalone-api-keys-overview.md
- https://developers.pleo.io/docs/current/how-tos/api-keys/how-to-generate-standalone-api-keys.md
- https://developers.pleo.io/docs/current/guides/export-integration-workflow-guide.md
- https://developers.pleo.io/reference/export-api/export-api-v3/get-a-list-of-export-jobs.md
- https://developers.pleo.io/reference/export-api/export-items-v3/get-export-items.md
- https://developers.pleo.io/reference/export-api/export-api-v3/update-export-job-items.md
- https://developers.pleo.io/reference/export-api/export-api-v3/create-an-export-job-event.md
- https://developers.pleo.io/reference/export-api/export-api-scopes.md
- https://developers.pleo.io/docs/current/integration-design/exports/integration-design-exports-bookkeeping-method-journal-entry.md

- Mode: fix
- Calls: Standalone API key (Basic auth, key as username) against the documented Level 1 export workflow: GET /v3/export-jobs?statuses=pending&statuses=in_progress (oldest job), GET /v3/export-items?job_id=&limit=100 with cursor pagination (values in cents). Each accountingEntryLines entry becomes a debit on account.code with the ReAI input VAT code matching tax.rate (vat_inclusive, from GET /api/vat-codes), credit to contraAccount.code per item, rows built with pairVoucherRows per item. On book the job is re-read server side, duplicate checked by voucher description, then POST /v3/export-job-events started, PUT /v3/export-jobs/{id}/items in_progress, POST /api/manual-vouchers, PUT items successful (externalId/externalUrl/exportedAt) and event completed; on ReAI failure items and job are reported failed. accounts_payable items are left in Pleo. CSV removed.
- Hosts in code: `developers.pleo.io`, `external.pleo.io`
- Vendor status: pleo.io live and sold; developers.pleo.io current (Export API v3, spec version 33.25.0).

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/manual-vouchers`
- `/api/vat-codes`
- `/api/vouchers`

## Caveats

Standalone API keys are not self service: the customer asks Pleo Support to enable them, then creates the key as Admin or Bookkeeper (docs say so). Pleo's accounting settings may need the custom API integration selected so that Export produces jobs for this key; I could not verify that menu without an account. Only four digit Pleo accounts and NOK wallets are accepted. The page keeps the Pleo key in a hidden form field between preview and book (same pattern as recman). Multi-entity organisations would need company_id, which is not sent. web/test/provider-api.test.mjs still calls the old fetchApi signature for this slug; update or drop that case.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
