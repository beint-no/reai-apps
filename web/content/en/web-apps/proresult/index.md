---
title: "Proresult & Accounting Integration"
seoTitle: "Proresult Hour Reports to ReAI Timesheets and Orders"
description: "Import a Proresult hour report, log the hours in ReAI Timesheets and stage unbilled hours as draft ReAI orders per project. Free and open source."
summary: "Import the Proresult Timelister egendefinert report into ReAI timesheets and draft orders."
industry: operations
webAppUrl: /app/proresult/
sourcePath: web/worker/apps/proresult/
highlights:
  - "Reads the Timelister egendefinert hour report saved as CSV"
  - "Logs hours per employee with hour type, project and comment"
  - "Stages unbilled hours times hour type price as one draft order per project and month"
---

## What moves into ReAI

Proresult does not offer an API that customers can use, so this integration reads the **Timelister egendefinert** hour report.

* **Hours** become ReAI timesheet rows. Employees are matched to ReAI employees by name, with a fallback employee you choose.
* **Invoice basis**: rows not marked as invoiced (**Fakturert**) are priced with **Timetype-pris** and summed into one draft ReAI order per project and month. The order carries the project and month as external reference, so the same project month is never staged twice.

Nothing is invoiced or booked automatically. You review and invoice each draft order in ReAI, where the sales account and VAT code are set. Invoice basis that Proresult already sends to another accounting system should not be staged again here.

## Setup

1. In Proresult open **Rapporter → Timer → Timelister egendefinert**.
2. Choose the columns **Dato**, **Prosjektnummer**, **Prosjekt**, **Kunde**, **Ansatt**, **Timetype**, **Timetype-pris**, **Kommentar** and **Fakturert**, keep the hours visible and choose the period.
3. Save the report as an Excel file, open it and save the sheet as CSV.
4. Click **Open integration**, connect your ReAI company, choose fallback customer, fallback employee and an optional project, and upload the CSV.
5. Click **Log hours** and **Stage draft order** on the rows you want.

The file is read only for the preview and is never stored.
