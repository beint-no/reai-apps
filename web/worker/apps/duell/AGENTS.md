# Duell Z-report Accounting

Route `/app/duell/`. Docs pages: `web/content/{nb,en}/web-apps/duell/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://www.duell.no/support/api-dokumentasjon/
- https://api.kasseservice.no/docs/authentication/
- https://api.kasseservice.no/docs/getaccesstokens/
- https://api.kasseservice.no/docs/department/list/
- https://api.kasseservice.no/docs/z-report/list/
- https://api.kasseservice.no/docs/z-report/view/

- Mode: api
- Auth: Customer copies client number (avtalenummer) and client token from Duell Admin > System > Integrasjoner > API-oppsett (support@duell.no enables the menu if missing). POST https://api.kasseservice.no/v1/getaccesstokens (form: client_number, client_token) returns a 3-day token sent as Authorization: Bearer.
- Hosts in code: `api.kasseservice.no`
- Vendor status: Brreg (2026-11-28): not konkurs, not under avvikling or tvangsavvikling, no slettedato. duell.no live, sells Duell POS.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/manual-vouchers`
- `/api/vat-codes`
- `/api/vouchers`

## Caveats

Flow: getaccesstokens -> GET /department/list?filter[is_active]=1 -> GET /account/cashsettlements (department_token, start_date/end_date 'YYYY-MM-DD HH:MM:SS', filtered client-side on cash_settlement_date) -> GET /account/gbat10 (department_id, cashsettlement_id[]). GBAT10 lines keep Duell's account_number; lines with vatrate_percent > 0 or record_type sales* are posted as sales incl. VAT with the ReAI output code for that rate. The documented GBAT10 example does not balance and the meaning of gross:'T' is undocumented; unbalanced days are shown but cannot be booked. No live verification (no credentials). Duell's help centre says its AWS WAF geo-blocks some countries; unclear whether that applies to api.kasseservice.no from Cloudflare egress. support@duell.no is the address the API docs name for API access and may be the better recipient; no partner/developer address exists.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
