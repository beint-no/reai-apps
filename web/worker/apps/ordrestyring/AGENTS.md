# Ordrestyring Case Sync

Route `/app/ordrestyring/`. Docs pages: `web/content/{nb,en}/web-apps/ordrestyring/index.md`.

Reads uninvoiced Ordrestyring hours and case materials, logs the hours as ReAI timesheet rows and stages
one draft ReAI order per case.

## Vendor API

- Reference and auth, paging, errors, rate limits: https://graphql.ordrestyring.dk/docs
- Schema explorer: https://graphql.ordrestyring.dk/graphiql (introspection needs a token)
- Partner page: https://ordrestyring.dk/bliv-partner/
- Token route described by third parties: https://docs.plecto.com/kb/guide/en/ordrestyring-4se49VoDG8/Steps/2979901,
  https://help.mapon.com/en/articles/283431-how-to-set-up-and-manage-ordrestyring-integration
- No public changelog or versioning; the GraphQL schema is unversioned (single endpoint).

- Auth: the customer asks Ordrestyring support for an API token; sent as `Authorization: Bearer <token>`
  to `POST https://graphql.ordrestyring.no/graphql` (Norway, default) or
  `https://graphql.ordrestyring.dk/graphql` (Denmark), chosen in the form.
- Hosts in code: `graphql.ordrestyring.no`, `graphql.ordrestyring.dk`
- Vendor status: Aceve Norge AS (812702742), Brreg 2026-11-28: active. ordrestyring.no redirects to
  aceve.com/no/produkter/ordrestyring; product still sold.

## Queries

- `hours(pagination: {cursor, limit: 100}, between: {field: startTime, from, to, toInclusivity: EXCLUSIVE}, filters: {isInvoiced: false})`
- `caseMaterials(type: MATERIAL | OTHER_EXPENSE, pagination, filters: {isInvoiced: false, createdAt: {from, to, toInclusivity: EXCLUSIVE}})`
- Cursor paging with `nextCursor` while `hasMorePages`, max 50 pages per query. The three queries run in
  parallel. `from`/`to` are Unix seconds of Norwegian midnight; the end day is inclusive.
- Money (`salesPrice`, `total`) is in cents; `startTime`, `materialDate`, `createdAt` are Unix seconds.
- Errors can arrive with HTTP 2xx and an `errors` key; the first message is shown.
- Validated with graphql-js against the introspection schemas of both hosts (saved in the session
  scratchpad, `dl/schema-{no,dk}.json`).

## Budget and limits

- Fetch: 3 GraphQL requests per 100 rows of each query (usually 3 total) + ReAI lists (customers and
  projects at 200 per page, employees 1).
- Stage order: 2 ReAI calls. Log hours: 2 ReAI calls (duplicate check + create).
- Rate limit per partner: 1,000 per minute on weekdays 05:30 to 23:59, 4,500 at night and weekends,
  60 per minute fallback; 429 with `Retry-After`.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/customers?archived=false`, `GET /api/employees`, `GET /api/projects?archived=false` (mapping by name)
- `GET /api/orders?externalReference=ordrestyring-<case>&pageSize=1` then `POST /api/orders` (draft order:
  customerId, company currency, daysUntilDue 14, issueDate, orderDate, externalReference, comment,
  projectId, one line itemName/quantity 1/unitPrice ex. VAT; VAT code from the customer default)
- `GET /api/timesheets?startDate&endDate&employeeId` (duplicate check on the `[Ordrestyring OS-<id>]`
  comment prefix) then `POST /api/timesheets` (employeeId, date, hours 0.01 to 24, projectId, comment)

## Mapping and caveats

- Rejected hours are skipped. Only `NOT_TRANSFERED` hours and materials count toward the case order;
  `DRAFTED` or invoiced lines are left out.
- Order amounts are the Ordrestyring account currency booked as the ReAI company currency; a Danish
  account with a NOK company is not converted.
- Token issuance is not publicly documented by Ordrestyring. The `.no` host is not named in the docs but
  serves the same schema. No docs example responses; tests use mocks built from schema types.
- Materials are filtered on `createdAt`, dated by `materialDate` when set.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
