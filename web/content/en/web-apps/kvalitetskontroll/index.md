---
title: "Kvalitetskontroll & Accounting Integration"
seoTitle: "Kvalitetskontroll (KS) Hours to ReAI Timesheets"
description: "Fetch approved hour registrations from Kvalitetskontroll and log them as ReAI timesheet rows by employee and project. Free and open source."
summary: "Fetch approved Kvalitetskontroll hours through the KS API and log them in ReAI Timesheets."
industry: operations
icon: icons/kvalitetskontroll.svg
webAppUrl: /app/kvalitetskontroll/
sourcePath: web/worker/apps/kvalitetskontroll.js
highlights:
  - "Uses the Kvalitetskontroll API with your own personal access token"
  - "Fetches approved hours only, with hour type, project and employee"
  - "Matches employees by name and logs each row only when you click it"
---

## What moves into ReAI

Approved hour registrations from Kvalitetskontroll become timesheet rows in ReAI. Each row keeps the date, the hours after break, the hour type and the comment. Employees are matched to ReAI employees by name, with a fallback employee you choose. You can link the rows to one ReAI project.

Nothing is booked to the ledger. Hours land in ReAI Timesheets, where you approve them and invoice them from the project as usual. Registrations that are not approved in Kvalitetskontroll are left out.

## Setup

1. Log in at **api.kvalitetskontroll.no/admin** with your Kvalitetskontroll user and add a new **Personal Access Token**.
2. Click **Open integration**, connect your ReAI company and choose a fallback employee and an optional project.
3. Paste the token, choose the period and click **Fetch from Kvalitetskontroll API**.
4. Review the rows and click **Log hours** on the ones you want in ReAI.

The token is used only for that request and is never stored.
