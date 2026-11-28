---
title: "Hybel.no & Accounting Integration"
seoTitle: "Hybel.no Integration for ReAI: Monthly Bilagsjournal"
description: Check and book the Hybel Premium Bilagsjournal as one review voucher in ReAI. Free and open source.
summary: Validate a monthly Hybel CSV journal in your browser and post a balanced review voucher to ReAI.
industry: real-estate
webAppUrl: /app/hybel/
sourcePath: web/worker/apps/hybel/
highlights:
  - "Reads the Hybel Bilagsjournal CSV in UTF-8 or Windows-1252 with automatic column mapping"
  - "Checks that every date and BatchID group balances to 0.00 before anything is sent to ReAI"
  - "Checks the organization number, chart of accounts, bank accounts and earlier imports against ReAI"
---

## Rental bookkeeping from Hybel into ReAI

Hybel Premium keeps the tenant ledger and lets you download a **Bilagsjournal** with every transaction in a period. The integration checks one month of that journal against the ReAI chart of accounts and bank accounts and creates one balanced review voucher with a SHA-256 audit trail. Tenant detail stays in Hybel.

## Setup

1. In Hybel, open **Rapporter → Innstillinger** and enter the ReAI accounts, for example `1510` for tenant receivables and `1520` for receivables on Hybel. Set the VAT code to `0`. Do not use `1500`, which requires a customer subledger in ReAI.
2. Open **Rapporter**, choose **Bilagsjournal**, one calendar month and a CSV format, and press **Last ned**.
3. Click **Open integration**, connect ReAI and choose the company.
4. Upload the file, check the column mapping and preview, and create the voucher. Attach the Hybel period report in ReAI.
