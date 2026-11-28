---
title: "PsykBase Online invoices and accounting"
seoTitle: "PsykBase to ReAI | Free open source integration for psychology clinics"
description: "Fetch PsykBase Online invoices for a period and create a balanced review voucher in ReAI with VAT exempt treatment revenue and payments by method."
summary: "Book PsykBase Online invoices as one ReAI review voucher per period, with VAT exempt health services on VAT code 6."
industry: operations
icon: icons/psykbase.svg
webAppUrl: /app/psykbase/
sourcePath: web/worker/apps/psykbase.js
highlights:
  - "Reads invoices and invoice lines from the PsykBase API with a Personal Access Token"
  - "Books VAT exempt health services on 3200 with VAT code 6"
  - "Creates a review voucher you approve in ReAI; the token is never stored"
---

## What moves into ReAI

The app reads PsykBase invoices dated in the period you choose (drafts are skipped) and creates one review voucher in ReAI:

| PsykBase invoice | ReAI account | VAT code |
| --- | --- | --- |
| Paid by card or other methods | `1580` | 0 |
| Paid in cash | `1900` | 0 |
| Unpaid, bank transfer and health insurance invoices | `1570` | 0 |
| Treatment lines without VAT | `3200` | 6 |
| Lines with 25% VAT, incl. VAT | `3000` | 3 |
| Lines with 15% VAT, incl. VAT | `3010` | 31 |
| Lines with 12% VAT, incl. VAT | `3020` | 33 |

Health services from psychologists and psychiatrists are exempt from VAT, so treatment revenue is booked on VAT code 6. If you also sell taxable items, ReAI splits those lines into net revenue and output VAT. The voucher is flagged for review and the same period cannot be booked twice.

## Setup

1. In PsykBase, go to **Apps** and activate the **API** app.
2. Open **API settings** and click **Create New Token** under **Personal Access Tokens**. Choose the **invoices-read** scope and copy the token; it is shown only once.
3. Open the app, click **Connect to ReAI** and choose the company.
4. Paste the token, choose the period, click **Fetch from PsykBase API**, check the preview and create the review voucher.

Only NOK invoices are supported. The API has no date filter, so the app reads invoices newest first; very old periods may need to be split. Check the voucher against the accounting report in PsykBase and attach it in ReAI.
