# EasyPractice

Route `/app/easypractice/`. Docs pages: `web/content/{nb,en}/web-apps/easypractice/index.md`.

## Purpose

Books the EasyPractice invoices dated in a period as one balanced ReAI review voucher, split by VAT rate and payment status.

## Vendor docs

- Reference (Documentarian, now behind the EasyPractice login): https://system.easypractice.net/api/
- Last public copy: https://web.archive.org/web/20260718211007/https://system.easypractice.net/api/index.html
- Product page: https://easypractice.net/api/
- No public changelog. API support: api@easypractice.net.

## API

- Version: `v1`, the only published version (`https://system.easypractice.net/api/v1`).
- Auth: personal access token, `Authorization: Bearer {token}`. The customer activates the API app under Apps, opens API Settings, clicks Create New Token under Personal Access Tokens and picks scope `invoices-read`.
- Endpoint: `GET /invoices?order_by_number=desc&page_size=100&page=N`. Documented filters are only id, number, client_id, paid, unpaid; there is no date filter, so invoices are read newest first and filtered by `date` here. Paging stops at `meta.last_page`, an empty page, or the first page whose invoices are all older than the period.
- Fields used: `draft`, `number`, `date` (ISO with offset; first 10 characters are the local day), `paid`, `payment_type`, `credited`, `currency`, `lines[].vat`, `lines[].vat_rate`, `lines[].total` (incl. VAT).
- Rate limit: 60 requests per minute per token; `429` with `Retry-After` is shown to the user.
- page_size maximum is not documented (default 10); 100 is used.

## Subrequest budget

- Preview: at most 40 invoice pages (4,000 invoices newer than the period start); beyond that the user is asked for a more recent period instead of a silently truncated total.
- Book: `GET /api/vouchers` (1 page per 200 vouchers that day), `GET /api/vat-codes`, `POST /api/manual-vouchers` = 3.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/vouchers?startDate&endDate&includeReversed=true` duplicate check on the description marker `EasyPractice invoices A to B YYYY-MM-DD`.
- `GET /api/vat-codes` for output VAT codes.
- `POST /api/manual-vouchers` with `date`, `description`, `reviewReason`, `postings` from `pairVoucherRows`.

## Accounting mapping

- Debit 1900 paid with `payment_type` `cash`, 1580 paid with any other type (transfer, card, other, mobile_pay, health_insurance, swish), 1570 unpaid.
- Credit 3000 per VAT rate (VAT inclusive, ReAI `output_vat` code for that rate) and 3100 for lines without VAT, preferring an `outside_scope` code (treatments are outside the VAT Act), then `exempt`, then zero rated output VAT.
- Currency from the invoices; all must share one currency, and booking requires it to match the company currency.
- Voucher date is the period end.

## Caveats

- How credit notes appear in the invoice list is not documented. Invoices with `credited: true` are listed in a preview warning; signed totals are summed as returned.
- Ordering by number assumes invoice numbers rise with invoice date.
- ReAI's split between `outside_scope` and `exempt` codes is assumed, not verified against a live tenant.

Last verified: 2026-11-28
