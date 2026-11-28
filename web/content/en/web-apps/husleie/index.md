---
title: "Husleie.no Lease Billing"
seoTitle: "Husleie.no Accounting Integration for ReAI"
description: "Upload the Husleie.no Leieforhold report and stage monthly rent billing in ReAI with full control before activation."
summary: "Turn active Husleie.no rental agreements into ReAI subscriptions with automatic billing kept off."
industry: real-estate
webAppUrl: /app/husleie/
sourcePath: web/worker/apps/husleie/
highlights:
  - "Reads the CSV export of the Leieforhold report in MinHusleie"
  - "Matches tenants in ReAI by email or name"
  - "Creates subscriptions with automatic billing off until you approve them"
---

## From Husleie.no to rent billing in ReAI

The **Leieforhold** report in MinHusleie lists tenant, rental object, rent and contract period for every rental agreement. The integration reads the CSV export of this report, skips ended agreements and creates a monthly ReAI subscription for each tenant found in your customer register. Agreements that already run start billing on the first of next month.

Husleie.no also has an API, but its documentation and access are only available from Husleie.no customer service, so the integration uses the export.

## Setup

1. In MinHusleie, open **Rapporter → Leieforhold** and download the list as CSV below the table. The report requires a professional landlord account.
2. Click **Open integration**, connect ReAI and choose the VAT code for the rent. Residential rent is exempt from VAT.
3. Upload the file, check tenant, amount and start date, then click **Stage subscription**.
4. Turn on automatic billing in ReAI once the terms are right.
