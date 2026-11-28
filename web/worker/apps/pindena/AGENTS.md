# Pindena Course Registration Accounting

Route `/app/pindena/`. Docs pages: `web/content/{nb,en}/web-apps/pindena/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://faq.pameldingssystem.no/category/258-api-hos-pindena-pameldingssystem
- https://faq.pameldingssystem.no/article/479-api-vis-aktivitet
- https://faq.pameldingssystem.no/article/244-deltagerlisteapi
- https://faq.pameldingssystem.no/article/245-aktivitetsliste
- https://faq.pameldingssystem.no/article/259-hva-er-api
- https://faq.pameldingssystem.no/article/484-tripletex-integrasjon

- Mode: api
- Auth: Customer asks Pindena for API access (paid add-on); Pindena issues a username and password for Basic Auth. App sends Authorization: Basic base64(username:password) to the organisation's Pindena address (e.g. https://<org>.pameldingssystem.no).
- Hosts in code: `faq.pameldingssystem.no`, `yourorg.pameldingssystem.no`
- Vendor status: Brreg (2026-11-28): not konkurs, not under avvikling or tvangsavvikling, no slettedato. pindena.no redirects to pameldingssystem.no, live, sells Pindena Påmeldingssystem.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/manual-vouchers`
- `/api/vat-codes`
- `/api/vouchers`

## Caveats

API docs give paths (/api/v1/activities/<id>, /api/v1/activities/<id>/participants) but not the host; https://<org>.pameldingssystem.no/api/v1/activities answers 401 'Invalid credentials', so the app takes the customer's Pindena address (custom domains possible), SSRF guarded. Participant fields used: Status, Paid (NotPaid|Paid|Invoiced|Due|Credited), TotalPrice. Only Paid participants are booked (1580 vs revenue); invoiced/due/unpaid shown but not booked; Credited excluded. The API carries no VAT or payment date, so the user picks VAT treatment (6 outside VAT act on 3200, or 3/31/33) and the voucher date. 'Paid' may also cover invoices later paid; docs only say Paid means paid. Duplicate check looks for the activity marker within +-120 days of the voucher date.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
