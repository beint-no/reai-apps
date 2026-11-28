---
title: "Pindena course registrations and accounting"
seoTitle: "Pindena to ReAI | Free open source integration for courses and events"
description: "Fetch the participants of a Pindena activity and create a balanced review voucher in ReAI for registrations prepaid by card or Vipps."
summary: "Book prepaid Pindena registrations for an activity as a ReAI review voucher with the VAT treatment you choose."
industry: operations
webAppUrl: /app/pindena/
sourcePath: web/worker/apps/pindena/
highlights:
  - "Reads the activity and its participants from the Pindena API"
  - "Books prepaid registrations against 1580 for matching with the payout"
  - "Creates a review voucher you approve in ReAI; credentials are never stored"
---

## What moves into ReAI

The app reads one activity and its registered and confirmed participants. Participants marked **Paid** in Pindena (paid by card or Vipps at registration) are summed from their total price and booked as one review voucher:

| Pindena | ReAI account | VAT code |
| --- | --- | --- |
| Prepaid registrations | `1580` | 0 |
| Course fees outside the VAT act | `3200` | 6 |
| Registrations with 25% VAT, incl. VAT | `3000` | 3 |
| Registrations with 15% VAT, incl. VAT | `3010` | 31 |
| Registrations with 12% VAT, incl. VAT | `3020` | 33 |

You choose the VAT treatment for the activity. Invoiced, due and unpaid registrations are shown but not booked, so you can invoice those participants from ReAI. Credited registrations are left out. Match `1580` against the payout from your payment provider. The voucher is flagged for review and the same activity cannot be booked twice.

## Setup

1. Ask Pindena for API access. Pindena issues the API **username** and **password** for Basic Auth and charges a fee for API use.
2. Note your Pindena address, for example `https://yourorg.pameldingssystem.no`, and the activity ID from the activity list.
3. Open the app, click **Connect to ReAI** and choose the company.
4. Enter the address, username, password, activity ID, voucher date and VAT treatment, click **Fetch from Pindena API**, check the preview and create the review voucher.

Check the voucher against the payment report in Pindena (**Rapporter → Betaling**) and attach it in ReAI.
