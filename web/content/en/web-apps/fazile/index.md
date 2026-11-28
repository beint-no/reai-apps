---
title: "Fazile Property & Lease Billing"
seoTitle: "Fazile Property Management Integration for ReAI — Lease Subscriptions"
description: "Stage commercial property leases from Fazile as recurring ReAI billing subscriptions with VAT-exempt (code 6) or voluntary VAT (code 3) support."
summary: "Import Fazile lease schedules into ReAI recurring billing subscriptions with automatic billing kept off until approved."
industry: real-estate
icon: icons/fazile.svg
webAppUrl: /app/fazile/
sourcePath: web/worker/apps/billing.js
highlights:
  - "Matches tenants automatically against your ReAI customer register"
  - "Supports both VAT-exempt residential/commercial rent (code 6) and voluntary VAT leases (code 3)"
  - "Stages monthly ReAI subscriptions with automaticBillingGeneration disabled for safety"
---

## Commercial property lease billing with Fazile and ReAI

Landlords and commercial property managers using **Fazile** (or similar Norwegian lease administration systems) can export active lease schedules as CSV and stage recurring monthly billing directly in ReAI—handling both VAT-exempt leases (VAT code `6`) and voluntarily VAT-registered commercial leases (VAT code `3`).

## Step-by-step with ReAI

1. Export your active lease billing schedule from Fazile as CSV (`LeaseID`, `Tenant`, `Email`, `Unit`, `StartDate`, `MonthlyRent`).
2. Click **Open integration**, connect your ReAI company, pick the appropriate VAT code (`6` or `3`) and upload the CSV.
3. Click **Stage subscription** per matched tenant, then review and activate billing inside ReAI.
