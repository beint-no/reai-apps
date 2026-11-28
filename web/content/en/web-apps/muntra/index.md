---
title: "Muntra & Accounting Integration"
seoTitle: "Muntra to ReAI | Free Integration for Dental Clinics"
description: "Fetch the Muntra general ledger for a period and book it as one balanced ReAI review voucher, summed by account. Free and open source."
summary: "Sum the Muntra postings for a period by account and create one ReAI review voucher with patient invoices, payments and HELFO."
industry: operations
webAppUrl: /app/muntra/
sourcePath: web/worker/apps/muntra/
highlights:
  - "Reads Muntra ledger transactions through the Muntra API with a personal access token from Muntra"
  - "Sums by account and lets you map Muntra accounts to ReAI accounts"
  - "Posts treatment revenue with the VAT code for sales outside the VAT act"
---

## What moves into ReAI

Muntra books patient invoices, payments, HELFO settlements and fees in its own general ledger. The integration fetches every posting in the period you choose, sums it by account and creates one balanced ReAI review voucher dated the last day of the period.

| From Muntra | In ReAI |
| --- | --- |
| Revenue accounts | Same account with the VAT code for sales outside the VAT act |
| Card, cash and bank | Same account, or the bank linked to that account |
| Patient and HELFO receivables | The account you map them to, for example `1570` and `1530` |
| Other accounts | Same account with VAT code 0 |

Dental health services are exempt from VAT. If Muntra posted VAT on a `27xx` account in the period, the integration stops, and taxable product sales must be booked separately. Customer receivables on `1500` need a customer in ReAI, so map them to a plain account. A new voucher cannot overlap a Muntra voucher already booked in ReAI.

## Set up Muntra with ReAI

1. Ask Muntra support for a personal access token for the Muntra API. Tokens cannot be created in Muntra itself.
2. Click **Open integration**, connect ReAI and choose the company.
3. Paste the token and choose the period. Muntra allows up to three months per fetch.
4. Click **Fetch from Muntra API** and review the accounts. Enter any mappings as `1510=1570`, one per line, and fetch again.
5. Check the totals against the Muntra accounting reports, tick the confirmation and create the voucher.

The token is used only for these requests and is never stored.
