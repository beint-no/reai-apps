# Shopware 6 Sync

Route `/app/shopware/`. Docs pages: `web/content/{nb,en}/web-apps/shopware/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developer.shopware.com/docs/guides/development/integrations-api/
- https://developer.shopware.com/docs/guides/development/integrations-api/search-criteria.html
- https://github.com/shopware/shopware/blob/trunk/src/Core/Checkout/Order/OrderDefinition.php
- https://github.com/shopware/shopware/blob/trunk/src/Core/Checkout/Order/Aggregate/OrderLineItem/OrderLineItemDefinition.php
- https://github.com/shopware/shopware/blob/trunk/src/Core/Checkout/Cart/Price/Struct/CalculatedPrice.php

- Mode: fix
- Calls: POST /api/oauth/token, then POST /api/search/order with criteria: range filter orderDate, equals transactions.stateMachineState.technicalName = paid (documented example), associations lineItems/currency/orderCustomer/transactions.stateMachineState, page/limit. Line items (skipping children with parentId) and shippingCosts converted to ex VAT using CalculatedPrice.calculatedTaxes and order.taxStatus; one ReAI order line per item, promotion and shipping with the VAT code from GET /api/vat-codes?usage=customer_invoice; currency from currency.isoCode; duplicate check via GET /api/orders?externalReference; customer by email/name or created. Product sync removed (orders only).
- Hosts in code: `developer.shopware.com`, `github.com`, `shop.example.no`
- Vendor status: Shopware 6 is actively developed (shopware/shopware trunk, docs at developer.shopware.com updated); Admin API integration docs current.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/orders`
- `/api/vat-codes`

## Caveats

Product catalog sync was dropped to keep the module to documented order fields. Line items with mixed tax rates get the ReAI default code. Self-hosted shops: any public https host is accepted (SSRF guard). Not tested against a live shop.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
