---
title: "EG HoltePortalen & Accounting Integration"
seoTitle: "EG HoltePortalen Hours to ReAI | Free Integration"
description: "Fetch project hours from the HoltePortalen API and post them to ReAI Timesheets by employee and project."
summary: "Fetch project hours from the HoltePortalen API and post them to ReAI Timesheets."
industry: operations
webAppUrl: /app/holte/
sourcePath: web/worker/apps/holte.js
highlights:
  - "Uses the HoltePortalen API with an API token from the settings"
  - "Shows the HoltePortalen project number, project name and user"
  - "Leaves out absence and negative registrations"
---

## Move EG HoltePortalen hours into ReAI

Holte is now part of EG, and the product is called EG HoltePortalen. The integration fetches project time registrations for a period and shows the project, user and comment. You choose the employee and, if you like, the project in ReAI and post the entries one by one.

## Set up HoltePortalen with ReAI

1. Sign in to HoltePortalen and open **Settings**, tab **API tokens**.
2. Give the token a name and an expiry date, click **Create new token** and copy the value. It is shown only once.
3. Click **Open integration**, connect ReAI and choose the employee and, optionally, the project.
4. Paste the token, choose the period and, optionally, the HoltePortalen user's email to fetch one person's hours.
5. Review the hours and click **Post to ReAI** for each entry.
