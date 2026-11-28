---
title: "Mirakl Marketplaces & Accounting Integration"
seoTitle: "Payout Reconciliation for Elkjøp Marketplace and other Mirakl Marketplaces in ReAI"
description: "Match payouts from Mirakl marketplaces such as Elkjøp Marketplace against bank transactions in ReAI and download a reconciliation CSV. Free and open source."
summary: "Fetch paid billing cycles from the Mirakl Seller API and match each payout against a pending bank transaction in ReAI."
industry: ecommerce-logistics
webAppUrl: /app/mirakl/
sourcePath: web/worker/apps/mirakl/
highlights:
  - "Reads marketplace payouts with the seller's shop API key"
  - "Shows the payout, order total and commission of each billing cycle"
  - "Matches payouts against pending ReAI bank transactions within 8 days"
---

## What moves into ReAI

Elkjøp Marketplace and several other marketplaces run on Mirakl. The integration lists every billing cycle the marketplace paid out in the chosen month, with the payout, the order total including VAT and the commission the marketplace deducted. Each payout is matched against pending transactions on the bank account you choose in ReAI: same amount within 8 days, and the payout reference when it appears in the bank text.

Nothing is booked. You get a reconciliation table and a CSV to attach or use when you book the payout and the commission in ReAI against the marketplace invoice.

## Setup

1. Sign in to the marketplace's seller back office, click your user name at the top right and open your user settings. Under **API key**, generate a key and copy it. Use the key from the production environment.
2. Click **Open integration**, connect ReAI, choose the bank account and month.
3. Enter the marketplace's Mirakl address, for example `https://elkjop-prod.mirakl.net`, and paste the key. If the user has several shops, also enter the shop id.

The key is used only for that request and is never stored.
