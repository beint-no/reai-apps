---
title: "Integration & API documentation"
seoTitle: ReAI Integration Docs | Free Norwegian Accounting Integrations
description: Complete overview of ReAI's built-in connectors (including Kravia inkasso) and free web integrations across payments, ecommerce, POS, salons, clinics, property, HR & SAF-T.
summary: Everything you need to connect payments, ecommerce stores, POS registers, trades, salons, clinics, property, CRM, HR and system switchers to ReAI at zero add-on cost.
eyebrow: "DOCUMENTATION & GUIDES"
---

## Built-in vs. ReAI Apps integrations

Many Norwegian accounting systems charge monthly add-on fees per connector or require paid middleware for basic integrations. ReAI includes both layers free with your account:

| Category | Systems included | How it runs |
| --- | --- | --- |
| **Built into ReAI** | Norwegian bank sync, Altinn (VAT, A-melding, annual accounts), Peppol/EHF, eFaktura, **Kravia automated debt collection (inkasso)**, Shopify, WooCommerce, Adyen, Bring, PostNord, DHL | Native background sync inside `app.reai.no`. |
| **Migration & Switching** | [SAF-T Norway Switcher](/web-apps/saft/), [PowerOffice Go Switcher](/web-apps/poweroffice-migrate/), [Finago Office (24SevenOffice)](/web-apps/24sevenoffice-migrate/), [CSV Import](/web-apps/import/), [BI & Excel Export](/web-apps/export/), [Power BI / Excel](/web-apps/power-bi/) | Direct API & SAF-T XML migration into `PUT /api/opening-balance`, `/api/customers`, `/api/suppliers` and `/api/products`. |
| **ReAI API Power Tools** | [Aksjonærregister & Shares](/web-apps/aksjonaer/), [12-Month Budget](/web-apps/budget/), [Make / Zapier / n8n Hub](/web-apps/automations/) | Purpose-built browser consoles wired directly to ReAI's public REST API. |
| **Payments, POS & Hospitality** | [Vipps](/web-apps/vipps/), [Klarna](/web-apps/klarna/), [Stripe](/web-apps/stripe/), [PayPal POS (Zettle)](/web-apps/zettle/), [SumUp](/web-apps/sumup/), [Dintero](/web-apps/dintero/), [Nexi Checkout](/web-apps/nets/), [PayPal](/web-apps/paypal/), [Two B2B BNPL](/web-apps/two/), [Paddle / Chargebee](/web-apps/paddle/), [Front Systems](/web-apps/front-systems/), [ExtendaGO](/web-apps/extendago/), [Favrit](/web-apps/favrit/), [Duell](/web-apps/duell/), [Baemingo](/web-apps/baemingo/), [Amendo](/web-apps/amendo/), [Caspeco](/web-apps/caspeco/), [Flow Retail](/web-apps/flow-retail/), [Sitoo](/web-apps/sitoo/), [Walley](/web-apps/walley/), [Svea](/web-apps/svea/), [Qliro](/web-apps/qliro/), [Spense](/web-apps/spense/) | Payout reconciliation, B2B BNPL, SaaS MoR, retail Z-reports, restaurant 25%/15% + tips and hotel 12% PMS vouchers. |
| **Ecommerce, Transport & Fleet** | [Mystore.no](/web-apps/mystore/), [24Nettbutikk](/web-apps/24nettbutikk/), [Magento](/web-apps/magento/), [PrestaShop](/web-apps/prestashop/), [Shopware 6](/web-apps/shopware/), [Wix Stores](/web-apps/wix/), [Squarespace](/web-apps/squarespace/), [Ongoing WMS](/web-apps/ongoing-wms/), [ABAX Driving Log](/web-apps/abax/), [Rackbeat](/web-apps/rackbeat/), [Sharefox](/web-apps/sharefox/), [nShift Delivery](/web-apps/nshift/), [Proteria Frakt](/web-apps/proteria/), [Autogear](/web-apps/autogear/) | Product/order sync, real `POST /api/driving-log/trips` mileage vouchers, TMS freight invoices and workshop job cards. |
| **Trades, Staffing, CRM & HR** | [RecMan](/web-apps/recman/), [SmartDok](/web-apps/smartdok/), [HoltePortalen](/web-apps/holte/), [Handyman](/web-apps/handyman/), [HubSpot](/web-apps/hubspot/), [Pipedrive](/web-apps/pipedrive/), [SuperOffice](/web-apps/superoffice/), [Lime CRM](/web-apps/lime/), [Salesforce](/web-apps/salesforce/), [Planday](/web-apps/planday/), [Tamigo](/web-apps/tamigo/), [Quinyx](/web-apps/quinyx/), [Huma HR](/web-apps/huma/), [Finago Busy](/web-apps/busy/), [Severa (Visma)](/web-apps/severa/), [Toggl](/web-apps/toggl/), [Clockify](/web-apps/clockify/), [Harvest](/web-apps/harvest/), [Tidsbanken](/web-apps/tidsbanken/), [Kvalitetskontroll](/web-apps/kvalitetskontroll/), [SpeedyCraft](/web-apps/speedycraft/), [Proresult](/web-apps/proresult/), [Access Fonn](/web-apps/fonn/), [Ordrestyring](/web-apps/ordrestyring/), [Timely](/web-apps/timely/), [Workfeed](/web-apps/workfeed/), [4human](/web-apps/4human/), [Mynt](/web-apps/mynt/) | Work orders, staffing invoices/payroll AGA, CRM deals, employees, travel/per-diem expenses and timesheets. |
| **Salons, Clinics, Events & Property** | [Pleo](/web-apps/pleo/), [Revolut Business](/web-apps/revolut/), [EasyPractice](/web-apps/easypractice/), [TicketCo](/web-apps/ticketco/), [Fazile](/web-apps/fazile/), [Hybel](/web-apps/hybel/), [Husleie.no](/web-apps/husleie/), [Provet Cloud](/web-apps/provet-cloud/), [PsykBase](/web-apps/psykbase/), [Pindena](/web-apps/pindena/) | Corporate cards, HELFO/health 0% & salon 25% splits, gyms, events/clubs and residential, commercial & housing-association property journals. |
| **Mac & Windows** | [Shipping](/desktop/shipping/), [Product Labels](/desktop/product-labels/), [Time Tracker](/desktop/time-tracker/), [Document Scanner](/desktop/document-scanner/), [POS Print Bridge](/desktop/pos-print-bridge/) | Native apps where OS hardware access (Zebra thermal printers, scanners, folder watching) is needed. |

## How authentication and security work

* Your ReAI password never leaves `app.reai.no`.
* Web apps connect via ReAI browser approval and keep the session inside an AES-256-GCM encrypted `HttpOnly` cookie on `apps.reai.no`.
* External provider credentials are used only for the single on-demand HTTPS request and are never stored in cookies or a database.
* You can revoke any connection immediately from your ReAI profile.

## Build your own integration

ReAI exposes a complete REST API at `https://app.reai.no/openapi/public/ui`. Every integration on this site is MIT-licensed in [github.com/beint-no/reai-apps](https://github.com/beint-no/reai-apps).
