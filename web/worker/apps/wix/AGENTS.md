# Wix Stores Sync

Route `/app/wix/`. Docs pages: `web/content/{nb,en}/web-apps/wix/index.md`.

Fetches paid Wix eCommerce orders for a period and stages each as a ReAI order (one line per
item, shipping and additional fee, with the VAT rate Wix charged).

## Vendor docs

- Reference: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/search-orders
- Order object: https://dev.wix.com/docs/api-reference/business-solutions/e-commerce/orders/order-object
- Auth: https://dev.wix.com/docs/api-reference/articles/authentication/api-keys/make-api-calls-with-an-api-key
- Changelog: https://dev.wix.com/docs/changelog (2026-11-22: test orders, `demo` flag on orders)

## API version

eCommerce Orders `ecom/v1` (the only version; current, examples dated 2026). Stores Catalog
V1/V3 is not used.

## Auth

Wix API Keys Manager, permission "Read Orders" (`SCOPE.DC-STORES.READ-ORDERS`). Headers
`Authorization: <API key>` (no prefix) and `wix-site-id: <site id>` (from the dashboard URL).

## Endpoints used

- `POST https://www.wixapis.com/ecom/v1/orders/search` with
  `filter: { status: APPROVED, paymentStatus $in [PAID, PARTIALLY_REFUNDED], archived $ne true, demo $ne true, createdDate $gte/$lt }`,
  `sort createdDate ASC`, `cursorPaging.limit 100` (documented maximum). Next pages send only
  `cursorPaging.cursor` (`metadata.cursors.next` while `metadata.hasNext`). Max 10 pages.
- Date bounds are 00:00 Europe/Oslo converted to UTC; order date is the Oslo day of `createdDate`.

## Budget per action

Fetch: 1 to 10 Wix calls. Stage: ReAI duplicate check, VAT codes, customer lookup by email then
name (1 to 2), optional customer create, order create = 4 to 6. No Wix rate limit documented for
this endpoint; 429 surfaces as an HTTP error.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/orders?externalReference=wix-<orderId>` (duplicate check)
- `GET /api/vat-codes?usage=customer_invoice`
- `GET /api/customers?email|name`, `POST /api/customers`
- `POST /api/orders`

## Mapping

- `lineItems[].totalPriceBeforeTax` (after discounts, before tax) split into quantity x unit price
  (falls back to one line "N x name" when it does not divide to whole øre); VAT from
  `taxInfo.taxRate` (decimal string) to a ReAI `output_vat` code of the same rate, 0 % to
  exempt/outside scope.
- Shipping: `shippingInfo.cost.totalPriceBeforeTax` with its own tax rate.
- `additionalFees[]`: `priceBeforeTax` with `taxInfo.taxRate`.
- Currency from `order.currency`; customer by email, else name, else created (company when the
  billing contact has a company).

## Caveats

- Test orders (`demo: true`) are excluded server side.
- Partly refunded orders are staged at the full sale and flagged; the refund is booked as a credit
  note in ReAI. Fully refunded orders are not fetched.
- Missing tax rate leaves VAT to the ReAI item default.
- Product sync removed (Catalog V1 vs V3 split). Not tested against a live site.

Last verified: 2026-11-28
