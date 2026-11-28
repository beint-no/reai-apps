---
title: "Quinyx & Accounting Integration"
seoTitle: "Quinyx Integration for ReAI: Shifts to Timesheets"
description: "Fetch the shifts of one Quinyx employee and post the hours to ReAI Timesheets. Free and open source."
summary: "Fetch Quinyx shifts and post the hours to ReAI Timesheets."
industry: operations
webAppUrl: /app/quinyx/
sourcePath: web/worker/apps/quinyx/
highlights:
  - "Reads shifts through the Quinyx API with your own integration credentials"
  - "Subtracts breaks and skips free days and shifts that do not count as worked hours"
  - "Posts the hours to the chosen employee and project in ReAI Timesheets"
---

## What moves into ReAI

The integration reads the scheduled shifts of one Quinyx employee in the chosen period. Hours run from shift start to shift end, minus breaks. Free days, deleted shifts and shifts that do not count as worked hours are left out. Each shift is shown with date, group and comment, and you post it to a ReAI employee and an optional project with one click.

| From Quinyx | In ReAI |
| --- | --- |
| Scheduled shift | Timesheet entry for the chosen employee and date |
| Group | Shown in the preview |
| Shift comment | Timesheet comment |

The hours are scheduled shifts. Check them against the punches in Quinyx before you post them.

## Setup

1. A Quinyx account manager opens **Account settings → Access rights → Integration credentials** and clicks **Generate credentials**.
2. Choose **Version 3**, grant read access to **Shifts** and save. Copy the client ID and client secret right away, since the secret is shown only once.
3. Click **Open integration**, connect ReAI and choose the company, employee and optional project.
4. Enter the client ID, client secret, region (`eu` for the Nordics), the employee badge number and the period, then fetch the shifts.
5. Check the hours and click **Post to ReAI** on each line.

The credentials are used only for that request and are never stored.
