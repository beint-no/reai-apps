---
title: "Teamtailor & Accounting Integration"
seoTitle: "Teamtailor New Hires to ReAI | Free Integration"
description: "Fetch hired candidates from Teamtailor through the API and create them as employees in ReAI with contact details and start date. Free and open source."
summary: "Create ReAI employees from candidates in the Hired stage in Teamtailor."
industry: operations
webAppUrl: /app/teamtailor/
sourcePath: web/worker/apps/teamtailor/
highlights:
  - "Reads candidates in a Hired stage through the Teamtailor API"
  - "Uses the start date and work email from Teamtailor Onboarding when available"
  - "Skips people who are already employees in ReAI"
---

## What moves into ReAI

The integration reads candidates moved to a Hired stage in Teamtailor from a date you choose. Each hire is shown with job, email and hired date and is matched against your ReAI employees by email or name. You create the new employees one by one.

| From Teamtailor | In ReAI |
| --- | --- |
| Candidate name, email, phone and address | Employee |
| Start date from Onboarding, or the date you choose | Employment date and employment line |
| Work email from Onboarding | Employee email |

National identity number, bank account, salary and tax card are not in Teamtailor. Add them in ReAI before the first payroll.

## Set up Teamtailor with ReAI

1. In Teamtailor, a Company Admin opens **Settings → Integrations → API keys** and clicks **New API key**.
2. Choose the **Admin** scope with **Read** access and copy the key.
3. Click **Open integration**, connect ReAI and choose the company.
4. Paste the key, choose the data region and the earliest hired date, and fetch.
5. Check the start date on each row and click **Create in ReAI**.

The key is used only for these requests and is never stored.
