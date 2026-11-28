---
title: "Tamigo & Accounting Integration"
seoTitle: "Tamigo Timesheet Integration for ReAI: Worked Shifts to Timesheets"
description: "Fetch worked shifts from the Tamigo timesheet and post them to ReAI Timesheets for the employee and project you choose. Free and open source."
summary: "Fetch worked Tamigo shifts for a period and post them to ReAI Timesheets."
industry: operations
webAppUrl: /app/tamigo/
sourcePath: web/worker/apps/tamigo/
highlights:
  - "Reads worked hours through the Tamigo API with an application key"
  - "Shows employee, department and shift time before anything is posted"
  - "Posts each shift as a timesheet entry for the chosen ReAI employee and project"
---

## What moves into ReAI

The integration reads the shifts in the Tamigo timesheet for all departments within the chosen period, at most 93 days at a time. Shifts without worked hours are left out. You can limit it to one employee by name or Tamigo employee ID. Each line shows date, employee, department, shift time and hours.

You post lines one by one to ReAI Timesheets for the employee and project you choose. To post, limit the fetch to one Tamigo employee. A shift already logged for the same day, hours and comment is skipped.

## Setup

1. Sign in to Tamigo as an administrator and open **Configuration → Web Services (API)**. Enter an application name, for example ReAI, and choose **Create Key**.
2. Click **Open integration**, connect ReAI and choose the company.
3. Enter the application name, the key and the period, then choose the ReAI employee and an optional project.
4. Check the hours and click **Post to ReAI** on the lines you want to record.

The key is used only for that request and is never stored.
