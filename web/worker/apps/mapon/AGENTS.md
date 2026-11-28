# Mapon Driving Log

Route `/app/mapon/`. Docs pages: `web/content/{nb,en}/web-apps/mapon/index.md`.

Purpose: fetch business routes from Mapon (Mapon SIA, Latvia; sold in Norway directly and as Tracksys Pro by Tracksys
AS, orgnr 918351701, whose "Logg inn Pro" goes to mapon.com) and record them as ReAI Driving Log trips, matched to
ReAI employees and vehicles.

## Vendor docs

- Reference (all actions, auth, limits, errors): https://mapon.com/api/
- Create key: https://help.mapon.com/en/articles/174904-how-to-create-api-key
- Manage keys: https://help.mapon.com/en/articles/174970-manage-api-keys
- No changelog is published; the PHP client is at https://github.com/mapon-com/client-api-php-sdk

## API version

Mapon API v1 (`https://mapon.com/api/v1/<class>/<action>.json`), the only version.

## Auth

A Mapon account administrator (or a user with unlimited rights) creates the key under Settings → API keys → Create
API key and chooses the vehicles it can see; Mapon support cannot create keys for customers. The worker sends it in the
documented `key` header.

## Endpoints

- `GET route/list.json?from&till&route_types=business&include[]=driver_id&include[]=route_details&include[]=route_fields`
  (`data.units[].routes[]`; only `type: "route"` items are used). The API rejects periods over 31 days, so the chosen
  period (at most 60 days) is split into windows of at most 30 Oslo days. Each window starts at 22:00 UTC the day
  before, and rows are kept by their Europe/Oslo start date; route ids are deduplicated across windows.
- `GET unit/list.json` for `number` (registration number) and `label`.
- `GET driver/list.json` for `name`, `surname`, `email` (optional; a key without driver access still works).

Mapping: `distance` is metres (the documented example has 15770 for a 16 minute route at 52 km/h average);
`start.address` and `end.address` are the route; purpose is `route_details.explanation`, then
`route_fields.client_title`. Mapon has no toll amounts. API errors (`{ error: { code, msg } }`) are mapped to clear
messages (1004/1005 key, 1008 no vehicles, 1011 request limit, 1006/1013 rights).

## Subrequests per action

- Fetch: 2 reference calls (units, drivers) + 1 route call per 30 days (2 for a 31 day month, at most 2), run in
  parallel within Mapon's limit of 5 concurrent requests; plus 2 ReAI reference calls.
- Book: up to 5 ReAI trip list pages for the duplicate check + at most 30 trip POSTs, so at most 35.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `GET /api/employees`, `GET /api/driving-log/vehicles` (match by email/name and registration number)
- `GET /api/driving-log/trips?page&pageSize=200` (duplicate check: date, route and distance)
- `POST /api/driving-log/trips` (`tripDate`, `fromLocation`, `toLocation`, `purpose`, `kilometers`,
  `roadTollAmount: 0`, optional `employeeId`, `vehicleId`)

## Accounting

ReAI books by the vehicle's accounting mode (`mileage_allowance` statutory rate, or `log_only`). With several active
ReAI vehicles a trip without a matching registration number (or a chosen fallback) is not sent.

## Caveats

- No live verification (no key). Whether Tracksys branded accounts show Settings → API keys is unverified.
- `route_fields.custom_distance` and `selected_distance` (user corrected distances, unit not stated) are not used.
- The trip list travels in a hidden form field between preview and booking and is validated again on booking.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
