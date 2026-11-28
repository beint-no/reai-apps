# Squarespace

Route `/app/squarespace/`. Docs pages: `web/content/{nb,en}/web-apps/squarespace/index.md`.

Stages Squarespace Commerce orders for a chosen period as ReAI orders (one line per item, shipping and discount) for review before invoicing.

## Vendor docs

- Reference: https://developers.squarespace.com/commerce-apis/retrieve-all-orders
- Orders overview and changes: https://developers.squarespace.com/commerce-apis/orders-overview
- Auth: https://developers.squarespace.com/commerce-apis/authentication-and-permissions
- Requests and headers: https://developers.squarespace.com/commerce-apis/making-requests
- Rate limits: https://developers.squarespace.com/commerce-apis/rate-limits
- Versioning: https://developers.squarespace.com/commerce-apis/versioning

## API version

Orders API `1.0` (path `/1.0/commerce/orders`), the current version on the overview page; no newer version or deprecation announced.

## Auth

Customer creates a key in Squarespace **Settings → Advanced → Developer API Keys** with the Orders permission (Commerce plan needed). Sent as `Authorization: Bearer <key>`; a `User-Agent` header is required.

## Endpoints

- `GET https://api.squarespace.com/1.0/commerce/orders?modifiedAfter&modifiedBefore`, then `?cursor=<nextPageCursor>` alone (cursor cannot be combined with other parameters).
- No created-date filter exists. The window is modified since Oslo midnight of the start day (UTC minus two hours) until now, then orders are filtered by their Europe/Oslo creation day.
- `paymentStates` is left at its default (NOT_CHARGED, AUTHORIZED, PAID, REFUNDED); `PARTIALLY_PAID` payment plan orders are not fetched.
- Fields: `createdOn`, `testmode`, `fulfillmentStatus`, `priceTaxInterpretation`, `lineItems[].unitPricePaid/quantity/productName/sku`, `shippingTotal`, `discountTotal`, `taxTotal`, `refundedTotal`, `grandTotal.currency`, `billingAddress`, `customerEmail`.

## Paging, rate limits, subrequests

- 50 orders per page sorted by `modifiedOn`; at most 20 pages per fetch, then a clear error asks for a later start date (no silent truncation).
- 300 requests per minute; 429 starts a one-minute cool-down, so it is reported, not retried.
- Fetch: 1 to 20 Squarespace calls. Stage (per order): up to 6 ReAI calls (order duplicate lookup, VAT codes, customer by email, customer by name, customer create, order create).

## ReAI endpoints

- `GET /api/orders?externalReference=squarespace-<id>` (duplicate check), `POST /api/orders`
- `GET /api/vat-codes?usage=customer_invoice`
- `GET /api/customers?email|name`, `POST /api/customers`

## Accounting mapping

- Amounts are converted to ex VAT; with `INCLUSIVE` prices the lines are scaled by base/gross. Unit prices are rounded to two decimals; when quantity x unit does not reproduce the line total the line becomes quantity 1.
- Tax is per order only: the order rate is derived from `taxTotal` and used for all lines when it is 25, 15, 12 or 0 percent; otherwise ReAI's default customer VAT code applies.
- Currency comes from `grandTotal.currency`. Order date and issue date are the Oslo creation day.
- Test orders, canceled orders and fully refunded orders are skipped. Partly refunded orders are flagged; the refund must be credited in ReAI.

## Caveats

- Mixed rate orders cannot be split by rate (no line tax in the API).
- `refundedTotal` is assumed to include VAT like `grandTotal`; only used to skip full refunds and flag partial ones.
- Not tested against a live store.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28
