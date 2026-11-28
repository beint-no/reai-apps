# Driversnote Driving Log

Route `/app/driversnote/`. Docs pages: `web/content/{nb,en}/web-apps/driversnote/index.md`.

Purpose: fetch business trips from Driversnote (Driversnote ApS, Denmark; Driversnote NUF 936034128) and record them
as ReAI Driving Log trips. Two modes: the key owner's own business trips, or the reports team members submitted to the
first team the key owner manages.

## Vendor docs

- Reference and guide: https://api.driversnote.com/docs/ (redirect target of https://api.driversnote.com/)
- Key: https://www.driversnote.com/app/api-keys
- Plans ("Offentlig API" in the paid plan): https://www.driversnote.no/priser
- No changelog or versioning page is published.

## API version

Driversnote Public API, GraphQL at `POST https://api.driversnote.com/v1/driversnote` (path version v1, the only one).

## Auth

The customer creates or rotates a key at driversnote.com/app/api-keys and sends it as `x-api-key`. The key sees what
its user sees; team reports need a team admin or manager. HTTP 429 may come without a JSON body and is reported to the
user. GraphQL errors (HTTP 200 with `errors`) are shown with their message.

## Operations

- Own trips: `trips(startDate, endDate, tripTypeId: "business", first: 100, after)` with `nodes { id startAt
  distance comment isDeleted isArchived startLocationPlaceholder stopLocationPlaceholder startLocation { name address }
  stopLocation { name address } tripType { id name } vehicle { name licensePlate } reimbursements { distance amount
  rate { amount } } }` and `pageInfo { hasNextPage endCursor }`. The trip type id `business` is taken from the docs'
  own example; trips with another `tripType.id`, `isDeleted` or `isArchived` are skipped.
- Team: `teamReports(startDate, endDate, first: 20, after)` (teamId defaults to the first team) with `state
  stateLabel teamMember { userName userEmail } report { id distanceUnit userName vehicle { name licensePlate }
  reportItems(first: 100) { ... } }`. More items come from `report(id) { reportItems(first: 100, after) }`.
  Reports in a state containing "reject" or "change" are skipped, as are items with `deletedAt`, `outOfScope`,
  `isMasked` or a `tripTypeName` containing "priv" or "commut". Reports whose `distanceUnit` is not kilometres stop
  the fetch.

Distance: the docs do not state the unit of `distance`. When a reimbursement has amount, rate and distance, `amount /
rate` decides whether `distance` is whole units or metres; otherwise metres are assumed (the safe side: a wrong guess
understates). Bookkeeping day is `startAt` in Europe/Oslo. Rows outside the chosen period are dropped.

## Subrequests per action

- Fetch: one GraphQL call per 100 trips or 20 team reports, plus one per extra 100 items in a report; capped at 20
  calls. Plus 2 ReAI reference calls. A typical month is 1 to 3 Driversnote calls.
- Book: up to 5 ReAI trip list pages for the duplicate check + at most 30 trip POSTs, so at most 35.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `GET /api/employees`, `GET /api/driving-log/vehicles` (match by email/name and registration number; in own mode the
  chosen employee is used)
- `GET /api/driving-log/trips?page&pageSize=200` (duplicate check: date, route and distance)
- `POST /api/driving-log/trips` (`tripDate`, `fromLocation`, `toLocation`, `purpose`, `kilometers`,
  `roadTollAmount: 0`, optional `employeeId`, `vehicleId`)

## Accounting

ReAI books by the vehicle's accounting mode (`mileage_allowance` statutory rate, or `log_only`). Driversnote's own
reimbursement amounts are not sent; ReAI applies its rate for the trip date. Driversnote has no toll amounts.

## Caveats

- No live verification (no key). Field names come from the published schema docs; the `first` maximum is not stated
  and cursor paging handles a smaller server cap.
- Distance unit is inferred as described above.
- The trip list travels in a hidden form field between preview and booking and is validated again on booking.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
