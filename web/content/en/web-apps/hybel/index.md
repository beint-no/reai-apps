---
title: Hybel Journal
seoTitle: Hybel Journal — Monthly CSV bridge for ReAI accounting
description: Preview, validate and book a monthly Hybel CSV journal into ReAI as a balanced review voucher directly from your browser.
summary: Validate a monthly Hybel CSV journal in the browser and post a balanced review voucher to ReAI.
industry: real-estate
status: experimental
webAppUrl: /app/hybel/
sourcePath: web/worker/apps/hybel.js
highlights:
  - "CSV parsing, Norwegian/English auto column mapping and per-reference balance checks"
  - "Built-in synthetic sample CSV to test the full flow without an account"
  - "Validates org number, chart of accounts, active NOK bank accounts and existing vouchers via ReAI API"
  - "Creates one balanced review voucher with SHA-256 trail"
icon: icons/hybel.avif
---

## Browser-first workflow

Replaces the earlier Mac-only Hybel prototype so accountants and landlords on any OS can validate a monthly NOK Hybel general-ledger CSV (VAT code `0`) and create a review-flagged ReAI voucher with zero install.
