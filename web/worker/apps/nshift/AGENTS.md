# nShift Delivery Freight Rebilling

Route `/app/nshift/`. Docs pages: `web/content/{nb,en}/web-apps/nshift/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developers.nshiftone.com/delivery/authentication
- https://developers.nshiftone.com/delivery/prices
- https://developers.nshiftone.com/delivery/shipment-history/get-shipments-history
- https://api.unifaun.com/rs-extapi/v1/documentation/root-resource-v1.raml
- https://nshiftdelivery.helpcenter.nshift.com/hc/en-us/articles/27848375690012-API-keys
- https://nshiftdelivery.helpcenter.nshift.com/hc/en-us/articles/27848375300124-Price-review

- Mode: api
- Auth: Customer creates key in nShift Delivery: Maintenance -> API keys -> New API key (Id + Secret Id). App calls GET https://api.unifaun.com/rs-extapi/v1/sessions/jwt with Authorization: Basic base64(Id:Secret Id), then Authorization: Bearer <token>. Needs licence 'REST API price enquiry'; 'REST API Shipment History' optional for receiver names.
- Hosts in code: `api.unifaun.com`, `developers.nshiftone.com`
- Vendor status: Brreg (2026-11-28): not konkurs, not under avvikling or tvangsavvikling, no slettedato. nshift.com live, sells the multi-carrier shipping platform.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/orders`

## Caveats

POST /prices/history is a forward cursor feed (fetchId, -1 to start, done/minDelay, about one new fetch per 5 minutes), not date filterable; the app is stateless so the user keeps the returned fetchId and enters it next time (shown in the result). Receiver names come from GET /shipments-history (dateType=ship, 50 per page, 6 months max); the documented example response starts at page 0, so paging starts at 0 and failures (missing licence) are tolerated. Prices carry no currency field; orders staged in NOK. nShift docs disagree on printdate/shipdate casing; both handled. docs curl example uses POST for /sessions/jwt but the text and a live unauthenticated probe say GET. Not tested against a live key. Separate app from logistra.js, whose LEAD text still mentions nShift.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
