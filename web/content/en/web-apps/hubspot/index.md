---
title: "HubSpot CRM & ReAI Customer Sync"
seoTitle: HubSpot Accounting Integration for ReAI
description: Read HubSpot CRM companies, find those already in ReAI and create the rest with Norwegian organization number checks.
summary: Scan HubSpot CRM companies, detect existing ReAI customers and create missing customers with one click.
industry: operations
webAppUrl: /app/hubspot/
sourcePath: web/worker/apps/hubspot.js
highlights:
  - "Reads HubSpot CRM companies with a read only service key"
  - "Detects existing ReAI customers by organization number or company name"
  - "Checks Norwegian organization numbers before creating customers in ReAI"
---

## Keep sales and invoicing aligned

Sales teams work in HubSpot while finance invoices in ReAI. Retyping names, addresses and organization numbers leads to duplicate customers and failed EHF deliveries. Scan your HubSpot companies on demand, see which already exist in ReAI and create the rest in one click.

## Setup

1. In HubSpot, go to **Development → Keys → Service keys**, choose **Create service key** and add the `crm.objects.companies.read` scope. An existing private app token with the same scope also works.
2. HubSpot has no standard organization number property. If you keep it in a custom company property, find its internal name under **Settings → Properties → Company properties**.
3. Click **Open integration**, connect ReAI and paste the key and, optionally, the property name.
4. Review the list. Norwegian companies without a valid organization number get a field to fill in before the customer is created.
