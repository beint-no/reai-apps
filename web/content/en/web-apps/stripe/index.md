---
title: "Stripe & Accounting Integration"
seoTitle: "Stripe Accounting Integration for ReAI — Invoices & Subscriptions"
description: Import paid Stripe invoices and stage recurring subscriptions into ReAI for free. Practical guide to migrating SaaS billing from Stripe to ReAI.
summary: Bring paid zero-VAT Stripe invoices into ReAI idempotently and stage active subscriptions with auto-billing off.
industry: payments
icon: icons/stripe.svg
webAppUrl: /app/stripe/
sourcePath: web/worker/apps/stripe.js
highlights:
  - "Uses a restricted read-only Stripe key (rk_live_ or rk_test_) — never writes to Stripe"
  - "Idempotent historical invoice import with accounting=none to prevent double-booking"
  - "Stages monthly or yearly subscriptions in ReAI with automatic billing disabled until you switch"
---

## Migrating Stripe billing without double-booking

When moving SaaS or recurring billing into ReAI, the biggest risk is duplicating revenue or double-charging an active subscriber. This integration enforces strict safety rails:

* **Historical paid invoices** import with `accounting=none` and Stripe's exact external ID, so re-running an import never creates duplicates and existing Stripe accounting stays intact.
* **Active subscriptions** are staged starting at the next Stripe period boundary with `automaticBillingGeneration: false`, letting you review customer details, VAT codes and payment methods before turning off Stripe billing.
