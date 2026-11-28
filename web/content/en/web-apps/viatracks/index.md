---
title: "ViaTracks Driving Log & Accounting"
seoTitle: "ViaTracks Driving Log to ReAI: Business Trips and Road Tolls"
description: "Fetch business trips and road tolls from the ViaTracks API and record them in ReAI Driving Log, matched to employees and vehicles. Free and open source."
summary: "Fetch ViaTracks business trips with road tolls and record them in ReAI Driving Log after review."
industry: operations
webAppUrl: /app/viatracks/
sourcePath: web/worker/apps/viatracks/
highlights:
  - "Reads trips and expenses from the ViaTracks API with a key from Devinco"
  - "Skips private trips and matches driver and car to the ReAI employee and vehicle"
  - "Skips trips that are already in the driving log"
---

## What moves into ReAI

ViaTracks logs trips with GPS in the car. The integration fetches the trips for a period and shows them for review. Private trips, trips still in progress and trips ViaTracks rejected are left out. When part of a trip is marked private taxable, that part is deducted.

Each trip becomes a ReAI driving log trip with date, route, purpose, kilometres and road tolls. For vehicles with mileage allowance ReAI books the allowance at the statutory rate for the trip date. Vehicles that are only documented get the trip in the log without a voucher.

| From ViaTracks | In ReAI |
| --- | --- |
| Date, start and end, purpose, distance | Driving log trip |
| Toll expenses | Road toll amount on the trip |
| User email or name | Employee with the same email or name |
| Registration number | Vehicle with the same registration number |

Parking, ferry and other expenses are shown in the preview but not sent.

## Setup

1. Create or choose a ViaTracks user with access to the cars you want to transfer.
2. Email support@devinco.com and ask for an API key for that user. Devinco sends a **subjectId** and an **API key**. The integration needs **Integration Enabled** for the customer or department, which Devinco charges per unit.
3. Register the cars in ReAI Driving Log with the same registration numbers as in ViaTracks.
4. Click **Open integration**, connect ReAI and choose the company. Enter the subjectId and API key, choose the period and fetch the trips.
5. Review the trips, tick the confirmation and record them. Each click records one batch, and trips already in the log with the same date, route and kilometres are skipped.

The key is used only for these requests and is never stored. Do not also pay the same allowance through ViaTracks or payroll.
