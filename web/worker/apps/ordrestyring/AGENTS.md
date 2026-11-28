# Ordrestyring Case Sync

Route `/app/ordrestyring/`. Docs pages: `web/content/{nb,en}/web-apps/ordrestyring/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://graphql.ordrestyring.dk/docs
- https://graphql.ordrestyring.dk/graphiql
- https://ordrestyring.dk/bliv-partner/
- https://docs.plecto.com/kb/guide/en/ordrestyring-4se49VoDG8/Steps/2979901
- https://help.mapon.com/en/articles/283431-how-to-set-up-and-manage-ordrestyring-integration

- Mode: api
- Auth: Customer asks Ordrestyring support for an API token (Plecto and Mapon guides describe the same route); sent as Authorization: Bearer <token> to POST https://graphql.ordrestyring.no/graphql (Norway) or https://graphql.ordrestyring.dk/graphql (Denmark), chosen in the form.
- Hosts in code: `graphql.ordrestyring.dk`, `graphql.ordrestyring.no`
- Vendor status: Brreg (2026-11-28): not konkurs, not under avvikling or tvangsavvikling, no slettedato. (Aceve Norge AS). ordrestyring.no redirects to aceve.com/no/produkter/ordrestyring, product still sold under the Aceve group; ordrestyring.dk live.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/employees`
- `/api/orders`
- `/api/projects`
- `/api/timesheets`

## Caveats

GraphQL, not REST. Both queries (hours with between {field: startTime, from, to, toInclusivity: EXCLUSIVE} and filters {isInvoiced: false}; caseMaterials type MATERIAL and OTHER_EXPENSE with filters {isInvoiced: false, createdAt between}) were validated with graphql-js against the downloaded introspection schemas of both .no and .dk hosts. Cursor pagination (limit 100, nextCursor, hasMorePages). Money is cents (divided by 100), UnixTime seconds; period bounds are Oslo midnights. Errors arrive with HTTP 2xx and an errors key, which is surfaced. Rejected hours skipped; only NOT_TRANSFERED hours/materials count toward the per case draft order (externalReference ordrestyring-<caseNumber>); DRAFTED/INVOICED lines are left out. Token issuance is not publicly documented by Ordrestyring itself (partner page mentions partner tokens; third party guides say support creates tokens). The .no GraphQL host is not named in the docs (it serves the same schema; Norwegian accounts live on system.ordrestyring.no), hence the region selector with Norway default. No docs example response for hours; mock built from schema types. Rate limit is per partner (60/min fallback). Secondary contacts: partnerships@aceve.com, support@ordrestyring.dk.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
