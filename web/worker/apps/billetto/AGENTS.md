# Billetto Ticket Sales Accounting

Route `/app/billetto/`. Docs pages: `web/content/{nb,en}/web-apps/billetto/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://api.billetto.com/llms.txt (index of the Billetto Public API v3 reference)
- https://api.billetto.com/reference/list-ledger-2.md (List Ledger Entries, OpenAPI 3.1 embedded)
- https://api.billetto.com/reference/list-orders-2.md (order, order line and transaction schemas)
- https://go.billetto.com/resources/developers (key pairs, Api-Keypair header)
- https://support.billetto.com/hc/articles/360020747740

- API version: Billetto Public API v3, `Billetto-Version: 2026-02-10` (newest in the header enum on 2026-11-28).
- Host: `https://billetto.no/api/v3` (servers enum lists billetto.no next to .dk, .se and others).
- Auth: key pair created by the organiser under Integrations → Developers → API - Key pairs, sent as `Api-Keypair: <id>:<secret>`. The developers page names the header but not the value format; the `id:secret` form is unverified. A pasted pair that already contains `:` is sent as is.
- Endpoint: `GET /organiser/ledger_entries?created_after=<UTC Oslo midnight>&created_before=<UTC next Oslo midnight>&limit=100[&after=<last id>]`. Cursor paging on `has_more` with `after` = last entry id. Entries are filtered again on `created_at` as an Oslo day.
- Fields read: `id`, `created_at`, `entry_type`, `transaction_type`, `revenue_channel`, `currency`, `vat_rate` (decimal string or `NO_VAT`), `amount` and `vat` (cents).
- Rate limit: cost headers `X-Ratelimit-*`; no fixed number published.
- Subrequests: fetch action at most 45 Billetto pages (4 500 entries, error above that); book action 1 to 2 voucher pages, 1 VAT codes, 1 POST.
- Vendor status: Brreg 996155064 BILLETTO AS: not konkurs, not under avvikling, no slettedato (2026-11-28). billetto.no live.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `GET /api/vouchers` (duplicate check on description prefix and voucher date)
- `GET /api/vat-codes`
- `POST /api/manual-vouchers` with `pairVoucherRows`

## Accounting mapping

- `ORDER_REVENUE` and `DISCOUNTS` (discounts reduce revenue) per VAT rate: credit `3000`/`3010`/`3020`/`3100`, VAT-inclusive output code; 0 % uses the exempt code.
- `ORGANIZER_PAYMENT_FEE`, `TICKETS_FEE`, `COMMISSION`, `INVOICE_FEE`, `PROMOTION_FEE`: debit `7770`; input VAT code only when the entry has non-zero `vat`.
- `CHARGEBACK`: debit `7790` without VAT.
- Counter line per `revenue_channel` on `1580`.
- `PAYOUT`, `IMMEDIATE_PAYOUT*`: shown as payouts, not booked. Other entry types (`WALLET_CHARGE`, `FAILED_PAYMENT_ATTEMPT`, `PAYMENT_SKIPPED`) are listed as not booked.
- Signs: magnitudes from `abs(amount)`; `REFUND`, `CANCELLATION`, `CHARGEBACK`, `REVERSE_ENTRY` transaction types reverse the line. The reference does not document signs or whether `amount` includes `vat`; each entry's `vat` decides (closest of inclusive or exclusive formula).
- Voucher date: last day of the period; currency from the entries and must equal the company currency.

## Caveats

No live verification (no credentials). Key pair value format, sign convention and VAT inclusion are inferred as described above. Revenue collected by the organiser's own terminal or cash (`revenue_channel` organizer) is also posted against `1580`; the user reclassifies in review if needed. Contact: dev@billetto.com (OpenAPI info.contact).

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
