# Autogear Driving Log

Route `/app/autogear/`. Docs pages: `web/content/{nb,en}/web-apps/autogear/index.md`.

Purpose: fetch business trips with road tolls from Autogear for a date range and record each reviewed
trip in ReAI Driving Log, which books the mileage allowance voucher.

## Vendor docs

- Overview and access: https://www.autogear.com/api
- Reference (Swagger UI): https://api.autogear.com/docs/index.html
- OpenAPI, auth flow and breaking changes in `info.description`: https://api.autogear.com/swagger/v1/swagger.json
- v2.0.0 change notes: https://api.autogear.com/API_V2_BREAKING_CHANGES_FOR_CUSTOMERS.md
- Support: api@autogear.com

## API version

Autogear API v2.0.3 (responses carry `X-Api-Version`). v2.0.0 removed `subscription` from `GET /Trip`
in favour of `vehicle` and made `subscriptionIds` a no-op; this module reads `vehicle` only. The
deprecated `/connect/token` flow is not used.

## Auth

An account owner or administrator requests API access and creates the Client ID and Client Secret
under API clients (https://app.autogear.com/dashboard/account-clients). The customer enters a
dedicated integration user (email, password) plus both client values. One
`POST /authentication/login` JSON `{ username, password, client_id, client_secret }` per action
returns `AccessTokenModel.access_token` (the description's example shows `token`; both are read),
sent as `Authorization: Bearer`.

## Endpoints

- `GET /Trip?fromDate=<from>&toDate=<to>T23:59:59&status=2&PageSize=100&PageNumber=n&sortOrder=false&fields=fields(*)`.
  `status` 2 is confirmed (1 unconfirmed, 3 reported); "All trips" omits it. `toDate` carries the
  end of day because the parameter is a date-time.
- Response `data.totalTrips` and `data.trips[]` (`TripDomainModel`). Paging stops on a short page or
  when `PageNumber * PageSize >= totalTrips`. Default page size is 50; no max is documented.

## Budget and limits

Fetch: 1 login + 1 page per 100 trips (max 30) + `GET /api/employees` + `GET /api/driving-log/vehicles`.
Record trip: 1 to 5 duplicate scan pages + 1 POST. No rate limit is documented.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/employees` (driver match by email), `GET /api/driving-log/vehicles` (active vehicles).
- `GET /api/driving-log/trips?page&pageSize=200`: no date filter, sorted by trip date descending; the
  scan stops at the first older trip and matches date, from, to and kilometres (one decimal).
- `POST /api/driving-log/trips` `{ employeeId?, vehicleId?, tripDate, fromLocation, toLocation, purpose, kilometers, roadTollAmount }`.
  ReAI books mileage allowance vouchers atomically at the rate for `tripDate`.

## Mapping

- Skipped: `isCommute` true, `rateCategory.name`/`shortName` containing "priv", under 0.1 km.
- Date: Europe/Oslo day of `startDateTime` when it carries a zone, else its own date part
  (fallback `startDate`, `tripDate`).
- From/to: address `alias`, else `addressName`. Purpose: `description.description`, else project.
- Km: `distanceKm` (fallback `distance`), one decimal. Tolls: `totalTollStationCost` when
  `currencyName` is NOK or empty, else 0 with a note.

## Caveats

- Not verified against a live account.
- `fields(*)` returns route polylines too; narrower field selection was not used because nested
  selection beyond the documented examples is unverified.
- Time zone of `startDateTime` without an offset is assumed local Norwegian time.
- `TripDomainModel.type` (boolean) is undocumented and ignored.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
