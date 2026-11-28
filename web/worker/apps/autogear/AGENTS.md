# Autogear Driving Log

Route `/app/autogear/`. Docs pages: `web/content/{nb,en}/web-apps/autogear/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://www.autogear.com/api
- https://api.autogear.com/docs/index.html
- https://api.autogear.com/swagger/v1/swagger.json
- https://www.tripletex.no/integrasjoner/autogear/

- Mode: api
- Auth: Account owner/admin requests API access under API clients in Autogear (opened within ~2 working days), then creates Client ID + Client Secret there. Integration logs in with POST https://api.autogear.com/authentication/login JSON {username,password,client_id,client_secret} (dedicated integration user) -> access_token JWT, then Authorization: Bearer on GET /Trip.
- Hosts in code: `api.autogear.com`, `www.autogear.com`
- Vendor status: Brreg (2026-11-28): not konkurs, not under avvikling or tvangsavvikling, no slettedato. autogear.no redirects to autogear.com, live, sells GPS tracking and driving log (footer org.nr 987 898 291).

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/driving-log/trips`
- `/api/driving-log/vehicles`
- `/api/employees`

## Caveats

Form takes four secrets (integration user email, password, Client ID, Client Secret); used for one request, never stored. GET /Trip uses fromDate/toDate/PageSize/PageNumber/status (2=confirmed default; 'All' omits status) and fields=fields(*). Private trips filtered on rateCategory name containing 'priv' and isCommute=true; TripDomainModel 'type' boolean is undocumented and ignored. Driver matched to ReAI employee by email, else fallback select. POST /api/driving-log/trips books a voucher atomically for mileage_allowance vehicles; the user clicks Record trip per row. No duplicate check (ReAI trips list has no date filter). Swagger also documents login response as {token}; code accepts access_token or token.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
