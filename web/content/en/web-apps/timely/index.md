---
title: "Timely & Accounting"
seoTitle: "Timely Time Tracking Integration for ReAI Timesheets"
description: "Fetch logged Timely hours with your own Timely OAuth app and post them to ReAI Timesheets by employee and project."
summary: "Authorize your own Timely app, fetch logged hours for a period and post them to ReAI Timesheets."
industry: operations
icon: icons/timely.svg
webAppUrl: /app/timely/
sourcePath: web/worker/apps/timely.js
highlights:
  - "Uses the Timely API with an OAuth app you create in Timely"
  - "Matches people by email or name and projects by name"
  - "Post one entry at a time or all matched entries after a check"
---

## What moves into ReAI

Logged hours from Timely become ReAI timesheet entries with date, hours, employee, project and a comment that holds the Timely project and note. People are matched to ReAI employees by email or name, and projects by name. Draft and deleted entries are skipped.

Timesheet entries are not postings. They feed project invoicing and the payroll basis in ReAI, where you approve them as usual.

## Setup

1. As a Timely admin, open **Settings → Devs** and add an application. Set the redirect URI to `https://apps.reai.no/app/timely/`.
2. Click **Open integration** and connect your ReAI company.
3. Enter the application ID and your Timely account ID (the number in `app.timelyapp.com/<id>/`), create the authorize link and approve access in Timely.
4. Back on the page, enter the application secret and the period, then fetch the hours. The code from Timely works once; authorize again for the next fetch.
5. Check the entries and post them to ReAI Timesheets.

The secret and the token are used for one request and never stored.
