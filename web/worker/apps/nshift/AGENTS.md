# nShift Delivery Freight Rebilling

Route `/app/nshift/`. Docs pages: `web/content/{nb,en}/web-apps/nshift/index.md`.

Reads stored freight prices from nShift Delivery (formerly Unifaun) and stages one ReAI draft
order per shipment so the freight can be rebilled.

## Vendor docs

- Authentication: https://developers.nshiftone.com/delivery/authentication
- Price history: https://developers.nshiftone.com/delivery/prices/post-prices-history
- Shipment history: https://developers.nshiftone.com/delivery/shipment-history/get-shipments-history
- RAML spec (authoritative fields): https://api.unifaun.com/rs-extapi/v1/documentation/root-resource-v1.raml
  with `PriceHistory.jsonschema` next to it
- Changelog: linked from https://developers.nshiftone.com/delivery

## API version

REST API v1 (`https://api.unifaun.com/rs-extapi/v1`), the only version. No sunset announced.

## Auth

Customer creates a key in nShift Delivery under Maintenance > API keys > New API key (Id and
Secret Id). One `GET /sessions/jwt` with `Authorization: Basic base64(Id:Secret Id)` per fetch
returns `{ token }` (12 hours), then `Authorization: Bearer <token>`. The docs curl example says
POST, but the text says GET and the live endpoint answers POST with 405. Licence
"REST API price enquiry" is required; "REST API Shipment History" is optional.

## Endpoints

- `POST /prices/history?fetchId=<cursor>` with body `{}` (no extra surcharges). Forward cursor:
  `-1` to start, at most 100 prices per call, call again while `done` is false (not rate limited).
  Otherwise keep to about one call per five minutes; `minDelay` (ms) says how long to wait.
  Reads `shipmentNo`, `orderNo`, `serviceId`, `partnerId`, `parcelCount`, `shipDate`/`shipdate`,
  `printDate`/`printdate`, `priceData.priceWithAdditionalSurcharges` or `priceData.price`.
- `GET /shipments-history?page&dateType=ship&dateFrom&dateTo`: 50 per page, page starts at 0,
  `totalPages`, max 6 months back. Only for receiver names (`rcvName` by `shipmentNo` or
  `orderNo`); failures are ignored.

## Budget and limits

Fetch: 1 token + up to 10 price calls (1000 prices) + up to 25 history pages (1250 shipments) +
ReAI customers (200 per page). When the price feed is not done, the app says so and the user
fetches again with the returned `fetchId`. Stage order: 2 ReAI calls.

## ReAI API

- `GET /api/customers?archived=false` (name match and fallback list)
- `GET /api/orders?externalReference=nshift-<shipment>` (duplicate check)
- `POST /api/orders` with `customerId`, `currencyCode` (company currency), `daysUntilDue`,
  `issueDate`, `orderDate`, `externalReference`, `comment`, one `orderLines` item
  (`itemName`, `quantity` 1, `unitPrice` ex VAT, no `vatCode` so the customer default applies)

## Accounting mapping

Draft orders only; revenue account and VAT come from ReAI defaults when the user invoices.
Ship dates are UTC timestamps and are converted to the Europe/Oslo day.

## Caveats

- Prices have no currency field; they follow the carrier agreement and are staged in the company
  currency.
- The app is stateless; the user keeps the `fetchId`. A fetched batch is consumed even if not
  every shipment is staged.
- RAML example and JSON schema disagree on date field casing; both are read.
- Not tested against a live key.

Last verified: 2026-11-28
