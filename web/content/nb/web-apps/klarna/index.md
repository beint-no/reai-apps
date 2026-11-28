---
title: Integrasjon mellom Klarna og regnskap
seoTitle: "Integrasjon mellom Klarna og ReAI: avstemming av utbetalinger"
description: Sammenlign utbetalinger fra Klarna med banktransaksjoner i ReAI og last ned en avstemmingsrapport. Gratis og åpen kildekode.
summary: Sammenlign utbetalinger fra Klarna Settlements API med banktransaksjoner i ReAI og eksporter avstemmingsrapport.
industry: payments
webAppUrl: /app/klarna/
sourcePath: web/worker/apps/klarna/
highlights:
  - "Henter utbetalinger fra Klarna Settlements API med salg, gebyrer og returer"
  - "Finner banktransaksjoner i ReAI på utbetalingsreferanse og beløp"
  - "Lager en CSV-rapport du kan legge ved som dokumentasjon"
---

## Slik bokfører du Klarna-oppgjør

Klarna samler kjøp, returer og gebyrer i periodiske oppgjør. Beløpet som kommer inn på bankkontoen er netto etter gebyrer og returer, og har Klarnas utbetalingsreferanse (`payment_reference`). Før salget mot en mellomregningskonto, typisk `1580`, slik at saldoen går i null når netto utbetaling og gebyr (`7770`, MVA-kode `0`) er bokført.

## Slik kommer du i gang

1. Hent en API-nøkkel (`klarna_live_api_…`) i Klarna Partner Portal, eller be Klarnas kundestøtte for forhandlere om en.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg bankkonto og måned.
3. Kontroller treffene mellom utbetalingene fra Klarna og banklinjene i ReAI, og last ned CSV-rapporten som dokumentasjon.

Integrasjonen bruker Klarnas europeiske API (`api.klarna.com`). Nøkkelen brukes bare til denne ene forespørselen og lagres aldri.
