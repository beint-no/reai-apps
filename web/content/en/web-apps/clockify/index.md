---
title: "Clockify & Accounting Integration"
seoTitle: "Clockify Hours to ReAI | Free Integration"
description: "Fetch a month of Clockify time entries through the API and post them to ReAI Timesheets for invoicing and project accounting."
summary: "Fetch Clockify time entries through the API and post them to ReAI Timesheets by employee and project."
industry: operations
webAppUrl: /app/clockify/
sourcePath: web/worker/apps/clockify.js
highlights:
  - "Uses the Clockify API v1 with your personal API key"
  - "Works with workspaces in every Clockify data region"
  - "Shows Clockify project names and skips running timers"
---

## Move Clockify hours into ReAI

The integration fetches your finished time entries for a month in the active Clockify workspace, converts the duration to hours and shows the project name and description. You choose the employee and, if you like, the project in ReAI and post the entries one by one.

## Set up Clockify with ReAI

1. In Clockify, open the profile menu and choose **Preferences → Advanced → Manage API keys**. Click **Generate new**, name the key and copy it.
2. Click **Open integration**, connect ReAI and choose the employee, project and month.
3. Choose the workspace data region. Use **Global** if you have not picked a region in Clockify.
4. Review the hours and click **Post to ReAI** for each entry.
