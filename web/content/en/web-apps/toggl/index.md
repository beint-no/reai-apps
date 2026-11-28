---
title: "Toggl Track & Accounting Integration"
seoTitle: "Toggl Track Timesheet Integration for ReAI: Hours to Timesheets"
description: "Fetch tracked hours from the Toggl Track API and post them to ReAI Timesheets for the employee and project you choose. Free and open source."
summary: "Fetch a month of Toggl Track time entries and post them to ReAI Timesheets."
industry: operations
webAppUrl: /app/toggl/
sourcePath: web/worker/apps/toggl.js
highlights:
  - "Reads your Toggl Track time entries for the chosen month"
  - "Maps the hours to a ReAI employee and optional project"
  - "Ready for project invoicing and payroll without double entry"
---

## What moves into ReAI

The integration reads your own Toggl Track time entries that start in the chosen month. Running entries are left out. You post lines one by one to ReAI Timesheets for the employee and project you choose.

## Setup

1. Open **Profile settings** in Toggl Track and copy the **API Token** at the bottom of the page.
2. Click **Open integration**, connect ReAI and choose the employee, an optional project and the month.
3. Check the hours and click **Post to ReAI** on the lines you want to record.

The token is used only for that request and is never stored.
