# SAF-T Migration

Route `/app/saft/`. Docs pages: `web/content/{nb,en}/web-apps/saft/index.md`.

## Purpose

Move a company to ReAI from any Norwegian accounting system: read the SAF-T Financial XML the
customer exports, import missing customers and suppliers, and save the balance sheet closing
balances as the ReAI opening balance. No third-party API is called.

## File format

- Skatteetaten SAF-T Financial: https://github.com/Skatteetaten/saf-t (schemas v1.30 in
  `SAF-T_Financial_1.3/`, v1.40 in `SAF-T_Financial_1.4/`, example files next to them).
- v1.40 is mandatory for periods starting 1 January 2027 and is backwards compatible; v1.30 is
  current. The parser reads only elements present in both, plus `StandardAccountID` from v1.10.
- Namespace `urn:StandardAuditFile-Taxation-Financial:NO`; tags are matched by exact local name with
  an optional prefix, entities decoded.
- Read: `Header/Company/{RegistrationNumber,Name}`, `Header/SoftwareCompanyName`,
  `Header/AuditFileVersion`, `Header/DefaultCurrencyCode`,
  `Header/SelectionCriteria/{SelectionEndDate | PeriodEnd + PeriodEndYear}` (opening balance date
  is the last day of the selection),
  `MasterFiles/GeneralLedgerAccounts/Account/{AccountID,AccountDescription,Closing(Debit|Credit)Balance}`,
  `MasterFiles/{Customers/Customer,Suppliers/Supplier}/{RegistrationNumber,Name,Address,CustomerID|SupplierID,BalanceAccount/{AccountID,Closing(Debit|Credit)Balance}}`.
- Amounts are converted to integer minor units when parsed.

## ReAI API

Contract: https://app.reai.no/openapi/public.

- Opening balance (one action, about five subrequests plus one per 200 customers or suppliers):
  `GET /api/opening-balance` (404 means none), `GET /api/company-banks`, `GET /api/assets` (only
  when a 10xx to 12xx account has a balance), `GET /api/customers` and `GET /api/suppliers`
  (pageSize 200, only when parties carry balances), then `PUT /api/opening-balance` with one
  single sided line per balance.
- Party import (one action): `GET /api/customers`, `GET /api/suppliers` (pageSize 200), then at most
  30 `POST /api/customers` / `POST /api/suppliers` for parties not found; the user clicks again
  for the rest.

## Accounting mapping

- Only balance sheet accounts (classes 1 and 2) with a non-zero closing balance. Four digit
  `AccountID`, else four digit `StandardAccountID`; other accounts are listed for manual entry.
- Accounts referenced by any customer or supplier `BalanceAccount` are split per party as
  `account/{ReAI id}`; the party balances must add up to the account balance. Parties are matched
  by number (SAF-T ID), organization number (customers only; supplier lists have none), then exact
  name. Missing parties block the push with their names.
- Bank ledger accounts get `/{companyBankId}` when exactly one active ReAI bank uses that account;
  10xx to 12xx accounts need exactly one ReAI asset on the account, otherwise the push stops.
- The balance sheet must sum to zero (year closed and result moved to equity); currency must match
  the tenant currency. An existing opening balance is replaced only with the replace checkbox.
- `PUT /api/opening-balance` is not a manual voucher, so `pairVoucherRows` does not apply; ReAI
  checks balance per posting date and subsidiary references itself (VAT code is always none).

## Caveats

- Employee and general subledger accounts that ReAI requires a subsidiary for are posted without
  one; ReAI's error message then names the row.
- Party import sends name, number, organization number (valid Norwegian only), country and address;
  `skipRegistryLookup` is true. Private customers are created as companies.
- Preview data travels between steps in hidden form fields; they are re-validated on submit.

Last verified: 2026-11-28.
