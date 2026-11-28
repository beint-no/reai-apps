---
title: "Handyman & Accounting Integration"
seoTitle: "Handyman Service Orders to ReAI | Free Integration"
description: "Fetch completed service orders with hours and materials from the Handyman API and add them to ReAI as orders and timesheets."
summary: "Fetch completed service orders from the Handyman API and add them to ReAI as orders and timesheets."
industry: operations
webAppUrl: /app/handyman/
sourcePath: web/worker/apps/handyman/
highlights:
  - "Uses the Handyman API on your own Handyman server"
  - "Totals hours, labour and materials for each completed order"
  - "Uses the order's fixed price when one is set"
---

## Move Handyman service orders into ReAI

Handyman from GSGroup has a REST API that runs on the customer's own Handyman server. The integration fetches orders completed in the period, totals hours from salary codes measured in hours, and values the order from the customer price of labour and materials or from the fixed price. You can stage the order in ReAI and log the hours on an employee. Orders and hours already sent to ReAI are recognised and not created twice. If Handyman has many completed orders in the period, choose a shorter period.

## Set up Handyman with ReAI

1. Open **Handyman ControlCenter**, go to the **Integration** tab, enter an API key and a name for the integration and click **Apply**.
2. Install and start the **HandymanAPI** service under **Services** as described by [GSGroup support](https://support.gsgroup.no/hc/en-us/articles/17674524711441).
3. Ask your IT partner to publish the API over https from the internet with your own certificate, see the [remote access guide](https://support.gsgroup.no/hc/en-us/articles/17762953047953).
4. Click **Open integration**, connect ReAI and enter the https address of the API, the API key and the client number from ControlCenter.
5. Review the orders and click **Stage order** or **Log hours**.
