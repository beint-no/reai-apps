---
title: "Tidsbanken & Accounting Integration"
seoTitle: "Tidsbanken Timesheet Integration for ReAI: Approved Hours to Timesheets"
description: "Fetch approved hours from the Tidsbanken API and post them to ReAI Timesheets for the employee and project you choose. Free and open source."
summary: "Fetch approved Tidsbanken hours for a period and post them to ReAI Timesheets."
industry: operations
webAppUrl: /app/tidsbanken/
sourcePath: web/worker/apps/tidsbanken.js
highlights:
  - "Reads approved time lines through the Tidsbanken API with a subscription key and tb-key"
  - "Shows employee, project and note before anything is posted"
  - "Posts each line as a timesheet entry for the chosen ReAI employee and project"
---

## What moves into ReAI

The integration reads approved Tidsbanken time lines dated within the chosen period, at most 93 days at a time. You can limit it to one employee by name. Each line shows date, employee, project, note and hours.

You post lines one by one to ReAI Timesheets for the employee and project you choose.

## Setup

1. Create a user on [developer.tidsbanken.net](https://developer.tidsbanken.net/products), subscribe to the **Public** product and copy the subscription key.
2. Sign in to Tidsbanken as an administrator, click the wrench icon in the bottom right corner and open **Integrasjon → API-nøkkel → Hent API-nøkkel**. This is the tb-key. If the option is missing, order an API licence from Tidsbanken.
3. Click **Open integration**, connect ReAI and choose the company.
4. Enter both keys and the period, then choose the ReAI employee and an optional project.
5. Check the hours and click **Post to ReAI** on the lines you want to record.

The keys are used only for that request and are never stored.
