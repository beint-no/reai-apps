# 4human HRM Employee Sync

Route `/app/4human/`. Docs pages: `web/content/{nb,en}/web-apps/4human/index.md`.
Reads current employments and user profiles from 4human HRM and creates employees in ReAI, one per click.

## Vendor docs

- Reference: https://4human-api-doc-prod.s3.eu-west-1.amazonaws.com/prod/index.html
- OpenAPI: https://4human-api-doc-prod.s3.eu-west-1.amazonaws.com/prod/openapi.yaml (published 2022-06-30, still the current file on 2026-11-28)
- Access (order via support): https://support.4humanhrm.no/hc/no/articles/4405979813522-Tilgang-til-data-via-REST-API-i-V8
- Throttling and `X-Api-Key` (required from 2026-06-01, updated 2026-11-11): https://support.4humanhrm.no/hc/no/articles/34974007319442
- Product page: https://www.4human.no/hrm/integrasjon/
- Changelog: none published; changes are announced as support articles.

## API version

The single unversioned REST API on `https://api.hrm-4human.com` (V8 platform). No newer version is announced.

## Auth

The customer creates a service user (Vår organisasjon → Onboard → Inviter bruker) and orders API access from
support@4humanhrm.no; 4human agrees price and terms and delivers a Client ID and Secret Key. The app calls
`POST /token` (form: `grant_type=client_credentials`, `client_id`, `client_secret`) once per request, then sends
`Authorization: Bearer <JWT>` and `X-Api-Key: <instanceId claim of the JWT>` on every call.

## Endpoints used

- `GET /personnel/employments?limit=100&page=N` (items/page/pages envelope, at most 20 pages). Fields: userId, userName,
  emailWork, phoneNumberWork, startDate, presentFteFactor/fteFactor, number, employmentCalculatedStatus, isLastEmployment.
- `GET /personnel/profiles/{userId}`: firstName, surname, emailPrivate, phoneNumberPrivate, addressLine1, zipCode, city,
  personalIdentification (idType `ssn`), paymentDetails.accountNumber.

## Budget

Profiles are one call per employee, so the preview reads profiles for 25 employees at a time (sorted by userName,
`offset` from the **Next 25 employees** button, which re-posts the form). Per action: 1 token + 1 to 3 employment pages +
25 profiles (4 in parallel) ≈ 28 subrequests. `429` uses exponential backoff with jitter (0.5 s doubling, at most 3 retries,
`Retry-After` honoured up to 12 s) as 4human recommends, then asks the user to wait.

## ReAI API

- `GET /api/employees` (once on preview, once before each create) to skip employees with the same email or name.
- `POST /api/employees`: name (≤ 75), dateOfEmployment, email, phone (≤ 30), accountNumber, nationalIdentityNumber,
  addressPart1, postalCode, city, employmentLines[{ startDate, percentage }].

## Mapping

Statuses `former` and `vacant` are skipped; one employment per user (the last one). Percentage = presentFteFactor × 100
(1 to 100). Bank account only when it passes MOD11; national ID only when `idType` is `ssn` and 11 digits. No user,
invitation, A-melding or payroll is created.

## Caveats

- API access is paid and agreed per customer with 4human support, not self-service.
- The OpenAPI file dates from 2022 and may lag the live API; `limit` has no documented maximum.
- The national ID travels in the preview page's hidden form field (browser only, never stored).

## Rules

- Use only documented endpoints, auth, parameters and fields on the newest API version, with server-side paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28
