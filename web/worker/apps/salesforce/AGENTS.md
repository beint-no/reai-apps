# Salesforce

Route `/app/salesforce/`. Docs pages: `web/content/{nb,en}/web-apps/salesforce/index.md`.

Stages Closed Won opportunities (with their products and the account as customer) as ReAI orders for invoicing.

## Vendor docs

- REST API reference, query: https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_query.htm
- Auth, client credentials flow: https://help.salesforce.com/s/articleView?id=sf.connected_app_client_credentials_setup.htm and https://developer.salesforce.com/blogs/2023/03/using-the-client-credentials-flow-for-easier-api-authentication
- Objects: https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_opportunity.htm and `sforce_api_objects_opportunitylineitem.htm`
- Release versions (live list): https://na1.salesforce.com/services/data/
- Release notes: https://help.salesforce.com/s/articleView?id=release-notes.salesforce_release_notes.htm

## API version

`v68.0` (Winter '27), the latest version listed by `/services/data/` on 2026-11-28. Bump `API_VERSION` each release after checking the release notes for retired fields.

## Auth

Customer admin creates an external client app (or connected app) with OAuth scope `api`, enables the client credentials flow and sets a run as user. The form takes the My Domain URL (must end in `.salesforce.com`), consumer key and secret. `POST {My Domain}/services/oauth2/token` (form body `grant_type=client_credentials`, `client_id`, `client_secret`) returns `access_token` and `instance_url`; calls send `Authorization: Bearer`. One token per fetch, never stored.

## Endpoints

- `GET {instance_url}/services/data/v68.0/query?q=` SOQL: `Id, Name, Amount, CloseDate, CurrencyIsoCode, Account.Name, Account.<optional org nr field>, (SELECT Product2.Name, Description, Quantity, TotalPrice FROM OpportunityLineItems) FROM Opportunity WHERE IsWon = true AND CloseDate >= from AND CloseDate <= to ORDER BY CloseDate LIMIT 200`.
- `CurrencyIsoCode` exists only in multi currency orgs. A single currency org answers `400 INVALID_FIELD`; the query is repeated without it and the form currency is used.
- Paging: follows `nextRecordsUrl` while `done` is false (at most 10 pages). 200 or more won deals in the range is an error asking for a shorter range. A product subquery with `done: false` is an error naming the opportunity.

## Budget and limits

Fetch: 1 token + 1 query (+1 in single currency orgs) + rare extra pages, so 2 to 4 subrequests. Stage one deal: up to 5 ReAI calls. Calls count against the org's daily API request allocation; no Retry-After handling is needed at this volume.

## ReAI API

- `GET /api/orders?externalReference=salesforce-<Id>` duplicate check (409 from POST is also surfaced).
- `GET /api/vat-codes?usage=customer_invoice` (lines carry no rate, so the default VAT code is used).
- `GET /api/customers?organizationNumber=` then `?name=` with an exact, case insensitive name match; else `POST /api/customers` company customer.
- `POST /api/orders` with `externalReference`, `currencyCode`, `issueDate`/`orderDate` = CloseDate, lines `itemName`, `quantity` (up to 2 decimals), `unitPrice` excl. VAT.

## Mapping

Each product line becomes an order line from `TotalPrice` (after discount) and `Quantity`; if the unit price does not divide to cents, one line `"<qty> x <name>"` with quantity 1. Without products, one line from `Amount`. CRM amounts carry no VAT, so ReAI's default VAT code applies.

## Caveats

No standard Norwegian org nr field; the customer may name a custom Account field. Not tested against a live org. Totals across deals in different currencies are summed in the preview metric only.

Last verified: 2026-11-28.
