---
title: Integrasjon mellom Klarna og regnskap
seoTitle: Integrasjon mellom Klarna og regnskap — Gratis oppgjørsavstemming
description: Avstem Klarna-oppgjør mot bank i ReAI helt gratis. Slik bokfører du Klarna-salg, returer, gebyrer og netto utbetalinger riktig i norsk regnskap.
summary: Sammenlign oppgjør fra Klarna med banktransaksjoner i ReAI og eksporter avstemmingsrapport.
industry: payments
webAppUrl: /app/klarna/
sourcePath: web/worker/apps/klarna.js
highlights:
  - "Henter Klarna Settlements v1 med oversikt over salg, gebyrer og returer"
  - "Finner matchende banktransaksjoner i ReAI på utbetalingsreferanse og beløp"
  - "Helt gratis med ReAI — ingen fast månedsavgift per integrasjon"
---

## Slik bokfører du Klarna-oppgjør riktig

Klarna samler gjennomførte kjøp, returer og transaksjonsgebyrer i periodiske oppgjør. Utbetalingen som kommer inn på bankkonto (`1920`) er **netto etter gebyrer og returer**. Derfor bør alt Klarna-salg føres mot en mellomregningskonto (typisk `1580`), slik at saldoen går i null når netto utbetaling og gebyr (`7770`, MVA-kode `0`) er bokført.

## Kom i gang på 2 minutter

1. Opprett en API-nøkkel (`klarna_live_api_…`) med lesetilgang til oppgjør i Klarna Merchant Portal.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg bankkonto og måned.
3. Kontroller alle treff mellom Klarnas utbetalingsreferanser og banklinjene i ReAI, og last ned CSV-rapporten som bilagsdokumentasjon.
