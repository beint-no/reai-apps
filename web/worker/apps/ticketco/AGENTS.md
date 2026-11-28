# TicketCo

Route `/app/ticketco/`. Docs pages: `web/content/{nb,en}/web-apps/ticketco/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://apidoc.ticketco.events/api/v1/public?env=Production
- https://ticketco.io/en/support/accessing-and-testing-the-ticketco-public-api

- Mode: fix
- Calls: GET https://ticketco.events/api/public/v1/item_grosses with token, pii=false, optional event_id and page; rows filtered by transaction_datestamp (no date filter exists); VAT rate derived from vat/(price minus vat) snapped to 25/15/12/0; refunds by transaction_type subtracted; fees from ticketco_total_fee and ticketco_vat. Voucher: 1580 due from TicketCo, 7770 fees (input VAT code when ticketco_vat present), 3100/3000/3010/3020 sales VAT inclusive with real codes from GET /api/vat-codes (exempt code for 0 %), rows paired by pairVoucherRows, duplicate check via /api/vouchers description marker.
- Hosts in code: `apidoc.ticketco.events`, `ticketco.events`, `ticketco.io`
- Vendor status: Brreg 999104134 TICKETCO AS: konkurs false, underAvvikling false, tvangsavvikling false, no slettedato. Public API live: ticketco.events/api/public/v1/item_grosses?token=x returns 401 with an invalid key message.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/manual-vouchers`
- `/api/vat-codes`
- `/api/vouchers`

## Caveats

Token is issued by TicketCo support (cs@ticketco.net). Swagger does not document refund transaction_type values or pagination meta in the item_grosses response; module treats types matching refund/return/cancel/credit as negative and stops on a short page (<50) or meta.total_pages. Whether price includes the buyer fee kept by the organizer is inferred from the example (price 120 = actual_price 100 + fee 20). fetchApi signature and return shape changed: web/test/provider-api.test.mjs (TicketCo in the 'Settlements' test) needs an update.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
