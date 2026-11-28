---
title: "Integration & API documentation"
seoTitle: ReAI Integration Docs — 80+ Free Norwegian Accounting Integrations & Open API
description: Complete overview of ReAI's built-in connectors and 80+ free web integrations across payments, ecommerce, POS, trades, driving logs, clinics, inkasso, property, CRM, HR and SAF-T switching.
summary: Everything you need to connect payments, ecommerce stores, POS registers, trades, driving logs, clinics, inkasso, property, CRM, HR and SAF-T migration to ReAI at zero add-on cost.
eyebrow: "DOCUMENTATION & GUIDES"
---

## Built-in vs. ReAI Apps integrations

Many Norwegian accounting systems charge monthly add-on fees per connector or require paid middleware for basic integrations. ReAI includes both layers free with your account:

| Category | Systems included | How it runs |
| --- | --- | --- |
| **Built into ReAI** | Norwegian bank sync, Altinn (VAT, A-melding, annual accounts), Peppol/EHF, eFaktura, Shopify, WooCommerce, Adyen, Bring, PostNord, DHL | Native background sync inside `app.reai.no`. |
| **Migration & Switching** | [SAF-T Norway Switcher](/web-apps/saft/), [CSV Import](/web-apps/import/), [BI & Excel Export](/web-apps/export/) | Parse Norwegian SAF-T Financial XML from Tripletex, Fiken, PowerOffice Go, Visma & Conta, export opening balances, and import customers/suppliers in one click. |
| **Payments, Debt Collection & POS** | [Vipps](/web-apps/vipps/), [Klarna](/web-apps/klarna/), [Stripe](/web-apps/stripe/), [Zettle](/web-apps/zettle/), [SumUp](/web-apps/sumup/), [Dintero](/web-apps/dintero/), [Nets Easy](/web-apps/nets/), [PayPal](/web-apps/paypal/), [Two B2B BNPL](/web-apps/two/), [Paddle / Chargebee](/web-apps/paddle/), [Inkasso (Kredinor/Intrum/Lowell)](/web-apps/inkasso/), [Kravia / Svea](/web-apps/kravia/), [POS Z-Report](/web-apps/z-report/), [Front Systems](/web-apps/front-systems/), [PCKasse](/web-apps/pckasse/), [ExtendaGO](/web-apps/extendago/), [Susoft](/web-apps/susoft/), [Favrit](/web-apps/favrit/), [Quickorder](/web-apps/quickorder/), [Munu](/web-apps/munu/), [Lightspeed](/web-apps/lightspeed/), [VisBook](/web-apps/visbook/), [Mews](/web-apps/mews/), [Wolt & Foodora](/web-apps/wolt-foodora/) | Payout reconciliation, B2B BNPL, SaaS MoR, inkasso fees & write-offs, retail Z-reports, restaurant 25%/15% + tips and hotel 12% PMS vouchers. |
| **Ecommerce, Transport & Fleet** | [Mystore.no](/web-apps/mystore/), [24Nettbutikk](/web-apps/24nettbutikk/), [Magento](/web-apps/magento/), [PrestaShop](/web-apps/prestashop/), [Shopware 6](/web-apps/shopware/), [Wix Stores](/web-apps/wix/), [Squarespace / BigCommerce](/web-apps/squarespace/), [Ongoing WMS](/web-apps/ongoing-wms/), [ABAX Driving Log](/web-apps/abax/), [Opter TMS](/web-apps/opter/), [AutoNet / Workshop](/web-apps/autonet/), [Logistra Cargonizer](/web-apps/logistra/) | Product/order sync, real `POST /api/driving-log/trips` mileage vouchers, TMS freight invoices and workshop job cards. |
| **Trades, Staffing, CRM, HR & Travel** | [RecMan](/web-apps/recman/), [SmartDok](/web-apps/smartdok/), [Svenn](/web-apps/svenn/), [Cordel](/web-apps/cordel/), [Holte](/web-apps/holte/), [Handyman](/web-apps/handyman/), [Minuba](/web-apps/minuba/), [HubSpot](/web-apps/hubspot/), [Pipedrive](/web-apps/pipedrive/), [SuperOffice](/web-apps/superoffice/), [Lime CRM](/web-apps/lime/), [Salesforce](/web-apps/salesforce/), [Planday](/web-apps/planday/), [Tamigo](/web-apps/tamigo/), [Quinyx](/web-apps/quinyx/), [Huma HR](/web-apps/huma/), [Simployer](/web-apps/simployer/), [Acubiz / Expense](/web-apps/acubiz/), [Busy](/web-apps/busy/), [Milient](/web-apps/milient/), [Severa](/web-apps/severa/), [Toggl](/web-apps/toggl/), [Clockify](/web-apps/clockify/), [Harvest](/web-apps/harvest/), [Tidsbanken](/web-apps/tidsbanken/) | Work orders, staffing invoices/payroll AGA, CRM deals, employees, travel/per-diem expenses and timesheets. |
| **Clinics, Salons, Events & Property** | [Pleo](/web-apps/pleo/), [Revolut / Wise](/web-apps/revolut/), [Opus Dental](/web-apps/opus-dental/), [Fixit Salon](/web-apps/fixit/), [Hano](/web-apps/hano/), [PasientSky / Pridok](/web-apps/pasientsky/), [Membro / ExorLive](/web-apps/membro/), [EasyPractice](/web-apps/easypractice/), [Booking & Clinic](/web-apps/timma/), [TicketCo](/web-apps/ticketco/), [Checkin](/web-apps/checkin/), [Hoopla / Deltager.no](/web-apps/hoopla/), [Spond & Rubic](/web-apps/spond-rubic/), [Hybel](/web-apps/hybel/), [Fazile](/web-apps/fazile/), [Airbnb / Booking.com](/web-apps/airbnb/), [Husleie.no](/web-apps/husleie/), [Fenistra / Propely](/web-apps/fenistra/) | Corporate card vouchers, HELFO/health VAT-exempt & salon 25% split, gym memberships, events/clubs and residential/commercial/short-term property journals. |
| **Mac & Windows** | [Shipping](/desktop/shipping/), [Product Labels](/desktop/product-labels/), [Time Tracker](/desktop/time-tracker/), [Finder Vault](/desktop/finder-vault/) | Native apps where OS hardware access (Zebra thermal printers, Finder watch) is needed. |

## How authentication and security work

* Your ReAI password never leaves `app.reai.no`.
* Web apps connect via ReAI browser approval (or a scoped user access token) and keep the session inside an AES-256-GCM encrypted `HttpOnly` cookie on `apps.reai.no`.
* External provider credentials (Stripe, Vipps, Nets Easy, Mystore, HubSpot, Pipedrive, Toggl, ABAX, etc.) are used only for the single on-demand HTTPS request and are never stored in cookies or a database.
* You can revoke any connection immediately from your ReAI profile.

## Build your own integration

ReAI exposes a complete REST API at `https://app.reai.no/openapi/public/ui`. Every integration on this site is MIT-licensed in [github.com/beint-no/reai-apps](https://github.com/beint-no/reai-apps).
