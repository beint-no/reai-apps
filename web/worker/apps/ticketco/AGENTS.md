# TicketCo

Route `/app/ticketco/`. Docs pages: `web/content/{nb,en}/web-apps/ticketco/index.md`.

Turns TicketCo item gross transactions for a period (optionally one event) into one balanced ReAI review voucher.

## Vendor docs

- Reference (Swagger 2.0 JSON): https://apidoc.ticketco.events/api/v1/public?env=Production
- Access and token: https://ticketco.io/en/support/accessing-and-testing-the-ticketco-public-api
- Changelog: none published. The Swagger is "Ticketco public API" version 1.0.0; no deprecation notices.

## API version and auth

- Public API v1 (`https://ticketco.events/api/public/v1`), the only version. `buyer_phone` is the only deprecated
  parameter and is not used.
- Token issued by TicketCo support: the customer emails cs@ticketco.net from the address on their TicketCo user and
  asks for item grosses (transaction data). Tokens are per data set. Sent as query parameter `token`.

## Endpoints

- `GET /item_grosses?token&pii=false&page[&event_id]`. Reads `transaction_datestamp`, `transaction_type`, `price`, `vat`,
  `ticketco_total_fee`, `ticketco_vat`. No date filter exists; rows are filtered locally by the Europe/Oslo day of
  `transaction_datestamp` (an ISO time with offset).
- Paging: 50 rows per page (Meta `per_page`), no page size parameter. Page 1 is read first; when `meta.total_pages` is
  present the rest are read with concurrency 4, otherwise sequentially until a page has fewer than 50 rows.
- Rate limits: not documented.

## Subrequest budget

- Fetch: 1 to 40 TicketCo pages. More than 40 pages (2,000 rows) stops with a message to fetch one event at a time.
- Book: 3 ReAI calls (`GET /api/vouchers` and `GET /api/vat-codes` in parallel, then `POST /api/manual-vouchers`),
  plus more `/api/vouchers` pages only when that day has over 200 vouchers.

## ReAI endpoints

- `GET /api/vouchers?startDate&endDate&includeReversed=true` (duplicate check on description `TicketCo <ref>`)
- `GET /api/vat-codes`
- `POST /api/manual-vouchers`

## Accounting mapping

Voucher dated the last day of the period, postings in NOK, rows paired with `pairVoucherRows`:

- `1580` debit: due from TicketCo (sales less TicketCo fees).
- `7770` debit: `ticketco_total_fee`, with the input VAT code when `ticketco_vat` is non zero.
- `3000`/`3010`/`3020`/`3100` credit: `price` per VAT rate 25/15/12/0, VAT inclusive with the matching output code
  (exempt code for 0 %). The rate is derived from `vat / (price - vat)` and snapped to a Norwegian rate; any other
  share stops the fetch.
- A row is negative when `price` is negative or `transaction_type` matches refund/return/cancel/credit.

## Caveats

- Swagger lists no `transaction_type` values and no `meta` in `PublicItemGrossResponse` (only a separate `Meta`
  definition), so refund detection and paging fallbacks are inferred.
- Whether `price` includes the buyer fee kept by the organizer is inferred from the example (price 120 = actual_price
  100 + fee 20).
- No currency field: NOK is assumed. TicketCo Sweden organisers would need a currency check.
- Booking a whole period and then one event of the same period books those sales twice; the duplicate check only
  compares the same reference.

Last verified: 2026-11-28
