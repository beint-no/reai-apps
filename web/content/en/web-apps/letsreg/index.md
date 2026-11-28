---
title: "LetsReg & Accounting Integration"
seoTitle: "LetsReg Accounting Integration for ReAI: Settlements"
description: "Book each LetsReg settlement in ReAI as a review voucher, with registrations per VAT rate, fees and the amount paid out. Free and open source."
summary: "Fetch the settlements LetsReg paid out in a month and create one balanced review voucher in ReAI for each."
industry: operations
webAppUrl: /app/letsreg/
sourcePath: web/worker/apps/letsreg/
highlights:
  - "Reads settlements and their orders through the LetsReg integration API"
  - "Posts registrations including VAT with the matching ReAI VAT code, also for events without VAT"
  - "Creates one review voucher per payout, with a duplicate check"
---

## What moves into ReAI

The integration reads the settlements LetsReg paid out in the chosen month, with every order in each settlement. For each settlement you see one voucher with registrations per VAT rate, the LetsReg fee and the amount paid out. The voucher is dated the payout day. Nothing is booked until you check the preview and create the voucher.

| Line | Account in ReAI |
| --- | --- |
| Registrations per VAT rate | `3000` (25 %), `3010` (15 %), `3020` (12 %) or `3100` (no VAT), posted including VAT with the output VAT code |
| LetsReg fee | `7770`, without input VAT |
| Paid out by LetsReg | `1580` |

If the LetsReg invoice shows VAT on the fee, change the VAT code in the voucher. The payout stays on clearing account `1580` until it is matched against the bank. The API returns the latest settlements, so fetch each month soon after it ends.

## Setup

1. Use the login of an organiser administrator. Ask LetsReg support to give that user API access to settlements.
2. Click **Open integration**, connect ReAI and choose the company.
3. Enter the username, password and month. The site id is `1` for letsreg.no; ask LetsReg if the organiser is on another site. If the user has several organisers, enter the organiser id.
4. Check each voucher against the settlement report in LetsReg, tick the confirmation box and create the voucher.

The password is used only for that request and is never stored.
