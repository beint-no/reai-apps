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
| **Betaling og kasse** | [Vipps](/nb/web-apps/vipps/), [Klarna](/nb/web-apps/klarna/), [Stripe](/nb/web-apps/stripe/), [Zettle](/nb/web-apps/zettle/), [SumUp](/nb/web-apps/sumup/), [Dintero](/nb/web-apps/dintero/), [Nets Easy](/nb/web-apps/nets/), [PayPal](/nb/web-apps/paypal/), [Kasse Z-rapport](/nb/web-apps/z-report/), [Front Systems](/nb/web-apps/front-systems/) | Utbetalingsavstemming mot bank og balanserte dagsoppgjørsbilag. |
| **Nettbutikker** | [Mystore.no](/nb/web-apps/mystore/), [24Nettbutikk](/nb/web-apps/24nettbutikk/), [Magento](/nb/web-apps/magento/), [PrestaShop](/nb/web-apps/prestashop/), [Shopware 6](/nb/web-apps/shopware/), [Wix Stores](/nb/web-apps/wix/) | Produktsynkronisering (SKU) og idempotent import av betalte ordrer. |
| **CRM, timer og firmakort** | [HubSpot](/nb/web-apps/hubspot/), [Pipedrive](/nb/web-apps/pipedrive/), [RecMan](/nb/web-apps/recman/), [Toggl](/nb/web-apps/toggl/), [Clockify](/nb/web-apps/clockify/), [Harvest](/nb/web-apps/harvest/), [Tidsbanken / SmartDok](/nb/web-apps/tidsbanken/), [Pleo](/nb/web-apps/pleo/), [Revolut / Wise](/nb/web-apps/revolut/), [Booking & klinikk](/nb/web-apps/timma/) | Kundesynk, bemanning/lønn, ordreutkast, timelister og utleggsbilag rett i ReAI. |
| **Eiendom og BI** | [Hybel](/nb/web-apps/hybel/), [Fazile](/nb/web-apps/fazile/), [CSV-import](/nb/web-apps/import/), [BI-eksport](/nb/web-apps/export/) | Utleiejournaler, leiefakturering, CSV-import og eksport til Excel/Power BI. |
| **Mac og Windows** | [Frakt](/nb/desktop/shipping/), [Produktetiketter](/nb/desktop/product-labels/), [Timeregistrering](/nb/desktop/time-tracker/), [Finder Vault](/nb/desktop/finder-vault/) | Native apper der direkte skriver- og maskinvaretilgang trengs. |

## Sikkerhet og tilgangskontroll

* Passordet ditt til ReAI forlater aldri `app.reai.no`.
* Nettapper kobler til via nettlesergodkjenning og lagrer økten i en AES-256-GCM-kryptert `HttpOnly`-informasjonskapsel på `apps.reai.no`.
* API-nøkler til tredjeparter (Vipps, Nets Easy, Mystore, HubSpot, Pipedrive, Toggl osv.) brukes kun for den enkelte forespørselen og lagres aldri i database eller nettleser.
* Tilganger kan tilbakekalles når som helst i brukerprofilen din i ReAI.

## Utvikle din egen integrasjon

ReAI har et komplett, åpent REST-API dokumentert på `https://app.reai.no/openapi/public/ui`. Alle integrasjoner på denne siden har MIT-lisens på GitHub.
