---
title: "Stripe & Accounting Integration"
seoTitle: "Stripe Accounting Integration for ReAI: Invoices and Subscriptions"
description: Import paid Stripe invoices and stage recurring subscriptions into ReAI for free. Practical guide to migrating SaaS billing from Stripe to ReAI.
summary: Bring paid zero-VAT Stripe invoices into ReAI idempotently and stage active subscriptions with auto-billing off.
industry: payments
webAppUrl: /app/stripe/
sourcePath: web/worker/apps/stripe/
highlights:
  - "Uses a restricted Stripe key with read access only (rk_live_ or rk_test_)"
  - "Idempotent historical invoice import with accounting=none to prevent double-booking"
  - "Stages monthly or yearly subscriptions in ReAI with automatic billing disabled until you switch"
---

## What moves into ReAI

The integration is built for moving billing from Stripe to ReAI.

* **Paid invoices** without VAT import as historical invoices with `accounting=none`, linked to the ReAI customer with the same email. Revenue and VAT are not booked again, and the same invoice cannot be imported twice.
* **Active subscriptions** with one fixed monthly or yearly price are staged in ReAI from the next Stripe period, with automatic billing turned off. You check customer, price and VAT before you turn on billing in ReAI and stop it in Stripe.

Invoices and subscriptions with discounts, VAT, several lines or a currency other than the company currency show the reason and need manual handling.

## Setup

1. In the Stripe Dashboard, open **Developers → API keys** and click **Create restricted key**. Grant read access to Customers, Invoices and Subscriptions, and copy the key starting with `rk_live_`.
2. Create a product without VAT in ReAI that the invoice lines can use.
3. Click **Open integration**, connect ReAI and choose the company.
4. Paste the key, choose the product and review the list. Import invoices and stage subscriptions one at a time.

The key is used only for these requests and is never stored.
