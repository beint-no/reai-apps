# Salesforce

Route `/app/salesforce/`. Docs pages: `web/content/{nb,en}/web-apps/salesforce/index.md`.

## Vendor API

Current documentation (read before changing any provider call):

- https://developer.salesforce.com/blogs/2023/03/using-the-client-credentials-flow-for-easier-api-authentication
- https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_query.htm
- https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_opportunity.htm
- https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/intro_understanding_authentication.htm

- Mode: fix
- Calls: OAuth 2.0 client credentials flow (POST {My Domain}/services/oauth2/token, form body grant_type/client_id/client_secret), then GET {instance_url}/services/data/v66.0/query?q=SOQL for Opportunity WHERE IsWon = true AND CloseDate in range with Account.Name, optional Account.<custom org nr field> and OpportunityLineItems subquery (Name, Quantity, TotalPrice); follows nextRecordsUrl. Each won opportunity can be staged as a ReAI order (GET /api/orders?externalReference duplicate check, customer lookup by organizationNumber then name via GET /api/customers or POST /api/customers company customer, POST /api/orders with default VAT code). Host restricted to *.salesforce.com.
- Hosts in code: `developer.salesforce.com`, `yourcompany.my.salesforce.com`
- Vendor status: Salesforce Sales Cloud is sold; public REST API lists Winter '27 (v68.0) as latest release on na1.salesforce.com/services/data/ on 2026-11-28.

## ReAI API

Contract: https://app.reai.no/openapi/public. Endpoints used:

- `/api/customers`
- `/api/orders`
- `/api/vat-codes`

## Caveats

Customer admin must create an external client app or connected app with client credentials and a run as user. Currency is a form field (CurrencyIsoCode exists only in multi-currency orgs, so it is not queried). Order lines use the ReAI default VAT code (CRM amounts have no VAT). No Salesforce org nr standard field; optional custom field API name input. Not tested against a live org.

## Rules

- Use only documented endpoints, auth, parameters and fields; prefer the newest API version and server-side filtering and paging.
- Provider credentials are used for one request and never stored.
- Vouchers use `pairVoucherRows` (`web/worker/lib/voucher-rows.js`) and real VAT codes from `GET /api/vat-codes`; never VAT code 0 plus a manual 2700 line.
- Update this file when the API version, endpoints or caveats change.

Last verified: 2026-11-28.
