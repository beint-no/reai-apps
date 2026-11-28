# Sharefox Rental Sales

Route `/app/sharefox/`. Docs pages: `web/content/{nb,en}/web-apps/sharefox/index.md`.

Sums booked Sharefox rental orders for a period by VAT rate and books one balanced review voucher (payment clearing against rental revenue).

## Vendor docs

- API reference (Redoc, spec embedded): https://api.mysharefox.com/docs
- API overview and access: https://help.sharefox.no/article/426-sharefox-api and https://sharefox.co/api/
- Accounting export rules: https://help.sharefox.no/article/307-accounting-file-general
- No public changelog.

## API version

`api-v2` (spec `1.0.0-alpha.0`, the only published version on 2026-11-28). Sharefox calls it beta, for selected partners and customers; endpoints may change.

## Auth

No API keys. The customer signs in as a Sharefox admin user: `POST https://api.mysharefox.com/api-v2/admin/login` `{ email, password }` with header `x-sharefox-admin-domain: <shop>.admin.mysharefox.com` returns `token`. Calls send `Authorization: Bearer <token>` plus the same domain header and `locale: en`. Password used once, never stored. Customers must confirm with Sharefox Support that API use is in their subscription.

## Endpoints

- `GET /admin/orders/?start=YYYY-MM-DD&end=YYYY-MM-DD`: no paging documented; one call returns the range. Fields used: `id`, `reference`, `bookTime`, `status`, `paymentMethodName`, `price`, `totalPriceExclVat` (strings), `isChangeOrder`, `isDeleted`.

## Budget and limits

Fetch: 2 subrequests. Book: `GET /api/vouchers` (1+ pages), `GET /api/vat-codes`, `POST /api/manual-vouchers`. No rate limits documented.

## ReAI API

- `GET /api/vouchers?startDate=&endDate=&includeReversed=true` duplicate check on description `Sharefox rentals <from> to <to>`.
- `GET /api/vat-codes`: VAT inclusive output code per rate, preferring 3/31/33.
- `POST /api/manual-vouchers` with `reviewReason`, rows from `pairVoucherRows`.

## Mapping

Only status Booked or Closed. Orders paid by invoice (`Faktura`) are left out, as in Sharefox's own export. VAT rate derived from `price` versus `totalPriceExclVat` and snapped to 25/15/12; 0% or mixed rates are listed for manual booking. Per rate: debit clearing (default 1580, code 0) and credit revenue (default 3000, output code) with the gross amount, dated the last day of the period. Change orders are included so changes and cancellations net out.

## Caveats

Orders carry no currency field; the company currency is used. Whether `start`/`end` filter on book time or rental time is not documented, and whether `end` is inclusive. Duplicate check only matches the exact same period; overlapping periods are the customer's responsibility (confirm checkbox).

Last verified: 2026-11-28.
