---
title: Dokumentasjon og integrasjonsguide
seoTitle: ReAI Integrasjonsguide — Komplett oversikt over gratis regnskapsintegrasjoner
description: Komplett oversikt over innebygde koblinger og over 29 gratis integrasjoner for betaling, nettbutikk, kasse, CRM, timeregistrering, firmakort og eiendom i ReAI.
summary: Alt du trenger for å koble betalingsløsninger, nettbutikker, kasser, CRM, timeregistrering og firmakort til ReAI helt uten tilleggsgebyr.
eyebrow: DOKUMENTASJON OG GUIDER
---

## Innebygde integrasjoner vs. gratis apper på apps.reai.no

I mange norske regnskapssystemer må bedrifter betale flere hundre kroner i måneden per integrasjon—eller kjøpe eksterne integrasjonsbroer. I ReAI er integrasjonene inkludert gratis i to ryddige lag:

| Kategori | Systemer | Slik fungerer det |
| --- | --- | --- |
| **Innebygd i ReAI** | Bankintegrasjon, Altinn (MVA, A-melding, årsoppgjør), EHF/Peppol, eFaktura, Shopify, WooCommerce, Adyen, Bring, PostNord, DHL | Kjører direkte inne i `app.reai.no` med helautomatisk synkronisering. |
| **Betaling, kasse & hotell** | [Vipps](/nb/web-apps/vipps/), [Klarna](/nb/web-apps/klarna/), [Stripe](/nb/web-apps/stripe/), [Zettle](/nb/web-apps/zettle/), [SumUp](/nb/web-apps/sumup/), [Dintero](/nb/web-apps/dintero/), [Nets Easy](/nb/web-apps/nets/), [PayPal](/nb/web-apps/paypal/), [Kasse Z-rapport](/nb/web-apps/z-report/), [Front Systems](/nb/web-apps/front-systems/), [PCKasse](/nb/web-apps/pckasse/), [ExtendaGO](/nb/web-apps/extendago/), [Susoft](/nb/web-apps/susoft/), [Favrit](/nb/web-apps/favrit/), [Quickorder](/nb/web-apps/quickorder/), [Munu](/nb/web-apps/munu/), [Lightspeed](/nb/web-apps/lightspeed/), [VisBook](/nb/web-apps/visbook/), [Mews](/nb/web-apps/mews/), [Wolt & Foodora](/nb/web-apps/wolt-foodora/) | Utbetalingsavstemming, butikkasser, restaurant 25 %/15 % + tips og hotell 12 % PMS. |
| **Nettbutikker & lager (WMS)** | [Mystore.no](/nb/web-apps/mystore/), [24Nettbutikk](/nb/web-apps/24nettbutikk/), [Magento](/nb/web-apps/magento/), [PrestaShop](/nb/web-apps/prestashop/), [Shopware 6](/nb/web-apps/shopware/), [Wix Stores](/nb/web-apps/wix/), [Ongoing WMS](/nb/web-apps/ongoing-wms/) | Produktsynkronisering (SKU) og idempotent import av betalte ordrer. |
| **Håndverk, bemanning, CRM & HR** | [RecMan](/nb/web-apps/recman/), [SmartDok](/nb/web-apps/smartdok/), [Svenn](/nb/web-apps/svenn/), [Cordel](/nb/web-apps/cordel/), [Holte](/nb/web-apps/holte/), [Handyman](/nb/web-apps/handyman/), [Minuba](/nb/web-apps/minuba/), [HubSpot](/nb/web-apps/hubspot/), [Pipedrive](/nb/web-apps/pipedrive/), [SuperOffice](/nb/web-apps/superoffice/), [Lime CRM](/nb/web-apps/lime/), [Planday](/nb/web-apps/planday/), [Tamigo](/nb/web-apps/tamigo/), [Huma HR](/nb/web-apps/huma/), [Busy](/nb/web-apps/busy/), [Milient](/nb/web-apps/milient/), [Toggl](/nb/web-apps/toggl/), [Clockify](/nb/web-apps/clockify/), [Harvest](/nb/web-apps/harvest/), [Tidsbanken](/nb/web-apps/tidsbanken/) | Arbeidsordrer, bemanning/AGA-lønn, CRM-avtaler, ansatte og timelister. |
| **Kort, klinikk, event & eiendom** | [Pleo](/nb/web-apps/pleo/), [Revolut / Wise](/nb/web-apps/revolut/), [Opus Dental](/nb/web-apps/opus-dental/), [Booking & klinikk](/nb/web-apps/timma/), [TicketCo](/nb/web-apps/ticketco/), [Checkin](/nb/web-apps/checkin/), [Spond & Rubic](/nb/web-apps/spond-rubic/), [Hybel](/nb/web-apps/hybel/), [Fazile](/nb/web-apps/fazile/), [CSV-import](/nb/web-apps/import/), [BI-eksport](/nb/web-apps/export/) | Firmakort, HELFO tannklinikk, event/idrettslag, utleiejournaler og Power BI-eksport. |
| **Mac og Windows** | [Frakt](/nb/desktop/shipping/), [Produktetiketter](/nb/desktop/product-labels/), [Timeregistrering](/nb/desktop/time-tracker/), [Finder Vault](/nb/desktop/finder-vault/) | Native apper der direkte skriver- og maskinvaretilgang trengs. |

## Sikkerhet og tilgangskontroll

* Passordet ditt til ReAI forlater aldri `app.reai.no`.
* Nettapper kobler til via nettlesergodkjenning og lagrer økten i en AES-256-GCM-kryptert `HttpOnly`-informasjonskapsel på `apps.reai.no`.
* API-nøkler til tredjeparter (Vipps, Nets Easy, Mystore, HubSpot, Pipedrive, Toggl osv.) brukes kun for den enkelte forespørselen og lagres aldri i database eller nettleser.
* Tilganger kan tilbakekalles når som helst i brukerprofilen din i ReAI.

## Utvikle din egen integrasjon

ReAI har et komplett, åpent REST-API dokumentert på `https://app.reai.no/openapi/public/ui`. Alle integrasjoner på denne siden har MIT-lisens på GitHub.
