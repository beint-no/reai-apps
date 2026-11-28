# Råfisklaget Settlements

Route `/app/rafisklaget/`. Docs pages: `web/content/{nb,en}/web-apps/rafisklaget/index.md`.

Purpose: read a fisher's settlements (avregninger) from Norges Råfisklag's SeddelData web service and book each one as a
balanced ReAI review voucher.

## Vendor docs

- Integrations page (operations, XSDs, WSDL, contact): https://www.rafisklaget.no/informasjon-og-veiledninger/oversikt-systemleverandoerer-og-integrasjoner
- WSDL: https://ws.rafisklaget.no/seddeldata/SeddelDataService?WSDL (types: `?xsd=1` on the address it lists)
- Settlement format: https://www.rafisklaget.no/media/v0onjf1b/seddelavregning.xsd (updated 2021-06-26 for ressursavgift)
- Settlement list format: https://www.rafisklaget.no/media/pprj3cln/avregninglisteresp.xsd
- Vendor: Norges Råfisklag SA, orgnr 938469148. Brreg 2026-11-28: not konkurs, not under avvikling or tvangsavvikling,
  no slettedato. Existing accounting integrations by others: Jupiter Seddelsky.

## API version and auth

SeddelData SOAP 1.2, document/literal (JAX-WS), `targetNamespace http://seddeldatanrl.rafisklaget.no/`. No version
number is published; the XSDs carry update dates. Parameters are unqualified elements and include `brukernavn` and
`passord` in every request body (no header auth). The fisher or the accountant applies for web service access on
Min side (minside.rafisklaget.no) or through it-vakt@rafisklaget.no; Råfisklaget issues the username and password.
Each operation returns its XML document as an escaped string in `<return>`; errors come as `<feil>` (CDATA) in a
`seddelDataRetur` document, for example `Ugyldig brukernavn/passord` (probed 2026-11-28 with dummy credentials).

## Endpoints

`POST https://ws.rafisklaget.no/seddeldata/SeddelDataService`, `content-type: application/soap+xml; charset=utf-8`:

- `hentAvregningListe(brukernavn, passord, idnr, fomdato, tomdato)` → `seddelDataRetur/avrListe/avregning`
  (`avrnr`, `fiskerid`, `regmrk`, `fartoynavn`, `seddelNr`, `seddelDato`). `idnr` is the fisher number or orgnr.
- `hentAvregning(brukernavn, passord, avrnr)` → `seddelavregning` (seddelavregning.xsd).

The date format for `fomdato`/`tomdato` is not documented. The app sends `YYYY-MM-DD` and, if the service answers
with an error mentioning "dato", retries once with `DD.MM.YYYY`. No paging is documented.

## Subrequests

- Preview: 1 list call plus 1 `hentAvregning` per settlement, at most 20 settlements (four in parallel): ≤ 21.
- Book one settlement: 1 `hentAvregning` (re-read server side), then ReAI `GET /api/vouchers` (one day),
  `GET /api/vat-codes` and `GET /api/chart-of-accounts/accounts` in parallel, and `POST /api/manual-vouchers`: 5.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- `/api/vouchers` (duplicate check: description starts with `Råfisklaget avregning <avrnr>` on the sales date)
- `/api/vat-codes` (VAT inclusive output and input codes by rate)
- `/api/chart-of-accounts/accounts` (chosen accounts exist, are not restricted and have no subledger)
- `/api/manual-vouchers` (review voucher, rows from `pairVoucherRows`)

## Accounting mapping

One voucher per settlement, dated `hode/salgsdato`, NOK only. Accounts are editable on the page; defaults:

| Settlement element | Posting | Default |
| --- | --- | --- |
| `tilUtbetaling` | Debit, receivable from the sales organisation, cleared against the bank payout | 1570 |
| `utgMVA/grunnlag` + `utgMVA/belop` | Credit sales incl. VAT with the ReAI output code for `utgMVA/sats` | 3000 |
| `sumVarebelop` minus the VAT base | Credit sales with the 0 % output, exempt or outside scope code | 3000 |
| `lagsavgiftBelop` | Debit | 7790 |
| `produktavgift`, `forskningsavgift`, `kontrollavgift`, `ressursavgift` | Debit | 7790 |
| `pensjonstrekk` | Debit | 7790 |
| `medlemstrekk/forbund` | Debit | 7410 |
| `sloyekostnad`, `egenandelstrekk/egenandel` | Debit | 7790 |
| `heftelser/trekk` | Debit (creditor paid on the fisher's behalf) | 2990 |
| `inngMVA` | Added to the one deduction whose `belop` equals `inngMVA/grunnlag`, with the ReAI input code for its rate | |

Checks before booking (otherwise the settlement is shown but cannot be booked): catch lines add up to
`sumVarebelop`; `sumMVA` = `utgMVA/belop` − `inngMVA/belop`; sales + output VAT − input VAT − deductions = `tilUtbetaling`;
input VAT matches exactly one deduction; `test_indikator` is not `TEST`; all accounts are four digits.

## Caveats

- No live verification with real credentials. Signs are assumed positive for deductions as in the XSD element names;
  the balance check stops anything else.
- The meaning of `inngMVA` (which deduction carries input VAT) is not documented; the app infers it from the base.
- ReAI splits VAT from the VAT inclusive amount and may differ from Råfisklaget's VAT by an øre; the page warns.
- Default accounts are a starting point. Pensjonstrekk, membership dues and liens can be private for a sole
  proprietor; the review reason tells the accountant to check them.
- The settlement PDF (`filinnhold/b64`) is not attached: the public API has no endpoint to link an attachment to a
  manual voucher. The user attaches the PDF from Min side.
- Buyers (`kjoper`) are not created as ReAI customers; the receivable is a general ledger account.
- SUROFI (Sunnmøre og Romsdal Fiskesalslag) has a similar SOAP service but no documented response format; not built.

## Rules

- Use only documented operations, parameters and elements; keep the XML extractor (`xml.js`) strict.
- Provider credentials are used for one request and never stored (they travel in hidden form fields between preview
  and book, as in other apps).
- Vouchers use `pairVoucherRows` and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the XSDs, endpoints or caveats change.

Last verified: 2026-11-28.
