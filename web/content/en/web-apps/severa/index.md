---
title: "Severa & Accounting Integration"
seoTitle: "Severa Timesheet Integration for ReAI: Work Hours to Timesheets"
description: "Fetch work hours from the Severa REST API and post them to ReAI Timesheets for the employee and project you choose. Free and open source."
summary: "Fetch Severa work hours for a period and post them to ReAI Timesheets."
industry: operations
webAppUrl: /app/severa/
sourcePath: web/worker/apps/severa.js
highlights:
  - "Reads work hours through the Severa REST API with a client ID and client secret"
  - "Shows date, user, project and phase before anything is posted"
  - "Posts each line as a timesheet entry for the chosen ReAI employee and project"
---

## What moves into ReAI

The integration reads the Severa (formerly Visma Severa) work hours dated within the chosen period, at most 93 days at a time. You can limit it to one Severa user. Each line shows date, user, project with phase, comment and hours. You post lines one by one to ReAI Timesheets for the employee and project you choose.

## Setup

1. Sign in to Severa as an administrator and open **Settings → REST API**. Accept the terms the first time and choose **Create client credentials**. Give the client the **hours:read** scope. If the menu is missing, the REST API add-on must be enabled for the account.
2. Click **Open integration**, connect ReAI and choose the company.
3. Enter the client ID, the client secret and the period, then choose the ReAI employee and an optional project.
4. Check the hours and click **Post to ReAI** on the lines you want to record.

The client secret is used only for that request and is never stored.
