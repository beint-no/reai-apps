# Fazile Lease Billing

Route `/app/fazile/`. Docs pages: `web/content/{nb,en}/web-apps/fazile/index.md`.

## Purpose

Reads active lease contracts and tenants from the Fazile customer API and stages one ReAI subscription per contract and invoice interval, with automatic billing off.

## Vendor docs

- Reference (Swagger UI): https://api.fazile.no/clients/swagger-ui/index.html
- OpenAPI JSON: https://api.fazile.no/clients/v3/api-docs
- API overview: https://fazile.net/integrasjon-og-api/
- Key creation: https://hjelp.fazile.net/docs/oppretting-av-api-nokkel-for-tredjepartsapplikasjoner/
- Annual prices: https://hjelp.fazile.net/docs/endring-av-arsleie-og-justering-av-basispriser/
- No public changelog or deprecation page exists; the OpenAPI is the only versioned source.

## API version and auth

- Client API `v1` (OpenAPI info version v0.0.1); it is the only version published. Base `https://api.fazile.no/clients/v1`.
- Key: Fazile → Firmaprofil → API Nøkler → Opprett API-nøkkel (whole account or chosen portfolios, read access only, shown once). Fazile bills key activation per agreement.
- Header `token: <key>` (security scheme `token`, in header).

## Endpoints used

- `GET /v1/contracts?skip&limit`: default returns only active contracts (`notOnlyActiveContracts` left unset); `contract_lines` are embedded, so no per contract calls.
- `GET /v1/tenants?skip&limit`: org.nr and emails for matching.
- Both run in parallel.

## Paging, limits, subrequest budget

- `skip` is a row offset. No maximum `limit` and no rate limit are documented, so the module asks for 500, advances `skip` by rows returned and stops on an empty page or a page shorter than an earlier one (correct even if the server caps `limit`). Max 8 pages per list, then a clear error asking to narrow the key to fewer portfolios.
- Fetch action: 2 to 16 Fazile calls + `GET /api/vat-codes` + `GET /api/customers` (paged by `reaiAll`, 200 per page). Typical portfolio: 6.
- Stage action: `GET /api/vat-codes` + `GET /api/subscriptions?customerId&active=true` (duplicate check) + `POST /api/subscriptions` = 3.

## ReAI endpoints

- `GET /api/vat-codes?usage=customer_invoice`
- `GET /api/customers?archived=false`
- `GET /api/subscriptions?customerId&active=true&pageSize=200`
- `POST /api/subscriptions` (`SubscriptionWriteReq`: `billingTiming=in_advance`, `periodAlignment=start_date`, `outputMode=create_order`, `automaticBillingGeneration=false`, `currencyCode=NOK`)

## Accounting mapping

- Line types RENT, COMMON_COSTS, MARKETING, PARKING, CUSTOM are billed; DISCOUNT, RENT_EXEMPTION, ACCRUAL, TENANT_IMPROVEMENT_VAT, ACTUAL_VAT are counted and left out.
- Lines in force on the reference day (today, or contract start when later): `start_date <= ref` and `end_date` empty or `>= ref`. Later price steps are left out.
- `total_price` is the annual amount; per invoice amount = annual × interval months / 12, rounded to øre. Interval from `frequency` (MONTHLY 1, EVERY_TWO_MONTHS 2, QUARTERLY 3, EVERY_FOUR_MONTHS 4, BI_YEARLY 6, YEARLY 12), else the user's default.
- VAT: `tax_vat_percent` > 0 maps to the ReAI `output_vat` code with that rate (not reverse charge); 0 % lines use the user chosen 0 % code. Codes are rechecked on stage.
- Start date: earliest `next_invoice_date` of the billed lines, else today.
- Customer match: org.nr, then invoice or contact email, then exact name.
- Duplicate check: an active subscription for the customer with the same start date, interval and subtotal blocks the POST (409).

## Caveats

- `frequency` is typed as a free string; values are assumed to follow the invoice frequency enum.
- Fazile has no currency field; amounts are taken as NOK.
- Fazile normally sends invoice basis to the landlord's ERP itself; the UI says so.
- Not tested against a live key; tests use the OpenAPI schemas.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
