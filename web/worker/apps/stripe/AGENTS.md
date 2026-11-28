# Stripe Import

Route `/app/stripe/`. Docs pages: `web/content/{nb,en}/web-apps/stripe/index.md`. Export: `handleStripe`.

Migration helper: imports simple fully paid zero VAT Stripe invoices as historical ReAI invoices (`accounting=none`) and stages simple active subscriptions in ReAI with automatic billing off.

## Vendor docs

- Invoices: https://docs.stripe.com/api/invoices/list, https://docs.stripe.com/api/invoices/object
- Subscriptions: https://docs.stripe.com/api/subscriptions/list, https://docs.stripe.com/api/subscriptions/object
- Pagination: https://docs.stripe.com/api/pagination
- Auth and restricted keys: https://docs.stripe.com/keys, https://docs.stripe.com/keys/restricted-api-keys
- Rate limits: https://docs.stripe.com/rate-limits
- Changelog and upgrades: https://docs.stripe.com/changelog, https://docs.stripe.com/upgrades

## API version

`Stripe-Version: 2026-11-18.endive`, the latest GA release in the changelog on 2026-11-28 (`.preview` versions are not used). Endive's only breaking release was 2026-09-30; 2026-10-28 and 2026-11-18 are additive and none touch invoices, subscriptions or list paging. Subscription periods are read from `items.data[].current_period_end` (moved there in Basil).

## Auth

Restricted key (`rk_live_` / `rk_test_`) from Dashboard → Developers → API keys → Create restricted key, with read on Customers, Invoices and Subscriptions. Sent as `Authorization: Bearer <key>`.

## Endpoints

- `GET /v1/account` (account id for `sourceInstance` and the subscription marker)
- `GET /v1/invoices?status=paid&limit=100[&created[gte]=<Oslo midnight>]&starting_after=<last id>`
- `GET /v1/subscriptions?status=active&limit=100&expand[]=data.customer&starting_after=<last id>`
- `GET /v1/invoices/{id}`, `GET /v1/subscriptions/{id}?expand[]=customer`

## Paging, rate limits, subrequests

- Cursor paging with `starting_after` and `has_more`, at most 5 pages of 100 per list; a note asks for a later start date when more exist.
- Stripe allows 100 requests per second per account in live mode (25 in a sandbox) and 25 per second per endpoint; one action stays far below that. 429 is reported, not retried.
- Preview: 1 account + 1 to 5 invoice pages + 1 to 5 subscription pages + ReAI customers pages + products pages + VAT codes (typically 6 to 10).
- Import invoice: 2 Stripe + 4 ReAI = 6. Stage subscription: 2 Stripe + customer, product, VAT codes, subscription list pages, a detail read only for existing rows with the same start date and interval, and the create (typically 7 to 8).

## ReAI endpoints

- Preview: `GET /api/customers?archived=false` and `GET /api/products?archived=false` (all pages), `GET /api/vat-codes?usage=customer_invoice`
- Actions: `GET /api/customers/{id}`, `GET /api/products/{id}` (ids from the preview, re-validated against the Stripe email and zero VAT code)
- `POST /api/invoices/import` (idempotent on source + externalId; changed data returns 409)
- `GET /api/subscriptions?customerId`, `GET /api/subscriptions/{id}`, `POST /api/subscriptions`

## Accounting mapping

- Invoice: one order item on the chosen zero VAT non-stock product, `price = total / 100`, payment on `paid_at`; `accounting=none`, so no revenue or VAT is posted again.
- Only invoices with zero tax, no credit notes, balances or overpayment and amount paid = total are eligible.
- Subscription: one line (`unit_amount / 100`, quantity), start date = next Stripe period end, interval 1 or 12 months, `automaticBillingGeneration=false`.
- Currency must equal the company currency and be one of NOK, EUR, USD, GBP (two decimal currencies). Dates are Europe/Oslo days of Stripe Unix timestamps.
- Customer: unique active ReAI customer whose email or invoice email equals the Stripe email.

## Caveats

- Whether `GET /v1/account` needs an extra restricted key permission was not verified; the UI asks for read on Account too.
- Subscription duplicate detection relies on the marker in `internalComment`.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28
