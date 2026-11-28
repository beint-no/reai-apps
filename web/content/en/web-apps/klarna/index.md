---
title: "Klarna & Accounting Integration"
seoTitle: "Klarna Integration for ReAI: Payout Reconciliation"
description: Match Klarna payouts against ReAI bank transactions and download a reconciliation report. Free and open source.
summary: Compare Klarna Settlements API payouts with pending ReAI bank transactions and export a reconciliation CSV.
industry: payments
webAppUrl: /app/klarna/
sourcePath: web/worker/apps/klarna/
highlights:
  - "Reads payouts from the Klarna Settlements API with sales, fees and returns"
  - "Finds matching ReAI bank transactions by payment reference or amount"
  - "Exports a CSV report you can attach as documentation"
---

## How Klarna settlements work in accounting

Klarna batches captures, refunds and fees into periodic settlement payouts. The amount paid to your bank account is net of fees and returns and carries Klarna's `payment_reference`. Post sales against a clearing account, typically `1580`, so its balance returns to zero once the net payout and the fee (`7770`, VAT code `0`) are booked.

## Setup

1. Get an API key (`klarna_live_api_…`) in the Klarna Partner Portal, or ask Klarna merchant support for one.
2. Click **Open integration**, connect ReAI, pick your bank account and payout month, and click **Review Klarna payouts**.
3. Check the matches between Klarna payouts and ReAI bank lines and download the CSV report as documentation.

The integration uses Klarna's European API (`api.klarna.com`). The key is used only for that request and is never stored.
