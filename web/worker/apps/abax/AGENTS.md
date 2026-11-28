# ABAX

Route `/app/abax/`. Docs pages: `web/content/{nb,en}/web-apps/abax/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developers.abax.cloud/getting-started
- https://developers.abax.cloud/migration-guide
- https://developers.abax.cloud/documentation/api

- Mode: fix
- Calls: POST https://identity.abax.cloud/connect/token (client_credentials, scope 'open_api open_platform.trips') then GET /v4/trips (page, page_size=1500, date_from, date_to, max 3 months), filter commercial_class=BusinessTrip and optional driver.email, distance meters to km; GET /v4/trips/expense?trip_ids= (<=150 per call) for toll_charge + toll_road_admin. Posts POST /api/driving-log/trips (verified against openapi: tripDate, fromLocation, toLocation, purpose, kilometers, roadTollAmount, employeeId, vehicleId). CSV removed; employee and vehicle selects added to the API form.
- Hosts in code: `api.abax.cloud`, `developers.abax.cloud`, `identity.abax.cloud`
- Vendor status: Brreg: ABAX AS active (no konkurs/avvikling/sletting); developers.abax.cloud live with V4 API and migration guide.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/driving-log/trips`
- `/api/driving-log/vehicles`
- `/api/employees`

## Caveats

Client credentials flow must be enabled by ABAX support per client (default is authorization code flow). The V4 model is taken from the migration guide plus the legacy V1 spec embedded in the portal (fields unchanged except vehicle.alias->name). Shared test web/test/provider-api.test.mjs (ABAX block) mocks the old invented v1 response and will fail; needs updating by the coordinator.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
