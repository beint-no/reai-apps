---
title: "Fonn & Accounting Integration"
seoTitle: "Fonn Time Cards to ReAI Timesheets"
description: "Fetch Fonn time cards per project and log them as ReAI timesheet rows by employee and project. Free and open source."
summary: "Fetch Fonn time cards through the Fonn API and log them in ReAI Timesheets."
industry: operations
icon: icons/fonn.svg
webAppUrl: /app/fonn/
sourcePath: web/worker/apps/fonn.js
highlights:
  - "Uses the Fonn API with your subscription key and access token"
  - "Fetches time cards for every project or one project number"
  - "Keeps time classification, note, client and project member names"
---

## What moves into ReAI

Time cards registered in Fonn become timesheet rows in ReAI. Each row keeps the date, the hours, the time classification, the note, the project and the project client. Project members are matched to ReAI employees by name, with a fallback employee you choose. You can link the rows to one ReAI project.

Nothing is booked to the ledger. Hours land in ReAI Timesheets, where you approve them and invoice them from the project as usual. Fonn does not expose materials or invoice basis through its API, so only hours are fetched.

## Setup

1. Register on the **Fonn API developer portal** (api-developer.fonn.io) with the same email as your Fonn user, open **Profile** and add a subscription. Fonn activates it, and the **subscription key** then appears under **Profile**.
2. As organization administrator in Fonn, click **ORGANIZATION** in the upper right corner, open **Integrations → API**, choose the user the token acts for and click **Generate token**.
3. Click **Open integration**, connect your ReAI company and choose a fallback employee and an optional project.
4. Enter the subscription key and access token. Leave the organization ID empty to detect it, and enter a project number when the organization has many projects. Choose a period of up to 62 days and click **Fetch from Fonn API**.
5. Review the rows and click **Log hours** on the ones you want in ReAI.

The keys are used only for that request and are never stored.
