---
title: Dokumentasjon og integrasjonsguide
seoTitle: ReAI Integrasjonsguide — Over 80 gratis regnskapsintegrasjoner for Norge
description: Komplett oversikt over innebygde koblinger og over 80 gratis integrasjoner for betaling, nettbutikk, kasse, håndverk, kjørebok, klinikk, inkasso, eiendom, CRM, HR og SAF-T-bytte i ReAI.
summary: Alt du trenger for å koble betalingsløsninger, nettbutikker, kasser, kjørebok, klinikker, inkasso, eiendom, CRM, HR og SAF-T til ReAI helt uten tilleggsgebyr.
eyebrow: DOKUMENTASJON OG GUIDER
---

## Innebygde integrasjoner vs. gratis apper på apps.reai.no

I mange norske regnskapssystemer må bedrifter betale flere hundre kroner i måneden per integrasjon—eller kjøpe eksterne integrasjonsbroer. I ReAI er integrasjonene inkludert gratis i to ryddige lag:

| Kategori | Systemer | Slik fungerer det |
| --- | --- | --- |
| **Innebygd i ReAI** | Bankintegrasjon, Altinn (MVA, A-melding, årsoppgjør), EHF/Peppol, eFaktura, Shopify, WooCommerce, Adyen, Bring, PostNord, DHL | Kjører direkte inne i `app.reai.no` med helautomatisk synkronisering. |
| **Bytte & dataflyt** | [SAF-T Norge-bytte](/nb/web-apps/saft/), [CSV-import](/nb/web-apps/import/), [BI-eksport](/nb/web-apps/export/) | Les norsk SAF-T Financial XML fra Tripletex, Fiken, PowerOffice Go, Visma og Conta, last ned IB-saldobalanse og importer kunder/leverandører på ett klikk. |
| **Betaling, inkasso & kasse** | [Vipps](/nb/web-apps/vipps/), [Klarna](/nb/web-apps/klarna/), [Stripe](/nb/web-apps/stripe/), [Zettle](/nb/web-apps/zettle/), [SumUp](/nb/web-apps/sumup/), [Dintero](/nb/web-apps/dintero/), [Nets Easy](/nb/web-apps/nets/), [PayPal](/nb/web-apps/paypal/), [Two B2B](/nb/web-apps/two/), [Paddle / Chargebee](/nb/web-apps/paddle/), [Inkasso (Kredinor/Intrum/Lowell)](/nb/web-apps/inkasso/), [Kravia / Svea](/nb/web-apps/kravia/), [Kasse Z-rapport](/nb/web-apps/z-report/), [Front Systems](/nb/web-apps/front-systems/), [PCKasse](/nb/web-apps/pckasse/), [ExtendaGO](/nb/web-apps/extendago/), [Susoft](/nb/web-apps/susoft/), [Favrit](/nb/web-apps/favrit/), [Quickorder](/nb/web-apps/quickorder/), [Munu](/nb/web-apps/munu/), [Lightspeed](/nb/web-apps/lightspeed/), [VisBook](/nb/web-apps/visbook/), [Mews](/nb/web-apps/mews/), [Wolt & Foodora](/nb/web-apps/wolt-foodora/) | Utbetalingsavstemming, B2B-faktura, SaaS MoR, inkassogebyr og tapsføring, butikkasser, restaurant 25 %/15 % + tips og hotell 12 % PMS. |
| **Nettbutikker, transport & bil** | [Mystore.no](/nb/web-apps/mystore/), [24Nettbutikk](/nb/web-apps/24nettbutikk/), [Magento](/nb/web-apps/magento/), [PrestaShop](/nb/web-apps/prestashop/), [Shopware 6](/nb/web-apps/shopware/), [Wix Stores](/nb/web-apps/wix/), [Squarespace / BigCommerce](/nb/web-apps/squarespace/), [Ongoing WMS](/nb/web-apps/ongoing-wms/), [ABAX Kjørebok](/nb/web-apps/abax/), [Opter TMS](/nb/web-apps/opter/), [AutoNet / Verksted](/nb/web-apps/autonet/), [Logistra Cargonizer](/nb/web-apps/logistra/) | Produkt-/ordresynk, direkte `POST /api/driving-log/trips` kjørebok-bilag, fraktfaktura og verkstedordrer. |
| **Håndverk, bemanning, CRM & HR** | [RecMan](/nb/web-apps/recman/), [SmartDok](/nb/web-apps/smartdok/), [Svenn](/nb/web-apps/svenn/), [Cordel](/nb/web-apps/cordel/), [Holte](/nb/web-apps/holte/), [Handyman](/nb/web-apps/handyman/), [Minuba](/nb/web-apps/minuba/), [HubSpot](/nb/web-apps/hubspot/), [Pipedrive](/nb/web-apps/pipedrive/), [SuperOffice](/nb/web-apps/superoffice/), [Lime CRM](/nb/web-apps/lime/), [Salesforce](/nb/web-apps/salesforce/), [Planday](/nb/web-apps/planday/), [Tamigo](/nb/web-apps/tamigo/), [Quinyx](/nb/web-apps/quinyx/), [Huma HR](/nb/web-apps/huma/), [Simployer](/nb/web-apps/simployer/), [Acubiz / Reiseregning](/nb/web-apps/acubiz/), [Busy](/nb/web-apps/busy/), [Milient](/nb/web-apps/milient/), [Severa](/nb/web-apps/severa/), [Toggl](/nb/web-apps/toggl/), [Clockify](/nb/web-apps/clockify/), [Harvest](/nb/web-apps/harvest/), [Tidsbanken](/nb/web-apps/tidsbanken/) | Arbeidsordrer, bemanning/AGA-lønn, CRM-avtaler, ansatte, reise/utlegg og timelister. |
| **Klinikk, salong, event & eiendom** | [Pleo](/nb/web-apps/pleo/), [Revolut / Wise](/nb/web-apps/revolut/), [Opus Dental](/nb/web-apps/opus-dental/), [Fixit Salong](/nb/web-apps/fixit/), [Hano](/nb/web-apps/hano/), [PasientSky / Pridok](/nb/web-apps/pasientsky/), [Membro / ExorLive](/nb/web-apps/membro/), [EasyPractice](/nb/web-apps/easypractice/), [Booking & klinikk](/nb/web-apps/timma/), [TicketCo](/nb/web-apps/ticketco/), [Checkin](/nb/web-apps/checkin/), [Hoopla / Deltager.no](/nb/web-apps/hoopla/), [Spond & Rubic](/nb/web-apps/spond-rubic/), [Hybel](/nb/web-apps/hybel/), [Fazile](/nb/web-apps/fazile/), [Airbnb / Booking.com](/nb/web-apps/airbnb/), [Husleie.no](/nb/web-apps/husleie/), [Fenistra / Propely](/nb/web-apps/fenistra/) | Firmakort, HELFO/helse MVA-fri og salong 25 %, treningssenter, event/idrettslag samt bolig-, nærings- og korttidsutleie. |
| **Mac og Windows** | [Frakt](/nb/desktop/shipping/), [Produktetiketter](/nb/desktop/product-labels/), [Timeregistrering](/nb/desktop/time-tracker/), [Finder Vault](/nb/desktop/finder-vault/) | Native apper der direkte skriver- og maskinvaretilgang trengs. |

## Sikkerhet og tilgangskontroll

* Passordet ditt til ReAI forlater aldri `app.reai.no`.
* Nettapper kobler til via nettlesergodkjenning og lagrer økten i en AES-256-GCM-kryptert `HttpOnly`-informasjonskapsel på `apps.reai.no`.
* API-nøkler til tredjeparter (Vipps, Nets Easy, Mystore, HubSpot, Pipedrive, Toggl, ABAX osv.) brukes kun for den enkelte forespørselen og lagres aldri i database eller nettleser.
* Tilganger kan tilbakekalles når som helst i brukerprofilen din i ReAI.

## Utvikle din egen integrasjon

ReAI har et komplett, åpent REST-API dokumentert på `https://app.reai.no/openapi/public/ui`. Alle integrasjoner på denne siden har MIT-lisens på GitHub.
