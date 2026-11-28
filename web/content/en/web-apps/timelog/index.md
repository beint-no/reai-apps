---
title: "TimeLog & Accounting Integration"
seoTitle: "TimeLog Hours to ReAI | Free Integration"
description: "Fetch your TimeLog PSA time registrations through the API and post them to ReAI Timesheets, linked to the right employee and project. Free and open source."
summary: "Fetch a month of TimeLog hours and post them to ReAI Timesheets."
industry: operations
webAppUrl: /app/timelog/
sourcePath: web/worker/apps/timelog/
highlights:
  - "Uses the TimeLog REST API with your personal access token"
  - "Matches the ReAI employee by email and projects by name"
  - "Skips absence and hours that are already posted"
---

## What moves into ReAI

The integration fetches your TimeLog time registrations for a month. Each registration becomes one row in ReAI Timesheets on the same date, with the project, task and comment from TimeLog. Absence such as holiday and sick leave is left out.

| From TimeLog | In ReAI |
| --- | --- |
| Time registration | Timesheet row for the employee and date |
| Project name | ReAI project with the same name |
| Registration ID | Marker in the comment that prevents double posting |

## Set up TimeLog with ReAI

1. Sign in to TimeLog and go to **login.timelog.com/personaltoken**. Click **New Token**, give the token a name and an expiry date, and copy it.
2. Find your TimeLog URL under **System Administration → Integrations and API → Transactional API settings**. It looks like `https://app4.timelog.com/yourcompany`.
3. Click **Open integration**, connect ReAI and choose the company.
4. Paste the URL and the token, choose the month and fetch the hours.
5. Check the employee and project, and click **Post to ReAI** for each row.

The token is used only for these requests and is never stored. Each person uses their own token, because TimeLog gives access to the hours of the token owner.
