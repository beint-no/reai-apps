# Baemingo Daily Sales Accounting

Route `/app/baemingo/`. Docs pages: `web/content/{nb,en}/web-apps/baemingo/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://docs.baemingo.se/
- https://docs.baemingo.se/skills/baemingo-openapi/SKILL.md
- https://docs.baemingo.se/skills/baemingo-openapi/resources/orders.md
- https://docs.baemingo.se/skills/baemingo-openapi/resources/me.md
- https://baemingo.com/en/integrations/baemingo-api

- Mode: api
- Auth: Customer generates a venue-scoped read key in Baemingo Admin > Integrations > Public API (admin.baemingo.com/integrations/api); sent as x-api-key header to https://public-api.baemingo.se.
- Hosts in code: `docs.baemingo.se`, `public-api.baemingo.se`
- Vendor status: Swedish company, no Norwegian register entry. baemingo.com live; Baemingo POS SE 2.x on Skatteverket's manufacturer list updated 2026-08-28; Realtid (2026-08) reports doubled revenue and operations in Norway.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/manual-vouchers`
- `/api/vat-codes`
- `/api/vouchers`

## Caveats

Uses GET /me (venue name for the reference) and GET /orders?date=YYYY-MM-DD (one business day 04:00 to 04:00 UTC, not paginated, ORDER/REFUND/TIP_REFUND, øre incl. VAT). Sales per item vatRate from intAmountAfterDiscount; payments from paymentMethods[].intAmount plus intTip unless intAmount already includes the tip (detected per order); service fee and any rest go to the order's largest VAT rate (list endpoint gives no service fee VAT split). Payment type enum is undocumented: types matching /^cash/i go to 1900, everything else to 1580. The marketing page still describes a request process via servicecenter@baemingo.com, while docs and admin show self-service keys. Norwegian representative is Barcontrol Systems AS (mail@barcontrol.no).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
