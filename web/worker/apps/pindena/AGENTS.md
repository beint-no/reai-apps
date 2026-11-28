# Pindena Course Registration Accounting

Route `/app/pindena/`. Docs pages: `web/content/{nb,en}/web-apps/pindena/index.md`.

Books the prepaid registrations of one Pindena activity as one ReAI review voucher.

## Vendor docs

- API index: https://faq.pameldingssystem.no/category/258-api-hos-pindena-pameldingssystem
- Activity: https://faq.pameldingssystem.no/article/479-api-vis-aktivitet
- Participants: https://faq.pameldingssystem.no/article/244-deltagerlisteapi
- Activity list: https://faq.pameldingssystem.no/article/245-aktivitetsliste
- Auth and access: https://faq.pameldingssystem.no/article/259-hva-er-api
- Changelog: the help site's "Versjonslogg" section (no API changelog or deprecations published)

## API version and auth

- `/api/v1` is the only published version. `TotalPrice` on participants arrived in Pindena 6.6.0.
- The customer asks Pindena for API access (paid add-on) and gets a username and password.
  Header: `Authorization: Basic base64(username:password)`.
- Host: the organisation's own Pindena address (for example `https://<org>.pameldingssystem.no`,
  custom domains possible). The docs only give paths, so the user enters the address (SSRF guarded).

## Endpoints

- `GET /api/v1/activities/{id}`: `Title`.
- `GET /api/v1/activities/{id}/participants`: JSON array, no paging. Without `updated_after` or
  `updated_before` it returns only `registered` and `confirmed` participants, which is what we want.
  Fields used: `Status`, `Paid` (`NotPaid|Paid|Invoiced|Due|Credited`), `TotalPrice`.
- No rate limit is documented.

## Subrequests per action

- Fetch: 2 (activity, participants).
- Book: 1 `GET /api/vat-codes`, 1 or more `GET /api/vouchers` pages (manual vouchers within
  ±120 days of the voucher date, 200 per page), 1 `POST /api/manual-vouchers`. Pindena is not
  called again: the preview voucher is posted back and revalidated (balance, accounts, VAT codes).

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `GET /api/vat-codes` (code exists, rate matches, `vat_inclusive`, not reverse charge)
- `GET /api/vouchers?voucherType=manual&includeReversed=true` (duplicate check on the description marker `Pindena activity <id> prepaid`)
- `POST /api/manual-vouchers` with `reviewReason`, rows from `pairVoucherRows`

## Accounting mapping

- Debit `1580` (VAT code 0) for the sum of `TotalPrice` of participants with `Paid = Paid`.
- Credit revenue gross with the output VAT code the user picks: `3200`/6 outside the VAT act,
  `3000`/3 25 %, `3010`/31 15 %, `3020`/33 12 %. ReAI splits net and VAT.
- `Invoiced`, `Due` and `NotPaid` are counted and shown but not booked; `Credited` is excluded.
- NOK only; amounts are rounded to øre per participant.

## Caveats

- The API carries no VAT, payment date or payment method, so the user picks VAT treatment and
  voucher date. `Paid` may also cover invoices paid later; the docs only say Paid means paid.
- An activity can be booked once (marker check), so registrations paid after booking need a
  manual voucher.
- `Active` (0/1) on participants is not documented further and is not used.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
