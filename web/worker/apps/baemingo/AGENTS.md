# Baemingo Daily Sales Accounting

Route `/app/baemingo/`. Docs pages: `web/content/{nb,en}/web-apps/baemingo/index.md`.

Purpose: total one Baemingo business day of orders, refunds and tip corrections into a balanced ReAI review voucher (sales by VAT rate, payments by method, tips).

## Vendor docs

- Reference: https://docs.baemingo.se/ and https://docs.baemingo.se/skills/baemingo-openapi/SKILL.md (shared rules: auth, money, fair use)
- Resources: https://docs.baemingo.se/skills/baemingo-openapi/resources/orders.md, https://docs.baemingo.se/skills/baemingo-openapi/resources/me.md
- Product page: https://baemingo.com/en/integrations/baemingo-api
- Changelog: none published.

## API version and auth

- `https://public-api.baemingo.se`, unversioned ("There is no version segment in the URL"). `GET /orders` accepts only `date`; older parameters are deprecated.
- Key: Baemingo Admin → Integrations → Public API (`admin.baemingo.com/integrations/api`), shown once, scoped to a venue or company.
- Header: `x-api-key: <key>`.

## Endpoints and paging

- `GET /me`: `venueName` (venue key) or `name` (company key) for the voucher marker.
- `GET /orders?date=YYYY-MM-DD`: one business day, 04:00 UTC to 04:00 UTC; not paginated; `{ success, orders: [{ type, data }] }` with `ORDER`, `REFUND`, `TIP_REFUND`.
- Rate limits: fair use, no hard limit; do not retry 4xx unchanged.

## Subrequest budget

- Fetch: 2. Book: 3 (manual vouchers on the day, VAT codes, POST).

## ReAI endpoints

- `GET /api/vouchers?startDate=&endDate=&voucherType=manual` (duplicate marker `Baemingo <venue> <day>`)
- `GET /api/vat-codes`
- `POST /api/manual-vouchers`

## Accounting mapping

- Money is integer smallest currency unit including VAT. Currency from `ORDER.data.currency`; several currencies on one day are refused, and booking requires the ReAI company currency.
- ORDER: sales per item `vatRate` from `intAmountAfterDiscount`; payments from `paymentMethods[].intAmount` plus `intTip` unless `intAmount` already includes the tip (detected per order); tip to `2930`; service fee and any rest to the order's largest VAT rate.
- REFUND: payments from `payments[].amountRefunded` (or `amountAfterDiscounts`); the refund is split over VAT rates in proportion to the refunded items' `amount - discount` (largest remainder), because the unit of those item fields is not documented.
- TIP_REFUND: `newTipAmount - previousTipAmount` on tips and the payment type.
- Payment types matching `/^cash/i` go to `1900`, others to `1580`; sales to `3000`/`3010`/`3020` by rate (else `3100`) with the ReAI output code (`vat_inclusive`). Rows paired with `pairVoucherRows`, review flag set.

## Caveats

- The payment type enum is undocumented.
- The list endpoint gives no VAT split of service fees.
- The marketing page still describes a request process via servicecenter@baemingo.com, while docs and admin show self-service keys. Norwegian representative: Barcontrol Systems AS.
- No live verification (no credentials).

Last verified: 2026-11-28
