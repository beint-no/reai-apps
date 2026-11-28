# SpeedyCraft Work Order Sync

Route `/app/speedycraft/`. Docs pages: `web/content/{nb,en}/web-apps/speedycraft/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://www.devinco.com/developer/speedycraft/start/
- https://www.devinco.com/developer/speedycraft/connect/
- https://www.devinco.com/developer/speedycraft/paging-filtering-and-sorting/
- https://api.speedycraft.devinco.com/openapi/v1.json
- https://api.speedycraft.devinco.com/scalar
- https://support.devinco.com/hc/en-us/articles/206459623-SpeedyCraft-API-documentation

- Mode: api
- Auth: Devinco support (support@devinco.com) issues a subjectId and apiKey for the integration user plus the SpeedyCraft client GUID. Worker POSTs {clientId: 3, subjectId, apiKey} to https://connect.devinco.com/Token/GenerateAccessTokenFromCache, then sends Authorization: Bearer <token> and clientId: <GUID> to https://api.speedycraft.devinco.com. Cloud hosted SpeedyCraft only.
- Hosts in code: `api.speedycraft.devinco.com`, `connect.devinco.com`, `www.devinco.com`
- Vendor status: Brreg (2026-11-28): not konkurs, not under avvikling or tvangsavvikling, no slettedato. speedycraft.no redirects to devinco.com, which lists SpeedyCraft as a current product.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/employees`
- `/api/orders`
- `/api/projects`
- `/api/timesheets`
- `/api/{id}`

## Caveats

Token response body is undocumented ('paste the access token provided from the response'); code accepts a bare/JSON string or accessToken/access_token/token fields. Spec field names are PascalCase with no examples; code reads PascalCase and falls back to camelCase. Endpoints: GET /api/AssignmentService (Filters=ServiceDate>=from,ServiceDate<to+1,Approved!=2), /api/AssignmentProduct (RegDate range), /api/Service, /api/Employee, /api/Assignment and /api/Customer by id using the documented Field==a|b OR syntax in chunks of 50; Page/PageSize=200, plain arrays. Hours = Quantity for service types with IncludeInTotal != false and ServiceType != 1 (absence). Work order total = Quantity * ModPrice (or ModPriceOut for products) * (1 - ModDiscount), one draft order per Assignment (externalReference speedycraft-<AssignmentIdtext>). Invoice basis assembly is inferred; SpeedyCraft has no dedicated invoice basis endpoint and does not mark invoiced lines in a filterable way, so already invoiced work could be staged; the ReAI duplicate check guards only per work order. Devinco says API transaction fees may apply. Docs list two different test auth hosts; production host used. Devinco Connect token call bypasses fetchJson (fixed https host constant) because the body may be a bare string.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
