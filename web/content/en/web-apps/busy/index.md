---
title: "Finago Busy & Accounting Integration"
seoTitle: "Finago Busy Hours to ReAI | Free Integration"
description: "Fetch hour entries from Finago Busy through its API and post them to ReAI Timesheets by employee and project."
summary: "Fetch hour entries from Finago Busy through its API and post them to ReAI Timesheets by employee and project."
industry: operations
webAppUrl: /app/busy/
sourcePath: web/worker/apps/busy/
highlights:
  - "Uses the Finago Busy API v2 with a workspace API token"
  - "Can limit the import to approved hour entries"
  - "Shows the Busy project and user before hours reach ReAI"
---

## Move Finago Busy hours into ReAI

Busy is now called Finago Busy and is provided by 24SevenOffice. The integration fetches hour entries for a period, deducts breaks and shows the Busy project, user and comment. Each entry goes to the ReAI employee with the same email as the Busy user. When you fetch one person's hours, the employee you choose is used. Entries already posted to ReAI are skipped.

## Set up Finago Busy with ReAI

1. An admin creates an API token in the Finago Busy workspace settings under **Integrations**. Give it the scopes `hourEntries:read`, `users:read` and `projects:read`.
2. Click **Open integration**, connect ReAI and, optionally, choose the employee and the project.
3. Paste the token, choose the period and, optionally, the Busy user's email to fetch one person's hours.
4. Review the hours and click **Post to ReAI** for each entry.
