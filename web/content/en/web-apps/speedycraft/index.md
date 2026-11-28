---
title: "SpeedyCraft & Accounting Integration"
seoTitle: "SpeedyCraft Work Orders to ReAI Timesheets and Orders"
description: "Fetch SpeedyCraft service hours and materials, log the hours in ReAI Timesheets and stage each work order as a draft ReAI order. Free and open source."
summary: "Fetch SpeedyCraft work order hours and materials through the SpeedyCraft REST API into ReAI timesheets and draft orders."
industry: operations
icon: icons/speedycraft.svg
webAppUrl: /app/speedycraft/
sourcePath: web/worker/apps/speedycraft.js
highlights:
  - "Uses the SpeedyCraft REST API with credentials issued by Devinco"
  - "Logs service hours per employee and skips rejected hours"
  - "Stages one draft order per work order with hours and materials ex. VAT"
---

## What moves into ReAI

The integration reads service hours (AssignmentService) and materials (AssignmentProduct) registered in the chosen period, together with the work order, customer and employee they belong to.

* **Hours** become ReAI timesheet rows. Service types that SpeedyCraft excludes from hour totals, such as driving or extra costs, and absence types are not logged as hours.
* **Invoice basis** becomes one draft ReAI order per work order. The amount is quantity times customer price less discount for hours and materials, ex. VAT. The order carries the work order number as external reference, so staging the same work order twice opens the existing draft instead of creating a new one.

Nothing is invoiced or booked automatically. You review and invoice each draft order in ReAI, where the sales account and VAT code are set.

## Setup

1. SpeedyCraft must run in the Devinco cloud. Email **support@devinco.com** and ask for API access for your company: a **subjectId** and **API key** for the user that runs the integration, and the **client ID** (GUID) of your SpeedyCraft client. Devinco decides whether any fees apply.
2. Click **Open integration**, connect your ReAI company and choose fallback customer, fallback employee and an optional project.
3. Enter the three values from Devinco, choose the period and click **Fetch from SpeedyCraft API**.
4. Click **Log hours** and **Stage draft order** on the rows you want.

The credentials are used only for that request and are never stored.
