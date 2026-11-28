---
title: "SumUp & Accounting Integration"
seoTitle: "SumUp Accounting Integration for ReAI: Payout Reconciliation"
description: Connect SumUp card terminals to ReAI accounting for free. Match SumUp payouts and fees against pending bank transactions and export CSV.
summary: Compare SumUp card terminal payouts and transaction fees with pending ReAI bank transactions.
industry: payments
webAppUrl: /app/sumup/
sourcePath: web/worker/apps/sumup/
highlights:
  - "Reads SumUp Merchant Payouts API directly with your Merchant Code and API key"
  - "Shows net payout amount and deducted SumUp fee alongside ReAI bank candidates"
  - "Exports clean reconciliation CSV for monthly bookkeeping"
---

## What it does

The integration fetches every successful SumUp payout for one month and matches it against pending ReAI bank transactions by amount, date and reference. Deductions for refunds and chargebacks are shown as a separate note. You get a CSV report as documentation. Nothing is booked.

SumUp deducts the card fee before paying out. Gross sales, the card fee (`7770`, VAT code `0`) and the net bank deposit are posted separately.

## Setup

1. Sign in at **me.sumup.com**, open your profile and go to **Settings → For Developers → Toolkit → API Keys**. Click **Create** and copy the key.
2. Find your merchant code under your SumUp profile.
3. Click **Open integration**, connect ReAI and choose the company.
4. Enter the merchant code, API key and month, choose the ReAI bank account and download the report.

The key is used only for that request and is never stored.
