# Make, Zapier and n8n templates (automations)

Route `/app/automations/`. Docs pages: `web/content/{nb,en}/web-apps/automations/index.md`.

## Purpose

Shows HTTP request templates for calling the ReAI API from n8n, Make or Zapier and checks the visitor's ReAI connection. Calls no third-party API; Make, Zapier and n8n are only named as places to paste the templates.

## ReAI API

Contract: https://app.reai.no/openapi/public (version v1). Called by the app:

- `GET /api/me` without `X-Tenant-Id` (meta endpoint): confirms the token and shows the company id to use as `X-Tenant-Id`.

Listed in the templates (verified to exist in the contract, not called by the app): `GET /api/customers?organizationNumber=` then `POST /api/customers` (find or create, so a retried webhook does not duplicate), `POST /api/orders`, `POST /api/leads` (`organizationNumber`), `POST /api/driving-log/trips`, `POST /api/manual-vouchers` (every posting needs an explicit `vatCode` from `GET /api/vat-codes`).

Tokens: personal access tokens are created at https://app.reai.no/user/profile#user-access-tokens and need `X-Tenant-Id`; tenant API keys already identify their company.

## Subrequests per action

Connection test: 1.

## Caveats

Template bodies show only a few fields; the OpenAPI is the reference. Test data uses `post+demo@aiak.no`.

Last verified: 2026-11-28.
