---
title: "Planday & Accounting Integration"
seoTitle: "Planday Integration for ReAI: Approved Shifts to Timesheets"
description: "Fetch approved Planday shifts for one employee and post the hours to ReAI Timesheets. Free and open source."
summary: "Fetch approved Planday shifts and post the hours to ReAI Timesheets."
industry: operations
webAppUrl: /app/planday/
sourcePath: web/worker/apps/planday/
highlights:
  - "Reads approved shifts through the Planday Open API with an App ID and refresh token"
  - "Subtracts unpaid manual breaks and shows the department of each shift"
  - "Posts the hours to the chosen employee and project in ReAI Timesheets"
---

## What moves into ReAI

The integration reads the approved shifts of one Planday employee in the chosen period. Hours run from shift start to shift end, minus unpaid manual breaks. Breaks from Planday break rules are not in the API, so check the hours where you use break rules. Each shift is shown with date, department and comment, and you post it to a ReAI employee and an optional project with one click.

| From Planday | In ReAI |
| --- | --- |
| Approved shift | Timesheet entry for the chosen employee and date |
| Department | Shown in the preview |
| Shift comment | Timesheet comment, tagged with the shift id |

## Setup

1. A Planday administrator opens **Settings → Integrations → API Access** and creates an API application with the `shift:read` and `department:read` scopes.
2. Authorize the application in Planday and copy the **App ID** and **refresh token**.
3. Look up the employee id of the person in Planday.
4. Click **Open integration**, connect ReAI and choose the company, employee and optional project.
5. Enter the App ID, refresh token, employee id and period, then fetch the shifts. Check the hours and click **Post to ReAI** on each line.

A shift that is already posted is not posted again.

The refresh token is used only for that request and is never stored.
