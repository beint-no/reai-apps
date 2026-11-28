# Bikedesk Day Close Accounting

Route `/app/bikedesk/`. Docs pages: `web/content/{nb,en}/web-apps/bikedesk/index.md`.

Bikedesk is the bike shop edition of Customers 1st (C1st); the API is the Customers 1st API.

## Vendor API

Current documentation (read before changing any provider call):

- https://api-docs.c1st.com/ (reference)
- https://api-docs.c1st.com/spec.json (OpenAPI 3.0.3, info.version 1.0.0; auth, rate limit and POSBalance schema)
- https://c1st.com/enterprise/developer/
- https://bikedesk.com/no/

- API version: 1.0.0 (single forward-compatible version; breaking changes are announced by email to the API user).
- Auth: `Authorization: Bearer <token>`; the token comes from app.c1st.com → Settings → API → API users.
- Endpoint: `GET https://api.c1st.com/api/posbalances?fromDate=<day> 00:00:00&toDate=<day> 23:59:59&paginationStart=<offset>&paginationPageLength=50&sortField=id&sortOrder=1[&cashRegisterId=]`. Response `{ content, count, hasMore }`; offset paging (max offset 2500), at most 10 pages. Balances are filtered again on `date`.
- Fields read: `id`, `balance_no`, `date`, `paymenttypes[]` (`title`, `amount`, `cash`, `accountno`, `currency`, `giftcardtype`), `totalvatbypercentage[]` (`percentage`, `revenue_incl_vat`, `revenue_account_no`), `giftcardissued`, `cashdifference`. Amounts are decimal major units.
- Rate limit: bucket of 80 requests refilled at 8 per second; one action uses 1 to 10.
- Subrequests: fetch 1 to 10; book 1 to 2 voucher pages, 1 VAT codes, 1 POST.
- Vendor status: Brreg 934670396 C 1ST (NUF of Customers 1st ApS): not konkurs, not under avvikling, no slettedato (2026-11-28). BIKEDESK is declared on Skatteetaten's kassasystem list.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `GET /api/vouchers` (duplicate check on description prefix and date)
- `GET /api/vat-codes`
- `POST /api/manual-vouchers` with `pairVoucherRows`

## Accounting mapping

- Payment types: debit `accountno` when it is a 4-digit account, else `1900` for cash, `2900` for gift cards, `1580` for the rest.
- VAT rates: credit `revenue_incl_vat` on `revenue_account_no` (else `3000`/`3010`/`3020`/`3100`) with the VAT-inclusive output code for the rate.
- `giftcardissued`: credit `2900`.
- A residual below 1 NOK is posted to `7990` (cash rounding); a larger difference blocks booking.
- `cashdifference` is shown, not booked.

## Caveats

No live verification (no credentials). It is not documented whether gift cards sold are also part of `totalvatbypercentage`, nor how customer payments on account and invoice tenders appear in `paymenttypes`; such days do not balance and cannot be booked here. `/financevouchers/{balanceId}` (C1st's own journal export) is not used because it carries no VAT information. Contact: api@c1st.com (spec.json, Help and support).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
