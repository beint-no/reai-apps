# ExtendaGO

Route `/app/extendago/`. Docs pages: `web/content/{nb,en}/web-apps/extendago/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://www.extendago.com/wp-content/uploads/sites/3/2023/05/gbat10-mapping.pdf
- https://www.extendago.com/wp-content/uploads/sites/3/2025/01/extendago-x-sharespine-accounting-integration-guide.pdf
- https://www.extendago.com/faq/which-checkout-scales-are-compatible-with-extendago/

- Mode: csv
- Calls: Upload of the documented GBAT10 file that ExtendaGO delivers nightly to SFTP (Settings → Integrations → Accounting). parseGbat10 reads columns 1, 2, 6, 7, 8, 20, 24; sign taken from tender lines; revenue posted VAT inclusive with the VAT code from the file validated against GET /api/vat-codes; pairVoucherRows; duplicate check. API fetch removed.
- Hosts in code: `www.extendago.com`
- Vendor status: Brreg: no flags. extendago.com live with current self-help guides (2026 uploads).

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/manual-vouchers`
- `/api/vat-codes`
- `/api/vouchers`

## Caveats

The GO POS API exists but its documentation is only given on request via extendago@extendaretail.com after a plan review, so it was not used. The mapping PDF says tenders are negative and revenue positive; the parser detects the sign from tender lines in case files use the opposite convention. The customer must configure ReAI output VAT codes (for example 3, 31, 33) in ExtendaGO. fetchApi export removed, so web/test/provider-api.test.mjs now fails at import ('does not provide an export named fetchApi'); the coordinator must drop that import and its assertions. Module still imports decodeCsvBytes from ./hybel-journal.js.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
