---
title: Dokumentasjon og integrasjonsguide
seoTitle: ReAI Integrasjonsguide — Slik kobler du fagsystemer til regnskapet
description: Lær hvordan regnskapsintegrasjoner mot ReAI fungerer, hvilke koblinger som er innebygd, hvordan sikkerhet håndteres og hvordan du bygger egne koblinger.
summary: Alt du trenger for å koble betalingsløsninger, CRM, utleiesystemer og BI-verktøy til ReAI uten ekstra gebyrer.
eyebrow: DOKUMENTASJON OG GUIDER
---

## Innebygde integrasjoner vs. gratis apper på apps.reai.no

I mange norske regnskapssystemer må bedrifter betale hundrevis av kroner i måneden per integrasjon—eller betale ekstra til tredjeparts broer. I ReAI er integrasjonene inkludert gratis i to ryddige lag:

| Lag | Systemer | Slik fungerer det |
| --- | --- | --- |
| **Innebygd i ReAI** | Bankintegrasjon, Altinn (MVA, A-melding, årsoppgjør), EHF/Peppol, eFaktura, Shopify, WooCommerce, Adyen, Bring, PostNord, DHL | Kjører direkte inne i `app.reai.no` med helautomatisk synkronisering mot hovedboken. |
| **ReAI Nettapper** | [Vipps](/nb/web-apps/vipps/), [Klarna](/nb/web-apps/klarna/), [Stripe](/nb/web-apps/stripe/), [Zettle](/nb/web-apps/zettle/), [SumUp](/nb/web-apps/sumup/), [Dintero](/nb/web-apps/dintero/), [HubSpot](/nb/web-apps/hubspot/), [Hybel](/nb/web-apps/hybel/), [CSV-import](/nb/web-apps/import/), [BI-eksport](/nb/web-apps/export/) | Nettleserbaserte integrasjoner på `apps.reai.no` uten lokal installasjon. |
| **Skrivebordsapper** | [Frakt](/nb/desktop/shipping/), [Produktetiketter](/nb/desktop/product-labels/), [Timeregistrering](/nb/desktop/time-tracker/), [Finder Vault](/nb/desktop/finder-vault/) | Native Mac- og Windows-apper der direkte maskinvaretilgang (Zebra etikettskriver, mappeovervåking) trengs. |

## Sikkerhet og tilgangskontroll

* Passordet ditt til ReAI forlater aldri `app.reai.no`.
* Nettapper kobler til via nettlesergodkjenning og lagrer tilgangen i en kryptert `HttpOnly`-informasjonskapsel—nøkler lagres aldri i nettleserens `localStorage`.
* API-nøkler til tredjeparter (for eksempel Vipps, Klarna, SumUp, Stripe eller HubSpot) brukes kun for den enkelte kontrolløkten og lagres aldri i database.
* Tilganger kan tilbakekalles når som helst i brukerprofilen din i ReAI.

## Utvikle din egen integrasjon

ReAI har et komplett, åpent REST-API dokumentert på `https://app.reai.no/openapi/public/ui`. Alle integrasjoner på denne siden har MIT-lisens på GitHub slik at utviklere, partnere og regnskapsbyråer kan bygge videre på samme mønster.
