---
title: "Integrasjon mellom PayPal Point of Sale (Zettle) og regnskap"
seoTitle: "Integrasjon mellom PayPal Point of Sale (Zettle) og ReAI: avstemming av utbetalinger"
description: "Avstem utbetalinger fra PayPal Point of Sale, tidligere Zettle, mot uavstemte banktransaksjoner i ReAI og last ned en CSV-rapport. Gratis og åpen kildekode."
summary: "Match utbetalinger fra PayPal Point of Sale (Zettle) mot uavstemte banktransaksjoner i ReAI og last ned CSV-rapport."
industry: payments
webAppUrl: /app/zettle/
sourcePath: web/worker/apps/zettle.js
highlights:
  - "Henter utbetalinger fra Finance API med en API-nøkkel med tilgangen READ:FINANCE"
  - "Matcher utbetalinger mot banktransaksjoner i ReAI innenfor 8 dager"
  - "Lager en CSV-rapport som dokumentasjon til månedsavslutningen"
---

## Avstemming av utbetalinger mot bank

Zettle by PayPal heter nå PayPal Point of Sale. Kortbetalinger fra kassen samles på likviditetskontoen, kortgebyret trekkes fra og nettobeløpet utbetales til bankkontoen eller PayPal-kontoen din. Integrasjonen henter utbetalingene for én måned og matcher dem mot uavstemte banktransaksjoner i ReAI på beløp, dato og referanse. Ingenting bokføres.

## Slik kommer du i gang

1. Logg inn på **my.zettle.com/apps/api-keys** og lag en API-nøkkel med tilgangen **READ:FINANCE**. Kopier nøkkelen og client ID som vises når nøkkelen er laget.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
3. Fyll inn client ID, API-nøkkel og måned, og velg bankkontoen i ReAI.
4. Kontroller treffene og last ned CSV-rapporten.

Nøkkelen brukes bare til denne ene forespørselen og lagres aldri.
