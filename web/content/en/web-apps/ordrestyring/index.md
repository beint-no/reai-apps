---
title: "Ordrestyring & Accounting Integration"
seoTitle: "Ordrestyring Hours and Materials to ReAI Timesheets and Orders"
description: "Fetch uninvoiced Ordrestyring hours and materials, log the hours in ReAI Timesheets and stage each case as a draft ReAI order. Free and open source."
summary: "Fetch Ordrestyring hours and case materials through the Ordrestyring GraphQL API into ReAI timesheets and draft orders."
industry: operations
webAppUrl: /app/ordrestyring/
sourcePath: web/worker/apps/ordrestyring/
highlights:
  - "Uses the Ordrestyring GraphQL API with an API token from Ordrestyring"
  - "Logs uninvoiced hours per employee and skips rejected hours"
  - "Stages one draft order per case with hours, materials and other expenses ex. VAT"
---

## What moves into ReAI

The integration reads hours that are not invoiced in Ordrestyring, with start time in the chosen period, and case materials and other expenses added in the same period.

* **Hours** become ReAI timesheet rows with hour type, description and case. Employees are matched to ReAI employees by name, with a fallback employee you choose. Rejected hours are skipped.
* **Invoice basis** becomes one draft ReAI order per case: the sales price of the hours plus the totals of materials and other expenses, ex. VAT. Lines that are already in an Ordrestyring invoice draft are left out. The order carries the case number as external reference, so staging the same case twice opens the existing draft instead of creating a new one.

Nothing is invoiced or booked automatically. You review and invoice each draft order in ReAI, where the sales account and VAT code are set.

## Setup

1. Ask **Ordrestyring support** for an API token for your company.
2. Click **Open integration**, connect your ReAI company and choose fallback customer, fallback employee and an optional project.
3. Choose **Norway** or **Denmark** to match the Ordrestyring account, paste the token, choose the period and click **Fetch from Ordrestyring API**.
4. Click **Log hours** and **Stage draft order** on the rows you want.

The token is used only for that request and is never stored.
