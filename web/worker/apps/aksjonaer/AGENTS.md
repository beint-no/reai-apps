# Share Investment Importer (aksjonaer)

Route `/app/aksjonaer/`. Docs pages: `web/content/{nb,en}/web-apps/aksjonaer/index.md`.

## Purpose

Registers share holdings from a portfolio CSV in ReAI Share Investments and lists the holdings already in ReAI. Calls no third-party API; the only input is the uploaded CSV.

## Input

CSV (semicolon or comma, UTF-8 or Windows-1252, parsed by `lib/csv.js`). Header names are matched loosely, Norwegian or English:
Name/Navn (required), ISIN, Ticker, Org, Type (listed, unlisted, fund, bond, other), Account/Konto (4 digits), Quantity/Antall, Cost/Kostpris, Date/Dato, Exemption/Fritak (yes/no; empty means not assessed). Numbers accept `1 234,50`, `1.234,50` and `1234.50`; invalid values reject the file with the row number.

## ReAI API

Contract: https://app.reai.no/openapi/public (version v1). Endpoints used:

- `GET /api/share-investments`: plain array (not paged). Used for the live list and the duplicate check.
- `GET /api/securities?query=<ISIN>&limit=5&includeInactive=true`: shared catalogue; exact ISIN match gives `securityId`.
- `POST /api/share-investments` (`ShareInvestmentReq`): with a catalogue hit sends `securityId` and no local metadata (the catalogue's canonical metadata is read only); otherwise `name`, `instrumentType`, `ticker`, `isin`, `organizationNumber`. Opening fields `openingQuantity`, `openingCostAmount` (rounded to 2 decimals, tenant currency), `openingDate` are sent only with a quantity. `assetAccountNumber` only when given (ReAI default otherwise). `withinExemptionMethod` is the CSV value or `null`, never assumed.

## Subrequests per action

- Live list: 1. Preview: 1 (existing holdings, for duplicate flags). Register one row: 2 to 3 (re-read holdings, catalogue lookup when ISIN, POST).

## Accounting mapping

No vouchers. Holdings are registered as openings; `openingTaxBasisAmount` is never sent (omission means unknown, which is correct when the CSV has no tax basis). `costPrice` in responses is the carrying amount of the whole position, not a unit price.

## Caveats

- Duplicate check: same ISIN, or same name when the row has no ISIN. Closed holdings count as existing.
- Historical FIFO lots belong in `POST /api/share-investments/{id}/opening-lots/import`; Nordnet transactions in ReAI's own `POST /api/share-investments/import/nordnet` (linked from the UI copy, not called here).
- Unverified: whether ReAI accepts `name` alongside `securityId`; the app sends only `securityId` to stay within the documented rule.
- Preview shows at most 80 rows.

Last verified: 2026-11-28.
