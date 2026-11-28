---
title: "Huma & Accounting Integration"
seoTitle: "Huma Employees to ReAI | Free Integration"
description: "Fetch active employees from the Huma Open API and create the missing ones in ReAI Employees with start date and bank account."
summary: "Fetch active employees from the Huma Open API and create the missing ones in ReAI Employees."
industry: operations
webAppUrl: /app/huma/
sourcePath: web/worker/apps/huma.js
highlights:
  - "Uses the Huma Open API with a client ID and client secret"
  - "Matches employees already in ReAI by email or name"
  - "Checks Norwegian account numbers before sending them to ReAI"
---

## Move Huma employees into ReAI

The integration fetches active employees from Huma with name, email, start date, position percentage and Norwegian bank account. Employees already in ReAI show as linked, and you create the rest one by one. It sends no invitations and files no A-melding.

## Set up Huma with ReAI

1. In Huma, go to **System settings → Open API** and click **Add API key**. Copy the client ID and client secret. The secret is shown only once.
2. Give the API key a role that can read employees, positions and bank accounts. A new key has no access until it has a role.
3. Click **Open integration**, connect ReAI and paste the client ID and client secret.
4. Review the list and click **Create in ReAI** for each employee you want to add.
