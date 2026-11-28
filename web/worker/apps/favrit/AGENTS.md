# Favrit

Route `/app/favrit/`. Docs pages: `web/content/{nb,en}/web-apps/favrit/index.md`.

## Purpose

Books one Europe/Oslo day of Favrit orderlines for one location as a balanced ReAI review voucher: sales per account reference and VAT rate, refunds, tips.

## Vendor docs

- Getting started (client app): https://support.favrit.com/getting-started-1
- Authentication: https://support.favrit.com/authentication
- Base URLs and scopes: https://support.favrit.com/important-urls-and-models
- Orderline API (in use): https://support.favrit.com/orderline-api-documentation
- Accounting API (deprecated, not used): https://support.favrit.com/accounting-api-documentation
- No changelog; columns are tagged by the version that added them (v4, v5, v6).

## API

- Version: Orderline API `v6` (latest, adds discount columns). Migrated from the settlement based Accounting API, which Favrit marks "will be deprecated in the near future" and points to the Orderline API.
- Auth: Favrit admin → Company Settings → Integration → Developer → Integrate to Favrit, scope `prod/transaction` → ClientId and SecretId. `POST https://accounting-api-auth.favrit.com/oauth2/token`, `Authorization: Basic base64(ClientId:SecretId)`, form `grant_type=client_credentials&scope=prod/transaction`. One token per action.
- Endpoint: `GET https://favrit.com/ws/accounting-api-service/api/orderlines/v6[/{locationId}]?from-date&to-date` (UTC, `yyyy-MM-ddTHH:mm:ss`). Without a location id the all locations path is used, and the user is asked for an id when lines span more than one location.
- Response: `text/csv`, semicolon separated with header; parsed by column name. Lines are kept when `order_line_created_utc` is in the Oslo day (`[start, end)`), de-duplicated by line id, status and counter line id.
- Ranges over 24 hours return nothing, so the 25 hour day at the end of summer time takes two requests.
- No paging and no rate limit documented; `429` with `Retry-After` is shown to the user.

## Subrequest budget

- Preview: token + 1 orderline request (2 on the 25 hour day) = 2 to 3.
- Book: `GET /api/vouchers`, `GET /api/vat-codes`, `POST /api/manual-vouchers` = 3.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/vouchers?startDate&endDate&includeReversed=true` duplicate check on `Favrit location ID NAME YYYY-MM-DD`.
- `GET /api/vat-codes` for output VAT codes per rate.
- `POST /api/manual-vouchers` with `pairVoucherRows` postings.

## Accounting mapping

- REGULAR lines: credit `account_reference` when it is four digits, else 3000/3010/3020/3100 by rate, VAT inclusive with the ReAI `output_vat` code for `vat_percentage` (a fraction in the docs example; values above 1 are read as percent).
- TIP lines: credit 2930 with VAT code 0.
- Debit 1580 for sales plus tips, matched against the payout in the bank, where payment fees are booked.
- Refund and discard lines (negative quantity) reduce sales on the day they are created; a positive amount on a negative quantity is negated.
- Currency from `currency`; one per day, and booking requires it to match the company currency.

## Caveats

- Not documented: whether `amount_with_vat` is the line total (assumed) or unit price, whether refund amounts are negative, how delivery fees appear. Payment fees and payment methods are not in the orderlines.
- Customers with an existing `prod/accounting` client app must create one with `prod/transaction`.

Last verified: 2026-11-28
