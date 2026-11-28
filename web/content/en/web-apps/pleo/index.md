---
title: "Pleo & Accounting Integration"
seoTitle: "Pleo Accounting Integration for ReAI: Export Jobs to Vouchers"
description: "Book Pleo export jobs as review vouchers in ReAI, using the accounts, VAT and contra account from Pleo. Free and open source."
summary: "Fetch the oldest Pleo export job, create one balanced ReAI voucher and mark the expenses as exported in Pleo."
industry: operations
webAppUrl: /app/pleo/
sourcePath: web/worker/apps/pleo/
highlights:
  - "Reads export jobs through the Pleo Export API with a Pleo API key"
  - "Uses the account and VAT rate on each expense and the contra account from Pleo"
  - "Marks the expenses as exported in Pleo with a link to the ReAI voucher"
---

## What moves into ReAI

The integration reads the oldest export job waiting in Pleo. Each expense line is debited to the account chosen in Pleo, including VAT with the ReAI input VAT code. The total of each expense is credited to the Pleo contra account, for example the card account. Nothing is booked until you check the preview and create the voucher.

| From Pleo | In ReAI |
| --- | --- |
| Expense line | Debit on the Pleo account, with the input VAT code for the rate |
| Expense total | Credit on the Pleo contra account |
| Export job | One review voucher, with a duplicate check |

Once the voucher exists, the expenses are marked as exported in Pleo with the voucher number and link. Supplier invoices that Pleo books as accounts payable stay in Pleo.

## Setup

1. If **API Keys** is missing under **Settings** in Pleo, ask Pleo Support to enable it.
2. In Pleo, open **Settings → API Keys → Create API Key**. Give the key the `export-jobs:read`, `export-jobs:write` and `export-items:read` permissions and copy it.
3. Check that every expense has a four digit account and that a contra account is set under **Settings → Accounting → Contra accounts**.
4. Select the expenses under **Exports**, click **Add to Export Queue**, open **Export Queue** and click **Export**.
5. Click **Open integration**, connect ReAI and choose the company. Paste the key and fetch the export job.
6. Check the preview, tick the confirmation box and create the voucher.

The key is used only for these requests and is never stored.
