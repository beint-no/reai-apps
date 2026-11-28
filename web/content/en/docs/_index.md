---
title: "Integration & API documentation"
seoTitle: ReAI Integration Docs — Built-in connectors, open API and accounting guides
description: Learn how ReAI accounting integrations work, which connectors are built in versus web apps, how authentication stays secure, and how to build your own.
summary: Everything you need to connect external systems to ReAI or build a new integration on the open Public API.
eyebrow: "DOCUMENTATION & GUIDES"
---

## Built-in vs. ReAI Apps integrations

Many Norwegian accounting systems charge monthly add-on fees per connector or force you to pay third-party middleware for basic integrations. ReAI splits integrations into two clean layers—both free:

| Layer | Systems included | How it works |
| --- | --- | --- |
| **Built into ReAI** | Norwegian bank sync, Altinn (VAT, A-melding, annual accounts), Peppol/EHF, eFaktura, Shopify, WooCommerce, Adyen, Bring, PostNord, DHL | Runs natively inside `app.reai.no` with direct ledger transactions and background syncing. |
| **ReAI Web Apps** | [Vipps](/web-apps/vipps/), [Klarna](/web-apps/klarna/), [Stripe](/web-apps/stripe/), [Zettle](/web-apps/zettle/), [SumUp](/web-apps/sumup/), [Dintero](/web-apps/dintero/), [HubSpot](/web-apps/hubspot/), [Hybel](/web-apps/hybel/), [CSV Import](/web-apps/import/), [BI Export](/web-apps/export/) | Open-source web apps on `apps.reai.no` using the public ReAI API—no local installation required. |
| **Native Desktop** | [Shipping](/desktop/shipping/), [Product Labels](/desktop/product-labels/), [Time Tracker](/desktop/time-tracker/), [Finder Vault](/desktop/finder-vault/) | Native Mac and Windows apps when OS hardware access (Zebra thermal printers, Finder folder watch, menu bar) is required. |

## How authentication and security work

* Your ReAI password never leaves `app.reai.no`.
* Web apps connect via ReAI browser approval (or a scoped user access token) and store the session inside an encrypted `HttpOnly` cookie on `apps.reai.no`—tokens are never exposed to `localStorage` or third-party scripts.
* External provider credentials (such as a Stripe restricted read key or Vipps Report API key) are sent strictly for the single on-demand review request and are never saved in cookies or a database.
* You can revoke any app connection immediately from your ReAI profile.

## Build your own integration

ReAI exposes a complete, documented REST API at `https://app.reai.no/openapi/public/ui`. Every integration on this site is MIT-licensed in [github.com/beint-no/reai-apps](https://github.com/beint-no/reai-apps) so developers and AI coding agents can use real production code as a reference.
