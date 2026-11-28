---
title: "EasyPractice & Accounting Integration"
seoTitle: "EasyPractice Accounting Integration for ReAI: Invoices"
description: "Book EasyPractice invoices for a period in ReAI as one review voucher, split by VAT rate and payment status. Free and open source."
summary: "Fetch the EasyPractice invoices for a period and create one balanced review voucher in ReAI."
industry: operations
webAppUrl: /app/easypractice/
sourcePath: web/worker/apps/easypractice/
highlights:
  - "Reads invoices through the EasyPractice API with a personal access token"
  - "Separates treatments without VAT from sales with VAT and posts the matching ReAI VAT code"
  - "Creates a review voucher in ReAI that you confirm, with a duplicate check"
---

## What moves into ReAI

The integration reads the invoices with an invoice date in the chosen period. Drafts are left out. Nothing is booked until you check the preview and create the review voucher.

| Line | Account in ReAI |
| --- | --- |
| Paid in cash | `1900` |
| Paid by card or another payment type | `1580` for bank matching |
| Not yet paid | `1570` |
| Sales without VAT | `3100` |
| Sales with VAT | `3000`, posted including VAT with the ReAI output VAT code |

All invoices in the period must be in the currency the company keeps its accounts in. Sales without VAT use the ReAI code for sales outside the VAT Act when the company has it. If an invoice is credited, the preview shows a warning so you can check the credit note.

## Setup

1. In EasyPractice, open **Apps** and activate the **API** app.
2. Open **API Settings**, click **Create New Token** under personal access tokens, choose the **invoices-read** scope and copy the token.
3. Click **Open integration**, connect ReAI and choose the company.
4. Enter the token and the period.
5. Check the preview against the invoice list in EasyPractice, tick the confirmation box and create the review voucher.

The token is used only for that request and is never stored.
