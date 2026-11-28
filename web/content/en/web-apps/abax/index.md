---
title: "ABAX & Accounting Integration"
seoTitle: "ABAX Driving Log to ReAI | Free Integration"
description: "Fetch business trips and road tolls from the ABAX Open API and record them in the ReAI driving log."
summary: "Fetch business trips and road tolls from the ABAX Open API and record them in the ReAI driving log."
industry: operations
webAppUrl: /app/abax/
sourcePath: web/worker/apps/abax/
highlights:
  - "Reads trips from the ABAX Open API V4 with a client ID and client secret"
  - "Includes business trips only, not private trips or commutes"
  - "Road tolls recorded by ABAX follow each trip into the driving log"
---

## Move ABAX business trips into ReAI

The integration fetches business trips for a period from ABAX, converts the distance to kilometres and adds the road tolls ABAX recorded for each trip. You review every trip before recording it in the ReAI driving log, where the mileage allowance is calculated.

## Set up ABAX with ReAI

1. Sign in to the [ABAX Developer Portal](https://developers.abax.cloud) as an administrator and create production API credentials.
2. Ask ABAX support to enable the client credentials flow for these credentials. It is off by default.
3. Click **Open integration**, connect ReAI and choose the employee and, if you like, the vehicle.
4. Paste the client ID and client secret, choose a period of at most three months and, optionally, the driver's email in ABAX.
5. Review the trips and click **Record trip** for each trip you want to record.
