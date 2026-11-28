# Huma Employee Sync

Route `/app/huma/`. Docs pages: `web/content/{nb,en}/web-apps/huma/index.md`.

Reads active Huma users and creates the missing ones as ReAI employees (name, email, phone, home address, start date, Norwegian bank account). Sends no invites and no A-melding.

## Vendor docs

- Setup and auth: https://humahr.com/knowledge/open-api
- Reference: https://openapi.humahr.com/redoc/index.html
- Spec: https://openapi.humahr.com/v3/api-docs (Huma API 1.96.0 on 2026-11-28)
- Changelog: none published; compare the spec `info.version`.

## API version

Huma Open API, unversioned paths on `https://openapi.humahr.com` (spec 1.96.0). Uses `currentPositions` for start date and percentage because the top-level `employmentStartDate`, `firstDayOfWork` and `employmentPercentage` are deprecated in the spec; those remain only as fallbacks.

## Auth

Admin creates an API key under System settings → Open API (client ID + secret, secret shown once) and gives it a role that can read employees, positions, addresses and bank accounts. A new key has no access. `POST /auth/oauth/token` (form, `grant_type=client_credentials`), then `Authorization: Bearer <access_token>`. One token exchange per action; nothing stored.

## Endpoints

- `POST /auth/oauth/token`
- `GET /users?limit=50&offset=&isActive=true&orderDirection=ASC` (limit max 50; returns `{ items, total }` with givenName, familyName, email, phone, type)
- `GET /users/{id}` only for users not yet in ReAI: `currentPositions[].contractStartDate|percentage`, `homeAddress.value`, `phone.value`, `bankAccount.value` (`type: national`, `country`, `number`)

## Paging, limits, budget

- No rate limit documented. List stops on a short page or when `total` is reached; capped at 20 pages (1,000 users).
- Details for at most 25 new users per run, 5 in parallel. A "Skip new employees" field loads the next batch.
- Fetch: 1 ReAI + 1 token + ceil(users / 50) list + ≤ 25 detail subrequests (62 users, none in ReAI: 29). Import: 1 ReAI duplicate check + 1 POST.

## ReAI endpoints

Contract: https://app.reai.no/openapi/public.

- `GET /api/employees` (array of `{ id, name, email }`) for matching by email, then name, on fetch and again before create
- `POST /api/employees` (`name` ≤ 75, `email`, `phone` ≤ 30, `dateOfEmployment`, `accountNumber` + `bankCountryCode: NO`, `addressPart1`/`postalCode`/`city`/`countryCode`)

## Mapping

Start date = earliest current position contract start; percentage = sum of current positions (display only; ReAI needs `employmentLines`, which are not sent). Only national NO bank accounts that pass MOD11 are sent. Users of type other than `user` (service users) are skipped.

## Caveats

- ReAI may require email or national identity number for an active employee; Huma users without email will get the ReAI error.
- Home address country is passed only when it is a two-letter code.

Last verified: 2026-11-28
