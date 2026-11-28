---
title: "Råfisklaget & Accounting Integration"
seoTitle: "Råfisklaget Settlements to ReAI | Free Integration"
description: "Fetch settlements from Norges Råfisklag and book each one as a balanced review voucher in ReAI. Free and open source."
summary: "Fetch a period's settlements from Råfisklaget and create one voucher per settlement with catch value, VAT, levies, deductions and payout."
industry: operations
webAppUrl: /app/rafisklaget/
sourcePath: web/worker/apps/rafisklaget/
highlights:
  - "Reads settlements from Råfisklaget's SeddelData web service"
  - "Posts the catch value as sales with output VAT and each levy and deduction to its own account"
  - "Checks that the settlement adds up to the payout before creating the voucher"
---

## What moves into ReAI

The integration fetches the settlements for your fisher number or organisation number in the period you choose. Each settlement becomes one review voucher dated on the sales date.

| From the settlement | In ReAI |
| --- | --- |
| Catch value and output VAT | Credit to the sales account with the output VAT code for the rate |
| Lagsavgift, product, research, control and resource levies | Debit to the accounts you choose |
| Pension deduction, membership dues, gutting cost and own share deductions | Debit to the accounts you choose |
| Liens (heftelser) | Debit to a liability account you choose |
| Input VAT | On the deduction its VAT base belongs to, with the input VAT code |
| Payout | Debit to a receivable account that you match against the bank payout |

A voucher is created only when the catch value, VAT and deductions add up to the payout. The same settlement cannot be booked twice.

## Set up Råfisklaget with ReAI

1. Ask Råfisklaget for a username and password to the SeddelData web service, through Min side or it-vakt@rafisklaget.no. Accountants can apply too.
2. Click **Open integration**, connect ReAI and choose the company.
3. Enter the username, password, fisher number or organisation number and the period. Check the accounts under **Accounts**.
4. Compare the preview with the settlement on Min side, tick the box and create the voucher.
5. Upload the settlement PDF to the voucher in ReAI.

The username and password are used only for these requests and are never stored.
