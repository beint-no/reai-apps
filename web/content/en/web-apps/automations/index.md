---
title: "Make, Zapier and n8n templates"
seoTitle: "ReAI API in Make, Zapier and n8n | Free open source templates"
description: "Ready HTTP requests for the ReAI API in n8n, Make and Zapier, plus a check of your connection and company id."
summary: "Ready HTTP requests for the ReAI API in n8n, Make and Zapier."
industry: operations
webAppUrl: /app/automations/
sourcePath: web/worker/apps/automations/
highlights:
  - "Templates for customers, orders, leads, driving log and vouchers"
  - "Looks the customer up before creating it, so none are duplicated"
  - "Shows which company id to use"
---

## How it works

Every HTTP step in Make, Zapier or n8n calls `https://app.reai.no/api/` with a token in `Authorization: Bearer`. A personal token also needs `X-Tenant-Id` with the company id. The app shows templates for common tasks and links to the [ReAI OpenAPI](https://app.reai.no/openapi/public) for every field.

## Getting started

1. Create a token in ReAI under your profile, **Access tokens**.
2. Open the app, click **Connect to ReAI**, choose a company and click **Test ReAI connection** to see the company id.
3. Paste the template into an HTTP step and replace the token and company id.
