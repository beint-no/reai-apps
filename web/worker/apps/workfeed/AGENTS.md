# Workfeed Shift Hours

Route `/app/workfeed/`. Docs pages: `web/content/{nb,en}/web-apps/workfeed/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://docs.workfeed.io/
- https://help.workfeed.io/en/articles/15956343-how-to-get-access-to-our-api
- https://help.workfeed.io/nb/articles/15956343

- Mode: api
- Auth: Customer (Pro+ plan) creates a key in Workfeed: Settings -> Integrations -> Workfeed API (Innstillinger -> Integrasjoner -> Workfeed API). Header Authorization: <API key> (no Bearer prefix). Base https://europe-west1-production-eu-327a3.cloudfunctions.net/api/companies/{companyID}/...
- Hosts in code: `docs.workfeed.io`, `europe-west1-production-eu-327a3.cloudfunctions.net`, `help.workfeed.io`
- Vendor status: Danish company Workfeed ApS (CVR 38921746, active, not bankrupt per cvrapi.dk), no Norwegian register entry. workfeed.io live, sells scheduling, time tracking and payroll.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/employees`
- `/api/projects`
- `/api/timesheets`

## Caveats

Keys are always read/write (no read-only option); the app only GETs shifts, employees and departments and says so in the UI and docs. Docs do not say where the customer finds the companyID; the user must enter it. No pagination documented for GET /shifts; rows capped at 1000. Hours = end minus start minus customBreak.duration; approved shifts only by default (approval != null); docs do not state outright that start/end are the approved times. Shifts are queried one day wider in UTC and filtered on the Europe/Oslo calendar day. Bulk post button posts all matched rows after a confirm checkbox. Partner contact is a form at https://workfeed.io/integration-partners/ (type Integration or API).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
