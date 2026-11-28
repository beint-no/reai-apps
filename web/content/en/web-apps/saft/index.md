---
title: "SAF-T Migration (Tripletex, Fiken, PowerOffice, Visma)"
seoTitle: "SAF-T Migration to ReAI (Tripletex, Fiken, PowerOffice, Visma)"
description: "Move to ReAI with the SAF-T Financial file from your old accounting system: import customers and suppliers and save the closing balances as the ReAI opening balance."
summary: "Upload the SAF-T Financial file from your old system, import customers and suppliers into ReAI and save the closing balances as the opening balance."
industry: operations
webAppUrl: /app/saft/
sourcePath: web/worker/apps/saft/
highlights:
  - "Reads SAF-T Financial versions 1.30 and 1.40"
  - "Customer and supplier balances are posted per party"
  - "Checks that the balance sheet balances before anything is saved"
---

## What the tool does

Every Norwegian accounting system can export SAF-T Financial. The tool reads the file in your browser session and shows the closing balance of each account and the customers and suppliers in the file.

| Step | ReAI API |
| --- | --- |
| Import customers and suppliers that ReAI does not have yet, matched by number, organization number or name | `POST /api/customers`, `POST /api/suppliers` |
| Save balance sheet closing balances as the opening balance, dated the last day of the SAF-T period | `PUT /api/opening-balance` |

## Quick start

1. Export SAF-T Financial for the last closed year from the old system. Close the year first, so the result is moved to equity.
2. Connect your ReAI company above and upload the file.
3. Click **Import missing customers and suppliers** until none are left.
4. Click **Save opening balance in ReAI**.

## Good to know

- Customer and supplier accounts are posted per customer and supplier from the balances in the file.
- Bank accounts are posted to the ReAI bank account that uses the same ledger account. Register fixed assets in ReAI first.
- Accounts that are not four digit NS 4102 accounts are listed so you can enter them by hand.
- An existing ReAI opening balance is only replaced when you tick replace.
