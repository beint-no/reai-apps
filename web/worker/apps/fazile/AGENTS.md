# Fazile Property Billing

Route `/app/fazile/`. Docs pages: `web/content/{nb,en}/web-apps/fazile/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://fazile.net/integrasjon-og-api/
- https://api.fazile.no/clients/swagger-ui/index.html
- https://api.fazile.no/clients/v3/api-docs
- https://hjelp.fazile.net/docs/oppretting-av-api-nokkel-for-tredjepartsapplikasjoner/
- https://hjelp.fazile.net/docs/endring-av-arsleie-og-justering-av-basispriser/
- https://hjelp.fazile.net/docs/fakturaer-knyttet-til-kontrakter/

- Mode: fix
- Calls: fetchApi reads GET https://api.fazile.no/clients/v1/contracts and /v1/tenants (skip/limit pagination, `token` header), keeps ACTIVE contracts and current RENT/COMMON_COSTS/MARKETING/PARKING/CUSTOM lines, converts annual total_price to the amount per invoice using the line frequency (fallback interval chosen by the user), matches tenants by org.nr, email or name, and stages one ReAI subscription per contract and interval (POST /api/subscriptions, automatic billing off). VAT codes come from GET /api/vat-codes?usage=customer_invoice: output_vat with the line's tax_vat_percent, and a user chosen 0% code for lines without VAT; codes are rechecked on stage. Discount, exemption and accrual lines are counted and left out. CSV path removed.
- Hosts in code: `api.fazile.no`, `fazile.net`, `hjelp.fazile.net`
- Vendor status: Brreg: active, 14 employees, no bankruptcy or liquidation flags. fazile.net live (customer day 15.10.2026), help centre updated 2026-10-30, used by Reitan Eiendom with Xledger.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/subscriptions`
- `/api/vat-codes`

## Caveats

The OpenAPI types ContractLineResponse.frequency as a free string; the module assumes the same values as the documented invoice_frequency enum (MONTHLY, QUARTERLY, YEARLY...) and otherwise uses the chosen default interval. total_price is treated as the current annual amount per Fazile's help pages (prices are årsleie). Not tested against a live Fazile key. Fazile charges for API key activation. Fazile normally sends invoice basis to the ERP itself, which the UI and docs mention.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
