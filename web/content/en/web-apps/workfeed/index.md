---
title: "Workfeed & Accounting"
seoTitle: "Workfeed Shift Hours Integration for ReAI Timesheets"
description: "Fetch worked Workfeed shifts and post the hours to ReAI Timesheets per employee as the basis for payroll and project billing."
summary: "Read approved Workfeed shifts with your API key and post the hours to ReAI Timesheets."
industry: operations
webAppUrl: /app/workfeed/
sourcePath: web/worker/apps/workfeed/
highlights:
  - "Uses the Workfeed open API with your own API key"
  - "Shift length minus registered break, approved shifts by default"
  - "Employees matched to ReAI by email or name"
---

## What moves into ReAI

Each Workfeed shift with an employee becomes a ReAI timesheet entry. Hours are the shift length minus the registered break, dated on the Norwegian calendar day the shift starts. The comment holds the Workfeed department and shift ID. Employees are matched to ReAI by email or name, and you can link all hours to one ReAI project.

Timesheet entries are not postings. They are the basis for payroll and project invoicing in ReAI, where you approve them as usual.

## Setup

1. In Workfeed, open **Settings → Integrations → Workfeed API**, generate a key and give it a name. The open API requires the Pro+ plan.
2. Click **Open integration**, connect your ReAI company and enter the key, your Workfeed company ID and the period.
3. Keep **Approved shifts only** checked for payroll, then fetch the shifts.
4. Check the hours and post them one by one or all matched shifts together. Large periods are posted in batches, and you click on to the next batch. Shifts already in ReAI are skipped.

Workfeed API keys can also change data in Workfeed. This app only reads shifts, employees and departments, and uses the key for one request without storing it. Revoke the key in Workfeed when you no longer need it.
