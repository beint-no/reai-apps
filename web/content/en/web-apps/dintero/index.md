---
title: "Dintero Checkout & Fee Booking"
seoTitle: "Dintero and ReAI: settlements and withheld fees"
description: Review Dintero checkout settlements, match net payouts against ReAI bank transactions, and book monthly withheld fees as a review voucher.
summary: Match paid Dintero settlements against ReAI bank feeds and optionally book withheld monthly fees.
industry: payments
webAppUrl: /app/dintero/
sourcePath: web/worker/apps/dintero.js
highlights:
  - "Totals withheld fees across paid Dintero settlements in your company currency"
  - "Matches net settlements against pending ReAI bank transactions and exports CSV"
  - "Creates a review-flagged fee voucher after duplicate and chart-of-accounts verification"
---

## Booking withheld Dintero fees safely

When Dintero deducts transaction fees directly from settlements rather than issuing a separate invoice, your clearing account (`1580`) retains a residual balance equal to the withheld fees. This integration totals the monthly fees, verifies that no duplicate voucher exists for that Dintero account and month, checks your expense (`7770`) and clearing (`1580`) accounts against ReAI, and posts a single balanced voucher flagged for accountant review.

## Setup

1. Sign in to [Dintero Backoffice](https://backoffice.dintero.com), go to **Settings → API clients** and click **Create new API client**.
2. Give the client access to settlement reports and save the client ID and client secret. The secret is shown only once.
3. Click **Open integration**, connect ReAI and enter the account ID (P and eight digits), client ID, client secret and month.
4. Pick the ReAI bank account to match payouts against, and create the fee voucher if needed.
