---
title: "SmartDok & Accounting Integration"
seoTitle: "SmartDok Hours Integration for ReAI: Attested Hours to Timesheets"
description: "Fetch attested work hours from the SmartDok API and post them to ReAI Timesheets for the employee and project you choose. Free and open source."
summary: "Fetch attested SmartDok hours for a period and post them to ReAI Timesheets."
industry: operations
webAppUrl: /app/smartdok/
sourcePath: web/worker/apps/smartdok/
highlights:
  - "Reads attested work hours through the SmartDok API with an API access token"
  - "Shows employee, project, subproject and wage type before anything is posted"
  - "Posts each line as a timesheet entry for the chosen ReAI employee and project"
---

## What moves into ReAI

The integration reads attested SmartDok hours within the chosen period, at most 93 days at a time. Hours already exported to payroll are included. Additions, allowances and machine hours are left out. You can limit it to one employee by name or employee number. Hours are net hours after breaks when SmartDok provides them.

You post lines one by one to ReAI Timesheets for the employee and project you choose.

## Setup

1. Sign in to SmartDok as an administrator and open **Company settings → API administration**. Generate an API access token. If the menu is missing, order API access from SmartDok.
2. Click **Open integration**, connect ReAI and choose the company.
3. Enter the token and the period, then choose the ReAI employee and an optional project.
4. Check the hours and click **Post to ReAI** on the lines you want to record.

The token is used only for that request and is never stored.
