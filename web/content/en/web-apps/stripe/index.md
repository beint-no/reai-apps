---
title: Stripe Import
seoTitle: ReAI Stripe Import — Paid invoices and staged subscriptions
description: Review eligible paid zero-VAT Stripe invoices and stage simple active subscriptions into ReAI directly from your browser.
summary: Import simple historical paid Stripe invoices and stage subscriptions with auto-billing off.
industry: payments
status: example
webAppUrl: /app/stripe/
sourcePath: web/worker/apps/stripe.js
highlights:
  - "Uses a Stripe restricted read key per request without storing provider keys"
  - "Idempotent historical invoice import with accounting=none"
  - "Stages single-item monthly or yearly subscriptions with automatic billing disabled"
icon: icons/stripe.avif
---

## Controlled Stripe handover

Runs server-to-server from the Cloudflare Worker to Stripe and ReAI, preserving every tax, currency and customer-matching safeguard.
