---
title: "Autogear Driving Log & Accounting"
seoTitle: "Autogear Driving Log Integration for ReAI: Business Trips and Road Tolls"
description: "Fetch confirmed business trips and road tolls from the Autogear API and record them in ReAI Driving Log for mileage allowance vouchers. Free and open source."
summary: "Fetch confirmed Autogear trips with road tolls and record them in ReAI Driving Log after review."
industry: operations
webAppUrl: /app/autogear/
sourcePath: web/worker/apps/autogear.js
highlights:
  - "Reads trips from the Autogear REST API with your own Client ID and Client Secret"
  - "Skips private and commute trips and matches drivers to ReAI employees by email"
  - "Records each reviewed trip through POST /api/driving-log/trips"
---

## What moves into ReAI

Autogear logs every trip and toll passage with a GPS unit or app. This integration fetches the trips for a date range, by default only trips the driver has confirmed in Autogear, and shows them for review. Private and commute trips are left out.

Each trip you record becomes a ReAI driving log trip with date, route, purpose, kilometres and road tolls. For vehicles set up for mileage allowance, ReAI books the voucher at the statutory rate for the trip date, and the allowance is paid through salary expense import with A-melding reporting.

| Data | ReAI destination |
| --- | --- |
| Trip date, start and end address, purpose, km | Driving log trip |
| Toll passages (`totalTollStationCost`) | Road toll amount on the trip |
| Driver email | Matched to the ReAI employee with the same email |

## Setup

1. An Autogear account owner or administrator logs in to Autogear and requests API access under **API clients**. Autogear opens access for the account, usually within two working days.
2. The account owner or administrator then creates the API key under **API clients** and accepts the API terms. Note the **Client ID** and **Client Secret**.
3. Create a dedicated integration user in Autogear with access to the vehicles you want to import.
4. Click **Open integration**, connect ReAI, enter the integration user, password, Client ID and Client Secret, choose dates and fetch.
5. Review the trips and click **Record trip** on each one you want in ReAI. Credentials are used only for that request and are never stored.

Do not also send the same trips from Autogear to another payroll or expense system, or the allowance is paid twice.
