# Shopware 6

Route `/app/shopware/`. Docs pages: `web/content/{nb,en}/web-apps/shopware/index.md`.

Stages paid Shopware 6 orders as ReAI orders with one line per item, discount and shipping, using the tax Shopware calculated.

## Vendor docs

- Admin API and integrations (auth): https://developer.shopware.com/docs/guides/development/integrations-api/
- Search criteria (filters, associations, paging): https://developer.shopware.com/docs/guides/development/integrations-api/search-criteria.html
- Admin API reference: https://shopware.stoplight.io/docs/admin-api
- Entity definitions: https://github.com/shopware/shopware/blob/trunk/src/Core/Checkout/Order/OrderDefinition.php, `Aggregate/OrderLineItem/OrderLineItemDefinition.php`, `src/Core/Checkout/Cart/Tax/Struct/CalculatedTax.php`
- Releases and upgrade notes: https://github.com/shopware/shopware/releases

## API version

The Admin API is unversioned (`/api`). Written against Shopware 6.7 (6.7.16.2 is the latest on 2026-11-28) and compatible with 6.6 (still receiving security releases): `primaryOrderTransactionId` (6.7) is used when present, else the newest transaction.

## Auth

Settings → System → Integrations: an integration with read access to orders gives an access key ID and secret. `POST {shop}/api/oauth/token` `{ grant_type: client_credentials, client_id, client_secret }` returns `access_token`; calls send `Authorization: Bearer`. One token per fetch, never stored. Any public https shop host is accepted (SSRF guard).

## Endpoints

- `POST /api/search/order` criteria: `page`, `limit: 100`, associations `lineItems`, `currency`, `orderCustomer`, `transactions.stateMachineState`; filters `range orderDate gte/lte`, `equals transactions.stateMachineState.technicalName = paid`, `not (stateMachineState.technicalName = cancelled)`; sort `orderDateTime ASC`.
- Locally the current transaction (primary, else newest `createdAt`) must be `paid`, so later refunded or cancelled payments are skipped.
- Paging stops on a short page; more than 20 pages (2,000 orders) is an error asking for a shorter period.

## Budget and limits

Fetch: 1 token + 1 call per 100 orders (2 for a normal month, at most 21). Stage one order: up to 6 ReAI calls. Shopware has no documented Admin API rate limit for integrations.

## ReAI API

- `GET /api/orders?externalReference=shopware-<id>` duplicate check.
- `GET /api/vat-codes?usage=customer_invoice`: `output_vat` code with the line's rate (0%: exempt or outside scope).
- `GET /api/customers?email=` then `?name=` with an exact name match; else `POST /api/customers` (private unless the order customer has a company).
- `POST /api/orders` with `currencyCode` from `currency.isoCode`, `issueDate`/`orderDate` = `orderDate`, lines excl. VAT.

## Mapping

Top level line items (children with `parentId` skipped). `CalculatedPrice.totalPrice` minus `calculatedTaxes[].tax` for `taxStatus` gross; net prices as is; tax-free is 0%. A price with several `calculatedTaxes` (proportional discounts, shipping) becomes one line per rate from each tax's `price`; if those parts do not add up, one line with the default VAT code. Shipping from `order.shippingCosts`.

## Caveats

`orderDate` is the Shopware (UTC based) order date, not an Oslo day. Refunds after staging must be credited in ReAI by hand. Not tested against a live shop.

Last verified: 2026-11-28.
