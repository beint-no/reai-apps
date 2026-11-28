# HubSpot CRM Sync

Route `/app/hubspot/`. Docs pages: `web/content/{nb,en}/web-apps/hubspot/index.md`.

Reads HubSpot companies, matches them to ReAI customers by org.nr or name, and creates missing customers one by one.

## Vendor docs

- Search (reference and limits): https://developers.hubspot.com/docs/api-reference/search/guide
- Companies object: https://developers.hubspot.com/docs/api-reference/latest/crm/objects/companies/get-companies
- Auth, service keys: https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/account-service-keys
- Versioning: https://developers.hubspot.com/docs/developer-tooling/platform/versioning
- Changelog: https://developers.hubspot.com/changelog (private app creation sunset: https://developers.hubspot.com/changelog/legacy-private-app-creation-sunset)

## API version

Date-based `2026-09`, the newest GA version (March/September cadence; `2027-03` is beta only). Numbered v1 to v3 APIs go unsupported in September 2027, so do not fall back to `/crm/v3`.

## Auth

Customer creates a service key in HubSpot (Development → Keys → Service keys) with scope `crm.objects.companies.read`; an existing private app token with that scope also works. Sent as `Authorization: Bearer <key>`. Used for one request, never stored.

## Endpoints

- `POST https://api.hubapi.com/crm/objects/2026-09/companies/search` with `limit: 200` (documented max), `properties` (name, domain, phone, address, zip, city, country plus the optional custom org.nr property), `sorts: hs_object_id ASCENDING` for stable paging, `after` cursor from `paging.next.after`, and an optional `hs_lastmodifieddate GTE <epoch ms>` filter (Changed since).

## Paging, limits, budget

- Search: 200 per page, 10,000 results per query, five requests per second per account. A `429` is retried once after `Retry-After` (capped at 3 s).
- Scan: at most 15 search pages (3,000 companies; the UI says so and suggests Changed since) plus ReAI customer pages (200 each) in parallel. Typical account: 1 to 3 HubSpot + 1 to 5 ReAI subrequests.
- Create: 1 ReAI duplicate lookup + 1 POST.

## ReAI endpoints

Contract: https://app.reai.no/openapi/public.

- `GET /api/customers` (all pages, for matching; on create `organizationNumber=` exact filter, or `name=` when there is no org.nr)
- `POST /api/customers` (`name` ≤ 75, `countryCode`, `organizationNumber`, `addressPart1`/`postalCode`/`city`, `phone` E.164, `privateContact: false`, `skipRegistryLookup: true`)

## Mapping

HubSpot `country` free text or ISO code → ISO 3166-1 alpha-2 via `Intl.DisplayNames` (en, nb); blank or unknown → NO. Norwegian 8-digit phone numbers get `+47`. Norwegian companies need a MOD11-valid org.nr before create.

## Caveats

- HubSpot has no standard org.nr property; without a custom one every Norwegian company needs the org.nr typed inline.
- Search results are indexed with a short delay, so a company created seconds ago may be missing.
- `hs_object_id` as sort key is a default HubSpot property; sorting by it is not called out specifically in the docs.

Last verified: 2026-11-28
