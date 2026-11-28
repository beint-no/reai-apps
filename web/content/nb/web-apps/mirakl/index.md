---
title: "Integrasjon mellom Mirakl markedsplasser og regnskap"
seoTitle: "Avstemming av utbetalinger fra Elkjøp Marketplace og andre Mirakl markedsplasser i ReAI"
description: "Avstem utbetalinger fra Mirakl markedsplasser som Elkjøp Marketplace mot banktransaksjoner i ReAI og last ned en CSV for avstemmingen. Gratis og åpen kildekode."
summary: "Hent betalte avregningsperioder fra Mirakl Seller API og match hver utbetaling mot en uavstemt banktransaksjon i ReAI."
industry: ecommerce-logistics
webAppUrl: /app/mirakl/
sourcePath: web/worker/apps/mirakl/
highlights:
  - "Leser utbetalinger fra markedsplassen med selgerens API-nøkkel"
  - "Viser utbetalt beløp, ordresum og provisjon for hver avregningsperiode"
  - "Matcher utbetalinger mot uavstemte banktransaksjoner i ReAI innenfor 8 dager"
---

## Dette overføres til ReAI

Elkjøp Marketplace og flere andre markedsplasser kjører på Mirakl. Integrasjonen viser alle avregningsperioder som markedsplassen har betalt ut i valgt måned, med utbetalt beløp, ordresum inklusive MVA og provisjonen markedsplassen har trukket. Hver utbetaling matches mot uavstemte transaksjoner på bankkontoen du velger i ReAI: samme beløp innenfor 8 dager, og betalingsreferansen når den står i bankteksten.

Ingenting bokføres. Du får en avstemmingstabell og en CSV som du kan legge ved eller bruke når du fører utbetalingen og provisjonen i ReAI, mot fakturaen fra markedsplassen.

## Oppsett

1. Logg inn i selgerportalen til markedsplassen, klikk på brukernavnet ditt øverst til høyre og åpne brukerinnstillingene. Under **API key** lager du en nøkkel og kopierer den. Bruk nøkkelen fra produksjonsmiljøet.
2. Klikk **Åpne integrasjon**, koble til ReAI, velg bankkonto og måned.
3. Fyll inn adressen til markedsplassens Mirakl, for eksempel `https://elkjop-prod.mirakl.net`, og lim inn nøkkelen. Har brukeren flere butikker, fyller du også inn butikkens id.

Nøkkelen brukes bare til denne forespørselen og lagres aldri.
