---
title: "Qondor & Accounting Integration"
seoTitle: "Qondor Invoices to ReAI | Free Integration"
description: "Fetch invoice specifications and invoices from Qondor through the API and create ReAI orders or invoices with the lines and VAT from Qondor. Free and open source."
summary: "Fetch unprocessed Qondor invoices, record them in ReAI and mark them as processed in Qondor."
industry: operations
webAppUrl: /app/qondor/
sourcePath: web/worker/apps/qondor/
highlights:
  - "Reads invoices through the Qondor Invoicing API with your subscription key"
  - "Keeps the lines, currency and VAT rate from Qondor"
  - "Marks the invoice as processed in Qondor with the ReAI number"
---

## What moves into ReAI

The integration fetches the invoices that are not processed yet in Qondor. An invoice specification becomes a ReAI order that you invoice from ReAI. An invoice that already has an invoice number in Qondor is imported into ReAI with that number and booked.

| From Qondor | In ReAI |
| --- | --- |
| Invoice specification | Order ready to invoice |
| Numbered invoice | Imported invoice with the Qondor number |
| Product price | Order line excluding VAT, with the VAT code for the rate |
| Recipient | Existing customer found by organization number or email, otherwise a new customer |

Credit notes, card payments and lines where VAT is calculated on a different base than the price stay in Qondor. Record them manually in ReAI.

## Set up Qondor with ReAI

1. Ask Qondor support for access to the API portal for the Production environment.
2. Sign in to the Qondor API portal and copy the primary key from your profile.
3. Click **Open integration**, connect ReAI and choose the company.
4. Paste the key and fetch the invoices.
5. Check the amounts and click **Stage order** or **Import invoice** for each invoice.

The key is used only for these requests and is never stored.
