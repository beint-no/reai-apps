# ViaTracks Driving Log

Route `/app/viatracks/`. Docs pages: `web/content/{nb,en}/web-apps/viatracks/index.md`.

Purpose: fetch business trips and toll expenses from ViaTracks (Devinco AS, Trondheim, orgnr 984596820) and record
them as ReAI Driving Log trips, matched to ReAI employees and vehicles.

## Vendor docs

- Start and access: https://www.devinco.com/developer/viatracks/start/
- Auth: https://www.devinco.com/developer/viatracks/connect/
- Paging, filters, sorting: https://www.devinco.com/developer/viatracks/paging-filtering-and-sorting/
- FAQ (clientId 13, Integration Enabled cost, throttling, no webhooks): https://www.devinco.com/developer/viatracks/faq/
- Reference: https://api.viatracks.com/scalar (OpenAPI https://api.viatracks.com/openapi/v1.json)
- Changelog: https://www.devinco.com/developer/viatracks/changelog/ points to
  https://support.devinco.com/hc/en-us/sections/38114257167005-ViaTracks-API

## API version

ViaTracks REST API v1 (`ViaTracksREST2 | v1`, 1.0.0), the only published version. Production only.

## Auth

The customer emails support@devinco.com for an `apiKey` and `subjectId` for a ViaTracks user with rights to the
vehicles. "Integration Enabled" must be on for the customer or department (monthly cost per tracker, no per call fee).
One `POST https://connect.devinco.com/Token/GenerateAccessTokenFromCache` with `{ clientId: 13, subjectId, apiKey }`
per fetch, then `Authorization: Bearer <token>`. The token response body is undocumented; a bare or JSON string and
`accessToken`, `access_token` or `token` fields are accepted.

## Endpoints

- `GET /api/User?Page=1&PageSize=200` for driver names (`userID`, `username`, `description`).
- `GET /api/Trip?Period=custom&PeriodFrom=<from>T00:00:00&PeriodTo=<to>T23:59:59&includeExpenses=true&Sorts=StartTime&Page&PageSize=200`
  returns `TripWithExpense` items (`trip` = `ViewTrip`, `tripExpenses` = `TripExpense[]`). Bare `ViewTrip` items are
  accepted too. A short page ends the list (default and used page size 200, no documented maximum).

Mapping: trips with `personal`, `isPrivateOccasional` or `isPrivateTaxable` true and trips with `progress` 0 (in
progress) or 1 (rejected) are skipped. Kilometres are `(distance - distancePrivateTaxable) / 1000`: the spec gives
metres for `distancePrivateTaxable`, and `distance` is read in the same unit. Bookkeeping day is the Europe/Oslo date
of `startTime` when it carries a zone, else its own date. Tolls are the sum of `quantity × rate` for expenses whose
`expenseType` contains "bom" or "toll"; other expenses (parking, ferry) are shown but not sent.

## Subrequests per action

- Fetch: 1 token + 1 users + 1 trip page per 200 trips (cap 15) + 2 ReAI reference calls. A month for a small fleet is 5.
- Book: up to 5 ReAI trip list pages for the duplicate check + at most 30 trip POSTs, so at most 35.
- Throttling (HTTP 429) is reported to the user; there is no automatic retry.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `GET /api/employees`, `GET /api/driving-log/vehicles` (match by email/name and registration number)
- `GET /api/driving-log/trips?page&pageSize=200` (duplicate check: date, route and distance)
- `POST /api/driving-log/trips` (`tripDate`, `fromLocation`, `toLocation`, `purpose`, `kilometers`,
  `roadTollAmount`, optional `employeeId`, `vehicleId`)

## Accounting

ReAI decides the booking by the vehicle's accounting mode: `mileage_allowance` books the statutory rate plus tolls,
`log_only` only documents the trip. With several active ReAI vehicles a trip without a matching registration number
(or a chosen fallback) is not sent, because ReAI requires `vehicleId` then.

## Caveats

- No live verification (no credentials). The Trip response is documented as a single `TripWithExpense`; the code
  reads both an array and the common list envelopes.
- The distance unit of `ViewTrip.distance` is not stated; metres are inferred from `distancePrivateTaxable`.
- Toll detection depends on the customer's expense type names in ViaTracks.
- The trip list travels in a hidden form field between preview and booking and is validated again on booking.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
