---
title: "Proteria Frakt & Accounting"
seoTitle: "Proteria Frakt Freight Rebilling in ReAI"
description: "Import the Proteria Frakt invoice report and stage freight per shipment as ReAI draft customer orders for rebilling."
summary: "Read the Proteria Fakturarapport CSV, map its columns and stage freight lines as ReAI draft orders you review."
industry: ecommerce-logistics
webAppUrl: /app/proteria/
sourcePath: web/worker/apps/proteria/
highlights:
  - "Reads the Fakturarapport CSV from Proteria reporting"
  - "You map the report columns, with AmountWithoutVAT preselected"
  - "Creates draft customer orders only when you click"
---

## What moves into ReAI

Each shipment in the Proteria Frakt invoice report becomes a freight line you can stage as a draft customer order in ReAI. Rows with the same shipment number are added up, and the order carries the shipment number as external reference, so a shipment is not staged twice. The order line carries the freight amount excluding VAT, the shipment number and the carrier or product text. Receivers are matched to ReAI customers by name; otherwise you pick a fallback customer.

Nothing is invoiced or posted automatically. Each order stays a draft until you review and invoice it in ReAI, where your normal sales account and VAT code for freight apply.

## Why a report file

The Proteria Frakt API (CloudConnect) books shipments, labels and print jobs, but it has no endpoint that lists shipments or freight costs. The invoice report is the documented place where invoiced freight per shipment is available.

## Setup

1. Log in to Proteria reporting at **reportingweb.proteria.com**, choose **Lag Rapport** and pick **Fakturarapport** (the simplified version has one row per shipment).
2. Download the report as CSV.
3. Click **Open integration**, connect your ReAI company and upload the file.
4. Choose which columns hold the amount excluding VAT, the date and the shipment number, and optionally the receiver and the product.
5. Check the freight lines and click **Stage order** on the ones you want to rebill.
