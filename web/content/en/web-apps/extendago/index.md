---
title: "ExtendaGO & Accounting Integration"
seoTitle: "ExtendaGO Accounting Integration for ReAI: GBAT10 Files"
description: "Book the daily ExtendaGO GBAT10 file in ReAI as a review voucher, with the accounts and VAT codes set in ExtendaGO. Free and open source."
summary: "Upload the daily ExtendaGO GBAT10 file and create one balanced review voucher in ReAI."
industry: payments
webAppUrl: /app/extendago/
sourcePath: web/worker/apps/extendago.js
highlights:
  - "Reads the GBAT10 file that ExtendaGO delivers to SFTP every night"
  - "Keeps the accounts and VAT codes from the ExtendaGO accounting settings"
  - "Creates a review voucher in ReAI that you confirm, with a duplicate check per day"
---

## What moves into ReAI

ExtendaGO creates one GBAT10 file per day with payments per tender and revenue per VAT rate. The integration shows one voucher with payments on the debit side and revenue on the credit side. Nothing is booked until you check the preview and create the review voucher.

| Line | Account in ReAI |
| --- | --- |
| Payments | The account set for the tender in ExtendaGO |
| Revenue per VAT rate | The account and VAT code set for the rate in ExtendaGO, posted including VAT |
| Deviations | The deviation account set in ExtendaGO |

The VAT codes in ExtendaGO must be ReAI output VAT codes, for example `3` for 25 %.

## Setup

1. In ExtendaGO, open **Settings → Integrations → Accounting** and enter the SFTP server that receives the file.
2. Set an account for each tender, an account and VAT code for each VAT rate, the department number of the store and a deviation account.
3. Download the file for the day from the SFTP server.
4. Click **Open integration**, connect ReAI, choose the company and upload the file.
5. Check the preview against the Z-report, tick the confirmation box and create the review voucher.
