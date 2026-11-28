# Stripe Import

Route `/app/stripe/`. Docs pages: `web/content/{nb,en}/web-apps/stripe/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://docs.stripe.com/api/invoices/object
- https://docs.stripe.com/api/subscriptions/object
- https://docs.stripe.com/changelog
- https://docs.stripe.com/upgrades

- Mode: keep
- Calls: No code change. NB/EN docs body rewritten with real setup steps (Developers → API keys → Create restricted key), em dashes removed.
- Hosts in code: `api.stripe.com`
- Vendor status: Foreign vendor (Ireland), not in Brreg. Stripe is live; the API version the module pins (2026-10-28.endive) is listed in the Stripe changelog (latest 2026-11-18.endive).

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/invoices/import`
- `/api/products`
- `/api/subscriptions`
- `/api/subscriptions/{id}`
- `/api/vat-codes`

## Caveats

Only the first 100 paid invoices and subscriptions are listed (no starting_after pagination). The UI asks for read access to Account; whether GET /v1/account needs an explicit restricted key permission was not verified.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
