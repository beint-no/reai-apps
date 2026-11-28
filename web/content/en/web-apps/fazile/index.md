---
title: "Fazile Property & Lease Billing"
seoTitle: "Fazile Property Management Integration for ReAI: Lease Subscriptions"
description: "Read active lease contracts from the Fazile API and stage them as ReAI subscriptions, with the VAT code taken from the rate on each contract line."
summary: "Read active Fazile lease contracts and stage ReAI recurring billing with automatic billing kept off until approved."
industry: real-estate
webAppUrl: /app/fazile/
sourcePath: web/worker/apps/fazile/
highlights:
  - "Reads active contracts and tenants with a Fazile API key"
  - "Matches tenants in ReAI by organization number, email or name"
  - "Creates subscriptions with automatic billing off until you approve them"
---

## Lease billing from Fazile in ReAI

Fazile stores rent, common costs and marketing contributions as annual amounts on contract lines. The integration reads active contracts, divides each annual amount by the line's invoice frequency and creates one ReAI subscription per contract and frequency. Lines with VAT get the ReAI output VAT code with the same rate; lines without VAT get the code you choose. Discounts, rent exemptions and accruals are left out and must be added in ReAI if needed.

Fazile normally sends invoice basis to your ERP itself. Use this integration for contracts that ReAI will invoice.

## Setup

1. In Fazile, go to **Firmaprofil → API Nøkler** and choose **Opprett API-nøkkel**. Give the key read access to contracts and tenants. The key is shown only once. Fazile charges for API access according to your agreement.
2. Click **Open integration**, connect ReAI and choose the VAT code for lines without VAT.
3. Paste the key and fetch the contracts.
4. Check amounts, frequency and start date, then click **Stage subscription**. Turn on automatic billing in ReAI once the terms are right.
