---
title: "Harvest & Accounting Integration"
seoTitle: "Harvest Hours to ReAI | Free Integration"
description: "Fetch project hours from the Harvest API v2 and post them to ReAI Timesheets for invoicing and payroll."
summary: "Fetch Harvest time entries through API v2 and post them to ReAI Timesheets."
industry: operations
webAppUrl: /app/harvest/
sourcePath: web/worker/apps/harvest/
highlights:
  - "Uses the Harvest API v2 with a Personal Access Token and Account ID"
  - "Shows the Harvest project, user and notes"
  - "Skips timers that are still running"
---

## Move Harvest hours into ReAI

The integration fetches finished time entries for a month from Harvest, with project, user and notes. You choose the employee and, if you like, the project in ReAI and post the entries one by one.

## Set up Harvest with ReAI

1. Create a **Personal Access Token** at `id.getharvest.com/developers` and copy the token and Account ID.
2. Click **Open integration**, connect ReAI and choose the employee, project and month.
3. Optionally enter a Harvest user ID to fetch one person's hours. Without it you get every entry the token can see.
4. Review the hours and click **Post to ReAI** for each entry.
