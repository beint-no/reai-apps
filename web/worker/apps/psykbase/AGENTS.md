# PsykBase Clinic Invoice Accounting

Route `/app/psykbase/`. Docs pages: `web/content/{nb,en}/web-apps/psykbase/index.md`.

Fetches PsykBase Online invoices for a period and books one balanced ReAI review voucher: VAT exempt treatment revenue, any taxable sales and payments by method.

## Vendor API

- PsykBase API article (links the reference): https://help.psykbase.no/nb/articles/204383-api
- Reference (now behind login): https://system.easypractice.net/api/index.html
- Public copy used for fields: https://web.archive.org/web/20260718211007/https://system.easypractice.net/api/index.html
- Platform page: https://easypractice.net/api/

PsykBase (Aspit AS) runs on the EasyPractice platform; `https://system.psykbase.no/api/v1/invoices` answers 401 JSON like the EasyPractice API. API version: v1 (the only version; no changelog or deprecation notice is published).

Auth: the clinic activates the API app, opens API settings and creates a Personal Access Token with scope `invoices-read`; sent as `Authorization: Bearer <token>`.

## Calls

- `GET /api/v1/invoices?order_by_number=desc&page_size=100&page=N`. Documented filters are id, number, client_id, paid, unpaid, order_by_number, page_size and page; there is no date filter, so pages are read newest first and stop when a page is short or its oldest invoice is before the period. Max 30 pages, otherwise "choose a more recent period".
- Fields used: date (offset datetime, its date part is the clinic's day), draft, paid, payment_type, currency, total, lines[].vat, lines[].vat_rate, lines[].total.

Rate limit: 60 requests per minute per token (429 with Retry-After). Subrequests per fetch: up to 30. Book: 3 ReAI calls.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/vat-codes` (checks 3, 31, 33 are vat_inclusive output codes and 6 is 0 %)
- `GET /api/vouchers?startDate&endDate&includeReversed=true` (duplicate check on "PsykBase invoices <from> to <to>")
- `POST /api/manual-vouchers` (rows via `pairVoucherRows`, NOK, dated the last day of the period)

## Accounting mapping

- Lines without VAT → 3200 with VAT code 6 (health services are outside the VAT act); 25/15/12 % lines → 3000/3010/3020 with 3/31/33, gross.
- Paid card or other → 1580, paid cash → 1900; unpaid, transfer and health_insurance (documented payment_type values) → 1570.
- Drafts skipped; non NOK invoices rejected; amounts in øre.

## Caveats

- How credit notes appear (negative invoice vs the `credited` flag) is not documented; non draft invoices are summed with their signed totals.
- The voucher is only offered when lines add up to invoice totals.
- Overlapping periods are not detected, only the exact same period.

Last verified: 2026-11-28
