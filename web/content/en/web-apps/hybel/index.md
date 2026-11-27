---
title: Hybel Journal
seoTitle: Hybel Journal — Web and Mac bridge for ReAI
description: Preview, validate and book a monthly Hybel CSV journal into ReAI as a balanced review voucher directly from your browser or Mac.
summary: Validate a monthly Hybel CSV journal in the browser and post a balanced review voucher to ReAI.
industry: real-estate
status: experimental
icon: icons/hybel.avif
webAppUrl: /app/hybel/
appId: hybel
sourcePath: web/apps/hybel
highlights:
  - "Instant client-side CSV parsing, auto column mapping and balance validation"
  - "Includes a synthetic sample CSV so anyone can test without connecting an account"
  - "Validates company org number, chart of accounts, bank accounts and existing vouchers via the ReAI API"
  - "Flags the resulting voucher for accountant review with a SHA-256 content trail"
---

## How it works

1. Export one calendar month's **Bilagsjournal** CSV from Hybel (or load the built-in synthetic sample).
2. Map the columns once in the browser—non-sensitive header preferences stay in local storage.
3. Connect to ReAI through the same-origin Worker proxy, verify the company organization number, and validate every account and balance group against live ReAI data.
4. Confirm the checklist and create a single balanced review voucher in ReAI, then attach the original Hybel PDF/CSV reports before clearing review.

## Boundaries

Hybel currently documents CSV exports and provider-managed integrations rather than a self-service API. This app operates strictly on a monthly NOK general-ledger export with VAT code `0` and leaves tenant subledgers in Hybel.
