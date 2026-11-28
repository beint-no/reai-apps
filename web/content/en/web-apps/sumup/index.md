---
title: "SumUp & Accounting Integration"
seoTitle: SumUp Accounting Integration for ReAI — Card Terminal Reconciliation
description: Connect SumUp card terminals to ReAI accounting for free. Match SumUp payouts and fees against pending bank transactions and export CSV.
summary: Compare SumUp card terminal payouts and transaction fees with pending ReAI bank transactions.
industry: payments
icon: icons/sumup.svg
webAppUrl: /app/sumup/
sourcePath: web/worker/apps/reconcile.js
highlights:
  - "Reads SumUp Merchant Payouts API directly with your Merchant Code and API key"
  - "Shows net payout amount and deducted SumUp fee alongside ReAI bank candidates"
  - "Exports clean reconciliation CSV for monthly bookkeeping"
---

## How SumUp fits into your Norwegian accounting

SumUp settles card terminal sales net of transaction fees into your business bank account. Using your SumUp Merchant Code and API key, this integration pulls every `SUCCESSFUL` payout for the month, highlights its fee and matches it against pending bank deposits in ReAI—giving small retail, salon and hospitality businesses an easy monthly close without paid middleware.
