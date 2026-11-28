# Hybel Journal

Route `/app/hybel/`. Docs pages: `web/content/{nb,en}/web-apps/hybel/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://hjelpesenter.hybel.no/knowledge/hvordan-tar-jeg-ut-regnskapsrapporter
- https://hjelpesenter.hybel.no/knowledge/hvordan-kan-jeg-importere-husleie-forfall-og-innbetalinger-til-mitt-regnskapssystem
- https://hjelpesenter.hybel.no/knowledge/hvordan-kan-hybel-premium-forenkle-regnskapsf%C3%B8ring-av-husleie
- https://hjelpesenter.hybel.no/knowledge/st%C3%B8tter-hybel-saf-t-regnskap

- Mode: keep
- Calls: Code unchanged. NB/EN docs rewritten with the real Hybel menu path (Rapporter > Innstillinger for accounts and VAT code 0, Rapporter > Bilagsjournal > Last ned) and the 1510/1520 account advice from Hybel's help centre.
- Vendor status: Brreg: no konkurs/avvikling/slettedato. hybel.no and hjelpesenter.hybel.no live; Hybel Premium sold with accounting reports and API integrations to Tripletex, PowerOffice, Fiken and others (not ReAI).

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/chart-of-accounts/accounts`
- `/api/company-banks`
- `/api/company-settings`
- `/api/manual-vouchers`
- `/api/vouchers`

## Caveats

Hybel documents that the Bilagsjournal exists in several system-specific CSV/Excel layouts but does not publish the column list, so column mapping stays heuristic with manual override. Only VAT code 0 is accepted. Hybel's own API integration pushes into named ERPs; there is no API a customer can call.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
