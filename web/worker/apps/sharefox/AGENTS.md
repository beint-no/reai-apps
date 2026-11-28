# Sharefox Rental Sales

Route `/app/sharefox/`. Docs pages: `web/content/{nb,en}/web-apps/sharefox/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://help.sharefox.no/article/426-sharefox-api
- https://api.mysharefox.com/docs
- https://sharefox.co/api/
- https://help.sharefox.no/article/307-accounting-file-general

- Mode: api
- Auth: No API key: the customer logs in as a Sharefox admin user. POST https://api.mysharefox.com/api-v2/admin/login {email,password} with header x-sharefox-admin-domain (e.g. yourshop.admin.mysharefox.com) returns a long-lived opaque token; then Authorization: Bearer <token> + x-sharefox-admin-domain. Sharefox asks customers to confirm with Support that API use is included in their subscription.
- Hosts in code: `api.mysharefox.com`, `help.sharefox.no`
- Vendor status: Brreg (2026-11-28): not konkurs, not under avvikling or tvangsavvikling, no slettedato. sharefox.no live, sells rental and booking software.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/manual-vouchers`
- `/api/vat-codes`
- `/api/vouchers`

## Caveats

Sharefox API is officially beta ('1.0.0-alpha.0', endpoints may change) and 'available for selected partners and customers'. GET /admin/orders/?start&end is documented as returning an object schema although described as a list; the app accepts an array or a single object. The meaning of start/end (book time vs rental time) is not documented. price and totalPriceExclVat are strings; price is assumed to include VAT, VAT rate derived from price vs excl. VAT and snapped to 25/15/12 (orders with 0% or mixed rates are listed for manual booking). Only status Booked/Closed counted (per Sharefox help article); Faktura/invoice payment orders excluded (Sharefox's own accounting export does the same by default). Creates one balanced review voucher: per VAT rate one rowNumber with debit clearing (default 1580, vatCode 0) and credit revenue (default 3000, output VAT code), flagged with reviewReason; duplicate-guarded by description 'Sharefox rentals <from> to <to>' on the voucher date. Asks for an admin password (used once, not stored).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
