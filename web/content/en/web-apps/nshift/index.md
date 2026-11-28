---
title: "nShift Delivery & Accounting"
seoTitle: "nShift Delivery Freight Rebilling in ReAI"
description: "Fetch stored freight prices from nShift Delivery and stage them per shipment as ReAI draft customer orders for rebilling."
summary: "Read nShift Delivery price history with your own API key and stage freight per shipment as ReAI draft orders."
industry: ecommerce-logistics
webAppUrl: /app/nshift/
sourcePath: web/worker/apps/nshift/
highlights:
  - "Uses the nShift Delivery REST API with your own API key"
  - "Freight price per shipment with carrier, service and parcel count"
  - "Remembers nothing: you keep the fetchId for the next run"
---

## What moves into ReAI

nShift Delivery stores a freight price for each printed shipment, based on your carrier agreement. This app reads those prices and lets you stage each shipment as a draft customer order in ReAI with one line for the freight amount excluding VAT. When your licence includes Shipment History, receiver names are added and matched to ReAI customers by name; otherwise you pick a fallback customer.

Nothing is invoiced or posted automatically. Orders stay drafts until you review them in ReAI, where your normal sales account and VAT code for freight apply. nShift does not return a currency for prices, so orders are staged in the company currency in ReAI. A shipment that is already an order is not staged again.

## How the price feed works

The nShift price history is a feed. Each fetch returns the prices stored after the `fetchId` you send, and a new `fetchId` for next time. Start with `-1`, then save the value the app shows after each fetch. nShift asks integrations to keep new fetches to about one every five minutes. When more prices are waiting than one fetch reads, the app says so and you fetch the rest with the new `fetchId`.

## Setup

1. In nShift Delivery, open **Maintenance → API keys** and click **New API key**. Set the status to enabled and save. Copy the **Id** and **Secret Id**.
2. Check under **Help → Session** that your account has the **REST API price enquiry** licence key. **REST API Shipment History** adds receiver names.
3. Click **Open integration**, connect your ReAI company and enter the Id, Secret Id and the last `fetchId`.
4. Check the freight lines and click **Stage order** on the shipments you want to rebill.
