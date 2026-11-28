---
title: "Sharefox & Accounting Integration"
seoTitle: "Sharefox Rental Sales to ReAI Review Vouchers"
description: "Summarise booked Sharefox rental orders by VAT rate and create one balanced review voucher in ReAI. Free and open source."
summary: "Fetch Sharefox orders for a period and book the rental sales as a ReAI review voucher against your payment clearing account."
industry: ecommerce-logistics
webAppUrl: /app/sharefox/
sourcePath: web/worker/apps/sharefox/
highlights:
  - "Reads Sharefox orders through the Sharefox API with an admin login"
  - "Counts only Booked and Closed orders, including change orders"
  - "Creates one balanced review voucher with 25, 15 and 12 percent output VAT"
---

## What moves into ReAI

The integration fetches the Sharefox orders in the period you choose and keeps the orders with status **Booked** or **Closed**, which Sharefox counts as contracted bookings. Change orders are included, so extensions, changes and cancellations net out against the original booking.

The orders are summed per VAT rate into one review voucher in ReAI dated the last day of the period:

* Debit the payment clearing account (`1580` by default) with the amount including VAT, to match against Nets, Stripe or other payouts.
* Credit the rental revenue account (`3000` by default) with the output VAT code for 25, 15 or 12 percent, so ReAI separates the VAT.

Orders paid by invoice (**Faktura**) are left out, because they are invoiced in your accounting system. Orders without VAT or with mixed VAT rates are listed for manual booking. The voucher is flagged for review, and the same period is never booked twice.

## Setup

1. Ask Sharefox Support to confirm that API use is part of your subscription.
2. Use a Sharefox admin user and note the admin domain you log in to, for example `yourshop.admin.mysharefox.com`.
3. Click **Open integration**, connect your ReAI company, enter admin domain, email, password and period, and click **Fetch Sharefox orders**.
4. Check the totals against the Sharefox report, adjust the accounts if needed and create the review voucher.

The password is used only to request a token for this fetch and is never stored.
