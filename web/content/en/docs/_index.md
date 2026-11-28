---
title: "Integration & API documentation"
seoTitle: ReAI Integration Docs — Complete Norwegian accounting integrations & open API
description: Complete overview of ReAI's built-in connectors and 29+ free web integrations across payments, ecommerce, POS, CRM, time tracking, corporate cards and real estate.
summary: Everything you need to connect payments, ecommerce stores, POS registers, CRM, time trackers and corporate cards to ReAI at zero add-on cost.
eyebrow: "DOCUMENTATION & GUIDES"
---

## Built-in vs. ReAI Apps integrations

Many Norwegian accounting systems charge monthly add-on fees per connector or require paid middleware for basic integrations. ReAI includes both layers free with your account:

| Category | Systems included | How it runs |
| --- | --- | --- |
| **Built into ReAI** | Norwegian bank sync, Altinn (VAT, A-melding, annual accounts), Peppol/EHF, eFaktura, Shopify, WooCommerce, Adyen, Bring, PostNord, DHL | Native background sync inside `app.reai.no`. |
| **Payments & POS** | [Vipps](/web-apps/vipps/), [Klarna](/web-apps/klarna/), [Stripe](/web-apps/stripe/), [Zettle](/web-apps/zettle/), [SumUp](/web-apps/sumup/), [Dintero](/web-apps/dintero/), [Nets Easy](/web-apps/nets/), [PayPal](/web-apps/paypal/), [POS Z-Report](/web-apps/z-report/), [Front Systems](/web-apps/front-systems/) | Browser web apps on `apps.reai.no` with payout matching & daily Z-report vouchers. |
| **Ecommerce Stores** | [Mystore.no](/web-apps/mystore/), [24Nettbutikk](/web-apps/24nettbutikk/), [Magento](/web-apps/magento/), [PrestaShop](/web-apps/prestashop/), [Shopware 6](/web-apps/shopware/), [Wix Stores](/web-apps/wix/) | Product sync (SKU deduplication) & idempotent paid order sync. |
| **CRM, Time & Cards** | [HubSpot](/web-apps/hubspot/), [Pipedrive](/web-apps/pipedrive/), [RecMan](/web-apps/recman/), [Toggl](/web-apps/toggl/), [Clockify](/web-apps/clockify/), [Harvest](/web-apps/harvest/), [Tidsbanken / SmartDok](/web-apps/tidsbanken/), [Pleo](/web-apps/pleo/), [Revolut / Wise](/web-apps/revolut/), [Booking & Clinic](/web-apps/timma/) | Direct customer, deal, staffing invoice/payroll, timesheet and expense voucher sync. |
| **Real Estate & BI** | [Hybel](/web-apps/hybel/), [Fazile](/web-apps/fazile/), [CSV Import](/web-apps/import/), [BI & Excel Export](/web-apps/export/) | Property journals, lease billing, master-data import and Power BI exports. |
| **Mac & Windows** | [Shipping](/desktop/shipping/), [Product Labels](/desktop/product-labels/), [Time Tracker](/desktop/time-tracker/), [Finder Vault](/desktop/finder-vault/) | Native apps where OS hardware access (Zebra thermal printers, Finder watch) is needed. |

## How authentication and security work

* Your ReAI password never leaves `app.reai.no`.
* Web apps connect via ReAI browser approval (or a scoped user access token) and keep the session inside an AES-256-GCM encrypted `HttpOnly` cookie on `apps.reai.no`.
* External provider credentials (Stripe, Vipps, Nets Easy, Mystore, HubSpot, Pipedrive, Toggl, etc.) are used only for the single on-demand HTTPS request and are never stored in cookies or a database.
* You can revoke any connection immediately from your ReAI profile.

## Build your own integration

ReAI exposes a complete REST API at `https://app.reai.no/openapi/public/ui`. Every integration on this site is MIT-licensed in [github.com/beint-no/reai-apps](https://github.com/beint-no/reai-apps).
