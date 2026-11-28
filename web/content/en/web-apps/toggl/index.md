---
title: "Toggl Track & Accounting Integration"
seoTitle: "Toggl Track Timesheet Integration for ReAI — Billable Hours & Projects"
description: "Import worked hours from Toggl Track API v9 directly into ReAI Timesheets for project invoicing and payroll. Included free with ReAI."
summary: "Fetch monthly Toggl Track time entries and post them straight into ReAI Timesheets by employee and project."
industry: operations
icon: icons/toggl.svg
webAppUrl: /app/toggl/
sourcePath: web/worker/apps/timetracking.js
highlights:
  - "Reads Toggl Track API v9 time entries by month"
  - "Maps worked hours cleanly to any ReAI employee and project"
  - "Validates 0.01–24.00 decimal hour bounds before posting to /api/timesheets"
---

## Sync Toggl Track hours into ReAI Timesheets

Consultancies and agencies tracking billable work in Toggl Track can move monthly entries directly into ReAI Timesheets—ready for customer invoicing, project profitability reporting and payroll without double entry.

## Step-by-step setup

1. Copy your **API Token** from Toggl Track under **Profile Settings → API Token**.
2. Open the integration above, connect your ReAI company and choose target employee, optional project and month.
3. Review the decimal hours and post each entry directly to ReAI Timesheets.
