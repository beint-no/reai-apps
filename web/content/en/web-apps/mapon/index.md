---
title: "Mapon Driving Log & Accounting"
seoTitle: "Mapon and Tracksys Pro to ReAI: Business Trips in the Driving Log"
description: "Fetch business trips from the Mapon API, also used by Tracksys Pro, and record them in ReAI Driving Log matched to employees and vehicles. Free and open source."
summary: "Fetch business trips from Mapon or Tracksys Pro and record them in ReAI Driving Log after review."
industry: operations
webAppUrl: /app/mapon/
sourcePath: web/worker/apps/mapon/
highlights:
  - "Reads business trips from the Mapon API with a key you create yourself"
  - "Matches driver and car to the ReAI employee and vehicle"
  - "Skips trips that are already in the driving log"
---

## What moves into ReAI

The integration fetches the routes marked as business trips in Mapon for a period and shows them for review. Private trips and stops are left out. Tracksys Pro runs on the same platform, so it also works for Tracksys customers.

Each trip becomes a ReAI driving log trip with date, route, explanation and kilometres. For vehicles with mileage allowance ReAI books the allowance at the statutory rate for the trip date.

| From Mapon | In ReAI |
| --- | --- |
| Start time, start and end, distance | Driving log trip |
| Explanation or client on the route | Purpose |
| Driver email or name | Employee with the same email or name |
| Car number | Vehicle with the same registration number |

Mapon has no road tolls, so add them in ReAI if needed.

## Setup

1. Log in to Mapon as an administrator and go to **Settings → API keys → Create API key**. Choose the cars the key can see, save and copy the key. If the menu is missing at Tracksys, contact Tracksys.
2. Register the cars in ReAI Driving Log with the same registration numbers as in Mapon.
3. Click **Open integration**, connect ReAI and choose the company. Paste the key, choose a period of up to two months and fetch the trips.
4. Review the trips, tick the confirmation and record them. Each click records one batch, and trips already in the log with the same date, route and kilometres are skipped.

The key is used only for these requests and is never stored. Do not also pay the same allowance through payroll.
