# EG HoltePortalen

Route `/app/holte/`. Docs pages: `web/content/{nb,en}/web-apps/holte/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://smartapizulu.holte.no/index.html
- https://smartapizulu.holte.no/swagger/1.0/swagger.json
- https://smartapizulu.holte.no/Documentation/Tokens.pdf

- Mode: rename
- Calls: Branded 'EG HoltePortalen', timesheets only. Header X-Holte-Token; GET https://smartapizulu.holte.no/odata/User ($select), /odata/Registration ($filter date range and optional userId, $top/$skip paged; uses date, totalHours, projectId, userId, comment; skips absenceCodeId and isNegative), /odata/Project for projectNumber+projectName. Posts POST /api/timesheets. Orders path and CSV removed.
- Hosts in code: `smartapizulu.holte.no`
- Vendor status: Brreg: EG HOLTE AS active; holte.no redirects to egsoftware.com/no/byggebransjen listing 'EG HoltePortalen'; HoltePortalen API Swagger live at smartapizulu.holte.no.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/employees`
- `/api/projects`
- `/api/timesheets`

## Caveats

The Swagger lists OData collections but not the $filter/$top/$skip query options; they are standard OData v4 and the response is parsed as either an array or { value }. Whether 'date' is returned as local midnight or UTC is not documented. smartapizulu.holte.no is the only published API host (no separate production host documented). Shared Trades test for holte expects Bearer and the invented shape and will fail. Brand rename may need catalog title update.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
