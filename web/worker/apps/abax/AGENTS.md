# ABAX Driving Log

Route `/app/abax/`. Docs pages: `web/content/{nb,en}/web-apps/abax/index.md`.
Fetches ABAX business trips and their road tolls for a period and records them in the ReAI driving log, one trip per click.

## Vendor docs

- Getting started (auth flows, scopes, rate limiting): https://developers.abax.cloud/getting-started
- Migration guide to V4 (scopes, renamed fields, sunset policy): https://developers.abax.cloud/migration-guide
- API reference (toggle "V4 API"): https://developers.abax.cloud/documentation/api
  (spec bundled at https://developers.abax.cloud/assets/api-v4.*.js, "Abax Open Platform API V4" 4.0.0 on 2026-11-28)
- Changelog: none published; the migration guide says a legacy sunset date will be announced in advance.

## API version

Open Platform API V4 (`https://api.abax.cloud/v4`). New ABAX customers only get V4; all new development is V4. The legacy
v1 to v3 endpoints are not used.

## Auth

Client credentials: `POST https://identity.abax.cloud/connect/token` (form: `grant_type=client_credentials`,
`scope=open_api open_platform.trips`, `client_id`, `client_secret`), then `Authorization: Bearer`. The customer creates
production credentials in the ABAX Developer Portal as an administrator and asks ABAX support to enable the client
credentials flow (off by default). One token exchange per fetch.

## Endpoints used

- `GET /v4/trips?page&page_size=1500&date_from&date_to` (documented maximum page size 1500; period at most 3 months; UTC
  datetimes sent as Europe/Oslo day bounds). Fields: id, driver.name/email, start/finish.address, start.location.timestamp,
  distance (meters), purpose, notes, commercial_class (`BusinessTrip` kept).
- `GET /v4/trips/expense?trip_ids=…` (up to 150 ids, repeated param): expense.toll_charge, expense.toll_road_admin,
  extra.passenger_name, extra.distance_with_passenger_in_km.

## Budget

1 token + up to 4 trip pages (6,000 trips, then "choose a shorter period") + one expense call per 150 business trips
(at most 1,500 business trips, so at most 10 calls, 3 in parallel). A typical month is 3 subrequests. The default quota
is 60 requests per 60 seconds (`X-Ratelimit-*` headers); `429` asks the user to wait a minute.
Preview also reads ReAI employees (1) and recent driving log trips (up to 5 pages of 200, stopping at older trips).

## ReAI API

- `GET /api/employees`, `GET /api/driving-log/vehicles` (form selects, email matching).
- `GET /api/driving-log/trips?page&pageSize=200` to mark trips already recorded (same date, km and route).
- `POST /api/driving-log/trips`: tripDate, fromLocation/toLocation (≤ 200), purpose, kilometers (≥ 0.1), roadTollAmount,
  employeeId, vehicleId, passengers[{ name, kilometers }].

## Mapping

Date = start timestamp in Europe/Oslo. Kilometres = distance / 1000 (1 decimal). Road toll = toll_charge + toll_road_admin,
summed in øre. Parking and ferry are not part of the ReAI trip. Each trip goes to the ReAI employee whose email matches
the ABAX driver; the selected employee is used only when all trips have one driver. ReAI calculates the mileage allowance.

## Caveats

- Expense amounts carry no currency; NOK is assumed (ABAX Norway).
- ABAX trip vehicles have no licence plate in the trip model, so the ReAI vehicle is chosen manually.
- The Open API only works for ABAX administrator accounts.

## Rules

- Use only documented endpoints, auth, parameters and fields on the newest API version, with server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28
