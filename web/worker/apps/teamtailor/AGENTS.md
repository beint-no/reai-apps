# Teamtailor New Hires

Route `/app/teamtailor/`. Docs pages: `web/content/{nb,en}/web-apps/teamtailor/index.md`.

Purpose: read candidates in a Hired stage from Teamtailor and create them, one click each, as ReAI employees with
name, contact details and start date.

## Vendor docs

- API reference (Postman documenter, JSON:API): https://docs.teamtailor.com/
  (collection JSON: https://docs.teamtailor.com/api/collections/14157246/TVzSiGxA?segregateAuth=true&versionTag=latest)
- Key management: https://app.teamtailor.com/app/settings/integrations/api-keys
- Help article: https://support.teamtailor.com/en/articles/5963369-use-our-teamtailor-api
- Changelog: the "Changelog" section at the end of https://docs.teamtailor.com/

## API version and auth

- REST `v1` with the dated header `X-Api-Version: 20240904`. The changelog entry of 2025-10-01 says every request
  must send this version; it is the newest dated version (later changelog entries are additive).
- Hosts: EU stack `https://api.teamtailor.com`, NA stack `https://api.na.teamtailor.com` (user picks the region).
- Key: a Company Admin opens Settings → Integrations → API keys → New API key, scope Admin, Read. Job applications,
  candidates and onboardings need the Admin scope. Header `Authorization: Token token=<key>`.

## Endpoints

- `GET /v1/job-applications?include=candidate,job&filter[stage-type]=hired&filter[changed-stage-at][from]=<date>&sort=-changed_stage_at&page[size]=30`
  (the documented "List latest hired candidates" request plus the documented changed-stage-at filter). Follows
  `links.next` up to 10 pages (300 hires). Applications with `rejected-at` set are skipped; one row per candidate.
  Candidate attributes used: `first-name`, `last-name`, `email`, `phone`, `address`, `zip`, `city`,
  `country-code`. Job attribute `title`.
- `GET /v1/onboardings?include=candidate&page[size]=30`, up to 5 pages. Only with the Onboarding add-on; any error is
  ignored and the start date is then chosen per row. Attributes `start-date`, `work-email`, `status` (archived
  skipped). There is no documented date filter on onboardings.
- Rate limit 50 requests per 10 seconds; 429 surfaces as an error.

## Subrequests per action

- Fetch: 1 to 10 job application pages + 1 to 5 onboarding pages + 1 `GET /api/employees`. Typically 3, at most 16.
- Create employee: 1 `GET /api/employees` (duplicate check) + 1 `POST /api/employees`.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/employees` (match by work email, candidate email or exact name)
- `POST /api/employees` with `CreateEmployeeReq` fields only: `name`, `dateOfEmployment`, `email`, `phone` (max 30),
  `addressPart1`, `postalCode`, `city`, `countryCode` (ISO alpha-2 only), `employmentLines[{ startDate }]`.

## Caveats

- No live verification (no Teamtailor account). Response shapes follow the documented examples and JSON:API
  (`relationships.<rel>.data` and `included` when `include` is sent).
- Date format for `filter[changed-stage-at][from]` is not spelled out; a plain `YYYY-MM-DD` is sent.
- Hired dates are `changed-stage-at` converted to Europe/Oslo. A candidate moved out of Hired after the date is
  not listed.
- Salary from job offers (`details.salary`) is free text and is not imported. National identity number, bank account
  and tax card must be added in ReAI.
- The candidate JSON travels in a hidden form field between preview and create (browser only, not stored).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
