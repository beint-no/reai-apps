# 4human HRM Employee Sync

Route `/app/4human/`. Docs pages: `web/content/{nb,en}/web-apps/4human/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://4human-api-doc-prod.s3.eu-west-1.amazonaws.com/prod/index.html
- https://4human-api-doc-prod.s3.eu-west-1.amazonaws.com/prod/openapi.yaml
- https://support.4humanhrm.no/hc/no/articles/4405979813522-Tilgang-til-data-via-REST-API-i-V8
- https://support.4humanhrm.no/hc/no/articles/34974007319442
- https://www.4human.no/hrm/integrasjon/

- Mode: api
- Auth: Customer orders REST API access from 4human support (support@4humanhrm.no) after creating a service user (Var organisasjon -> Onboard -> Inviter bruker); 4human agrees price/terms and delivers Client ID + Secret Key. App calls POST https://api.hrm-4human.com/token (form: grant_type=client_credentials, client_id, client_secret), then Authorization: Bearer <JWT> plus X-Api-Key: <instanceId claim from the JWT> (required from 2026-06-01).
- Hosts in code: `4human-api-doc-prod.s3.eu-west-1.amazonaws.com`, `api.hrm-4human.com`, `support.4humanhrm.no`
- Vendor status: Brreg (2026-11-28): not konkurs, not under avvikling or tvangsavvikling, no slettedato. 4human.no live, sells 4human HRM.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/employees`

## Caveats

API access is paid/agreed per customer via support, not self-service. Uses GET /personnel/employments?limit=100&page (items/pages envelope, cap 20 pages) and GET /personnel/profiles/{userId} (4 parallel, cap 200) for names, private contact, address, national ID (idType ssn) and paymentDetails.accountNumber (MOD11 checked). Skips employmentCalculatedStatus former/vacant; percent = presentFteFactor (fraction) x 100. Spec is from 2022 and may lag the live API; throttling (429) not retried, profile failures are skipped. POST /api/employees body uses verified CreateEmployeeReq fields (name, dateOfEmployment, email, phone, accountNumber, nationalIdentityNumber, addressPart1, postalCode, city, employmentLines[{startDate, percentage}]). The national ID travels in the hidden form field of the preview page (browser only, not stored). Side finding: existing huma.js posts startDate/bankAccountNumber, which are not CreateEmployeeReq fields (should be dateOfEmployment/accountNumber).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
