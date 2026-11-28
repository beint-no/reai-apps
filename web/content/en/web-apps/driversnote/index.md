---
title: "Driversnote Driving Log & Accounting"
seoTitle: "Driversnote Driving Log to ReAI: Business Trips in the Log"
description: "Fetch business trips or submitted reports from the Driversnote API and record them in ReAI Driving Log, matched to employees and vehicles. Free and open source."
summary: "Fetch Driversnote business trips and record them in ReAI Driving Log after review."
industry: operations
webAppUrl: /app/driversnote/
sourcePath: web/worker/apps/driversnote/
highlights:
  - "Reads trips from the Driversnote API with your own API key"
  - "Fetches your own business trips or the reports your team submitted"
  - "Skips trips that are already in the driving log"
---

## What moves into ReAI

The integration fetches business trips from Driversnote for a period and shows them for review. You choose between your own trips and the reports your team members submitted. Private trips, deleted trips, trips outside the report and rejected reports are left out.

Each trip becomes a ReAI driving log trip with date, route, purpose and kilometres. For vehicles with mileage allowance ReAI books the allowance at the statutory rate for the trip date, whatever rate Driversnote used.

| From Driversnote | In ReAI |
| --- | --- |
| Date, start and end, comment, distance | Driving log trip |
| Team member email or name | Employee with the same email or name |
| Car registration number | Vehicle with the same registration number |

Driversnote has no road tolls, so add them in ReAI if needed.

## Setup

1. Log in to Driversnote and open **driversnote.com/app/api-keys**. Create an API key and copy it. The API is part of the paid plan.
2. To fetch team reports, the user who creates the key must be an admin or manager of the team.
3. Register the cars in ReAI Driving Log with the same registration numbers as in Driversnote.
4. Click **Open integration**, connect ReAI and choose the company. Paste the key, choose your own trips or team reports, choose the period and fetch. For your own trips, choose which ReAI employee they belong to.
5. Review the trips, tick the confirmation and record them. Each click records one batch, and trips already in the log with the same date, route and kilometres are skipped.

The key is used only for these requests and is never stored. Do not also pay the allowance from the Driversnote report.
