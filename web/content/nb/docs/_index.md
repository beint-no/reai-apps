---
title: Dokumentasjon og integrasjonsguide
seoTitle: ReAI Integrasjonsguide | Gratis regnskapsintegrasjoner for Norge
description: Komplett oversikt over innebygde koblinger (inkl. Kravia inkasso) og gratis integrasjoner for betaling, nettbutikk, kasse, salong, klinikk, boligforvaltning og SAF-T.
summary: Alt du trenger for å koble betalingsløsninger, nettbutikker, kasser, salonger, klinikker, boligforvaltning, HR, CRM og systembytte til ReAI helt uten tilleggsgebyr.
eyebrow: DOKUMENTASJON OG GUIDER
---

## Innebygde integrasjoner vs. gratis apper på apps.reai.no

I mange norske regnskapssystemer må bedrifter betale flere hundre kroner i måneden per integrasjon, eller kjøpe eksterne integrasjonsbroer. I ReAI er integrasjonene inkludert gratis i to ryddige lag:

| Kategori | Systemer | Slik fungerer det |
| --- | --- | --- |
| **Innebygd i ReAI** | Bankintegrasjon, Altinn (MVA, A-melding, årsoppgjør), EHF/Peppol, eFaktura, **Kravia helautomatisk inkasso**, Shopify, WooCommerce, Adyen, Bring, PostNord, DHL | Kjører direkte inne i `app.reai.no` med helautomatisk synkronisering. |
| **Systembytte & dataflyt** | [SAF-T Norge-bytte](/web-apps/saft/), [Bytt fra PowerOffice Go](/web-apps/poweroffice-migrate/), [Finago Office (24SevenOffice)](/web-apps/24sevenoffice-migrate/), [CSV-import](/web-apps/import/), [BI-eksport](/web-apps/export/), [Power BI / Excel](/web-apps/power-bi/) | Direkte API- og SAF-T XML-import rett til `PUT /api/opening-balance`, kunder, leverandører og produkter. |
| **ReAI API-verktøy** | [Aksjeinvesteringer](/web-apps/aksjonaer/), [12-mnd budsjett](/web-apps/budget/), [Make / Zapier / n8n Hub](/web-apps/automations/) | Spesialbygde nettverktøy koblet direkte mot ReAI sitt offentlige REST-API. |
| **Betaling, kasse & hotell** | [Vipps](/web-apps/vipps/), [Klarna](/web-apps/klarna/), [Stripe](/web-apps/stripe/), [PayPal POS (Zettle)](/web-apps/zettle/), [SumUp](/web-apps/sumup/), [Dintero](/web-apps/dintero/), [Nexi Checkout](/web-apps/nets/), [PayPal](/web-apps/paypal/), [Two B2B](/web-apps/two/), [Paddle](/web-apps/paddle/), [Front Systems](/web-apps/front-systems/), [ExtendaGO](/web-apps/extendago/), [Favrit](/web-apps/favrit/), [Duell](/web-apps/duell/), [Baemingo](/web-apps/baemingo/), [Amendo](/web-apps/amendo/), [Caspeco](/web-apps/caspeco/), [Flow Retail](/web-apps/flow-retail/), [Sitoo](/web-apps/sitoo/), [Walley](/web-apps/walley/), [Svea](/web-apps/svea/), [Qliro](/web-apps/qliro/), [Spense](/web-apps/spense/), [Bikedesk (Customers 1st)](/web-apps/bikedesk/), [Mollie](/web-apps/mollie/) | Utbetalingsavstemming, B2B-checkout, SaaS MoR, butikkasser, restaurant 25 %/15 % + tips og hotell 12 % PMS. |
| **Nettbutikker, transport & bil** | [Mystore.no](/web-apps/mystore/), [24Nettbutikk](/web-apps/24nettbutikk/), [Magento](/web-apps/magento/), [PrestaShop](/web-apps/prestashop/), [Shopware 6](/web-apps/shopware/), [Wix Stores](/web-apps/wix/), [Squarespace](/web-apps/squarespace/), [Ongoing WMS](/web-apps/ongoing-wms/), [ABAX Kjørebok](/web-apps/abax/), [Rackbeat](/web-apps/rackbeat/), [Sharefox](/web-apps/sharefox/), [nShift Delivery](/web-apps/nshift/), [Proteria Frakt](/web-apps/proteria/), [Autogear](/web-apps/autogear/), [Mirakl (Elkjøp Marketplace)](/web-apps/mirakl/), [ViaTracks](/web-apps/viatracks/), [Driversnote](/web-apps/driversnote/), [Mapon](/web-apps/mapon/) | Produkt-/ordresynk, direkte `POST /api/driving-log/trips` kjørebok-bilag, fraktfaktura og verkstedordrer. |
| **Håndverk, bemanning, CRM & HR** | [RecMan](/web-apps/recman/), [SmartDok](/web-apps/smartdok/), [HoltePortalen](/web-apps/holte/), [Handyman](/web-apps/handyman/), [HubSpot](/web-apps/hubspot/), [Pipedrive](/web-apps/pipedrive/), [SuperOffice](/web-apps/superoffice/), [Lime CRM](/web-apps/lime/), [Salesforce](/web-apps/salesforce/), [Planday](/web-apps/planday/), [Tamigo](/web-apps/tamigo/), [Quinyx](/web-apps/quinyx/), [Huma HR](/web-apps/huma/), [Finago Busy](/web-apps/busy/), [Severa (Visma)](/web-apps/severa/), [Toggl](/web-apps/toggl/), [Clockify](/web-apps/clockify/), [Harvest](/web-apps/harvest/), [Tidsbanken](/web-apps/tidsbanken/), [Kvalitetskontroll](/web-apps/kvalitetskontroll/), [SpeedyCraft](/web-apps/speedycraft/), [Proresult](/web-apps/proresult/), [Access Fonn](/web-apps/fonn/), [Ordrestyring](/web-apps/ordrestyring/), [Timely](/web-apps/timely/), [Workfeed](/web-apps/workfeed/), [4human](/web-apps/4human/), [Mynt](/web-apps/mynt/), [Teamtailor](/web-apps/teamtailor/), [webCRM](/web-apps/webcrm/), [Upsales](/web-apps/upsales/), [TimeLog](/web-apps/timelog/), [Qondor](/web-apps/qondor/), [Råfisklaget](/web-apps/rafisklaget/) | Arbeidsordrer, bemanning/AGA-lønn, CRM-avtaler, ansatte, reise/utlegg og timelister. |
| **Salong, klinikk, event & boligforvaltning** | [Pleo](/web-apps/pleo/), [Revolut Business](/web-apps/revolut/), [EasyPractice](/web-apps/easypractice/), [TicketCo](/web-apps/ticketco/), [Fazile](/web-apps/fazile/), [Hybel](/web-apps/hybel/), [Husleie.no](/web-apps/husleie/), [Provet Cloud](/web-apps/provet-cloud/), [PsykBase](/web-apps/psykbase/), [Pindena](/web-apps/pindena/), [Billetto](/web-apps/billetto/), [LetsReg](/web-apps/letsreg/), [EduAdmin](/web-apps/eduadmin/), [Muntra](/web-apps/muntra/) | Firmakort, HELFO/helse MVA-fri og salong 25 %, treningssenter, event/idrettslag samt boligforvaltning, nærings- og korttidsutleie. |
| **Mac og Windows** | [Frakt](/desktop/shipping/), [Produktetiketter](/desktop/product-labels/), [Timeregistrering](/desktop/time-tracker/), [Dokumentskanner](/desktop/document-scanner/), [Kvitteringsskriver for ReAI POS](/desktop/pos-print-bridge/) | Native apper der direkte skriver- og maskinvaretilgang trengs. |

## Sikkerhet og tilgangskontroll

* Passordet ditt til ReAI forlater aldri `app.reai.no`.
* Nettapper kobler til via nettlesergodkjenning og lagrer økten i en AES-256-GCM-kryptert `HttpOnly`-informasjonskapsel på `apps.reai.no`.
* API-nøkler til tredjeparter brukes kun for den enkelte forespørselen og lagres aldri i database eller nettleser.
* Tilganger kan tilbakekalles når som helst i brukerprofilen din i ReAI.

## Utvikle din egen integrasjon

ReAI har et komplett, åpent REST-API dokumentert på `https://app.reai.no/openapi/public/ui`. Alle integrasjoner på denne siden har MIT-lisens på GitHub.
