---
title: "EduAdmin & Accounting Integration"
seoTitle: "EduAdmin Course Bookings to ReAI | Free Integration"
description: "Fetch EduAdmin course bookings that are not invoiced yet through the API and create ReAI orders with the course rows, prices and VAT from EduAdmin. Free and open source."
summary: "Turn confirmed EduAdmin bookings into ReAI orders, ready to invoice."
industry: operations
webAppUrl: /app/eduadmin/
sourcePath: web/worker/apps/eduadmin/
highlights:
  - "Reads bookings through the EduAdmin API with an API user"
  - "Keeps the course rows, discount and VAT rate from EduAdmin"
  - "Marks the booking as invoiced in EduAdmin once the order exists"
---

## What moves into ReAI

The integration fetches confirmed bookings in the period you choose that are not invoiced yet. Each booking becomes one ReAI order for the EduAdmin customer, with one line per billable order row. You invoice the order from ReAI as usual.

| From EduAdmin | In ReAI |
| --- | --- |
| Booking | Order with a reference to the booking |
| Customer | Existing customer found by organization number or email, otherwise a new customer |
| Order row | Order line excluding VAT, with the VAT code for the rate |

Courses are often exempt from VAT. Rows without VAT get the VAT code you choose before fetching. Bookings whose rows do not match the booking total, for example because of a discount code, are shown but must be fixed in EduAdmin first.

## Set up EduAdmin with ReAI

1. Create an API user in EduAdmin. Ask EduAdmin support if you cannot find the option.
2. Click **Open integration**, connect ReAI and choose the company.
3. Enter the API user name and password, choose the period and the VAT code for rows without VAT, and fetch the bookings.
4. Check the customer, rows and amounts, and click **Stage order in ReAI** for each booking.
5. Invoice the orders in ReAI.

The password is used only to get an access token for these requests and is never stored.
