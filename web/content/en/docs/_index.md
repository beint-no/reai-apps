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
| **Payments, POS & Hospitality** | [Vipps](/web-apps/vipps/), [Klarna](/web-apps/klarna/), [Stripe](/web-apps/stripe/), [Zettle](/web-apps/zettle/), [SumUp](/web-apps/sumup/), [Dintero](/web-apps/dintero/), [Nets Easy](/web-apps/nets/), [PayPal](/web-apps/paypal/), [POS Z-Report](/web-apps/z-report/), [Front Systems](/web-apps/front-systems/), [PCKasse](/web-apps/pckasse/), [ExtendaGO](/web-apps/extendago/), [Susoft](/web-apps/susoft/), [Favrit](/web-apps/favrit/), [Quickorder](/web-apps/quickorder/), [Munu](/web-apps/munu/), [Lightspeed](/web-apps/lightspeed/), [VisBook](/web-apps/visbook/), [Mews](/web-apps/mews/), [Wolt & Foodora](/web-apps/wolt-foodora/) | Payout reconciliation, retail Z-reports, restaurant 25%/15% + tips and hotel 12% PMS vouchers. |
| **Ecommerce & 3PL WMS** | [Mystore.no](/web-apps/mystore/), [24Nettbutikk](/web-apps/24nettbutikk/), [Magento](/web-apps/magento/), [PrestaShop](/web-apps/prestashop/), [Shopware 6](/web-apps/shopware/), [Wix Stores](/web-apps/wix/), [Ongoing WMS](/web-apps/ongoing-wms/) | Product sync (SKU deduplication) & idempotent paid order sync. |
| **Trades, Staffing, CRM & HR** | [RecMan](/web-apps/recman/), [SmartDok](/web-apps/smartdok/), [Svenn](/web-apps/svenn/), [Cordel](/web-apps/cordel/), [Holte](/web-apps/holte/), [Handyman](/web-apps/handyman/), [Minuba](/web-apps/minuba/), [HubSpot](/web-apps/hubspot/), [Pipedrive](/web-apps/pipedrive/), [SuperOffice](/web-apps/superoffice/), [Lime CRM](/web-apps/lime/), [Planday](/web-apps/planday/), [Tamigo](/web-apps/tamigo/), [Huma HR](/web-apps/huma/), [Busy](/web-apps/busy/), [Milient](/web-apps/milient/), [Toggl](/web-apps/toggl/), [Clockify](/web-apps/clockify/), [Harvest](/web-apps/harvest/), [Tidsbanken](/web-apps/tidsbanken/) | Work orders, staffing invoices/payroll AGA, CRM deals, employees and timesheets. |
| **Cards, Clinics, Events & Property** | [Pleo](/web-apps/pleo/), [Revolut / Wise](/web-apps/revolut/), [Opus Dental](/web-apps/opus-dental/), [Booking & Clinic](/web-apps/timma/), [TicketCo](/web-apps/ticketco/), [Checkin](/web-apps/checkin/), [Spond & Rubic](/web-apps/spond-rubic/), [Hybel](/web-apps/hybel/), [Fazile](/web-apps/fazile/), [CSV Import](/web-apps/import/), [BI & Excel Export](/web-apps/export/) | Corporate card vouchers, HELFO dental, events/clubs, property journals and Power BI exports. |
| **Mac & Windows** | [Shipping](/desktop/shipping/), [Product Labels](/desktop/product-labels/), [Time Tracker](/desktop/time-tracker/), [Finder Vault](/desktop/finder-vault/) | Native apps where OS hardware access (Zebra thermal printers, Finder watch) is needed. |

## How authentication and security work

* Your ReAI password never leaves `app.reai.no`.
* Web apps connect via ReAI browser approval (or a scoped user access token) and keep the session inside an AES-256-GCM encrypted `HttpOnly` cookie on `apps.reai.no`.
* External provider credentials (Stripe, Vipps, Nets Easy, Mystore, HubSpot, Pipedrive, Toggl, etc.) are used only for the single on-demand HTTPS request and are never stored in cookies or a database.
* You can revoke any connection immediately from your ReAI profile.

## Build your own integration

ReAI exposes a complete REST API at `https://app.reai.no/openapi/public/ui`. Every integration on this site is MIT-licensed in [github.com/beint-no/reai-apps](https://github.com/beint-no/reai-apps).
