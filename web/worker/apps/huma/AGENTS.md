# Huma HR

Route `/app/huma/`. Docs pages: `web/content/{nb,en}/web-apps/huma/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://humahr.com/knowledge/open-api
- https://openapi.humahr.com/redoc/index.html
- https://openapi.humahr.com/v3/api-docs

- Mode: fix
- Calls: POST https://openapi.humahr.com/auth/oauth/token (client_credentials with client_id/client_secret), GET /users?limit=50&offset&isActive=true ({items}), GET /users/{id} (givenName.value, familyName.value, email.value, employmentStartDate.value or firstDayOfWork.value, employmentPercentage.value, bankAccount.value national NO number, MOD11 checked). Matches GET /api/employees by email or name; creates via POST /api/employees (name, email, dateOfEmployment, accountNumber, bankCountryCode verified). CSV removed; max 100 active users per run.
- Hosts in code: `humahr.com`, `openapi.humahr.com`
- Vendor status: Brreg: HUMA AS active; humahr.com live; Open API documented at humahr.com/knowledge/open-api with spec at openapi.humahr.com/v3/api-docs.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/employees`

## Caveats

The key needs a role with read access to employees and bank account; new keys have no access until given a role. The help page shows the demo token URL; the spec's server is https://openapi.humahr.com with tokenUrl /auth/oauth/token. Position percentage is shown but not sent to ReAI (ReAI needs employmentLines). Shared test expects fetchHuma({apiToken}) and will fail.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
