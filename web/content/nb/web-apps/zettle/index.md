---
title: Integrasjon mellom Zettle og regnskap
seoTitle: Integrasjon mellom Zettle og regnskap — Avstemming av kasseutbetalinger
description: Avstem utbetalinger fra Zettle (PayPal POS) mot bank i ReAI helt gratis. Slik holder du styr på kassesalg, kortgebyrer og bankinnskudd.
summary: Match utbetalinger fra Zettle mot uavstemte banktransaksjoner i ReAI og last ned CSV-rapport.
industry: payments
icon: icons/zettle.svg
webAppUrl: /app/zettle/
sourcePath: web/worker/apps/reconcile.js
highlights:
  - "Henter utbetalinger fra Zettle Finance API v2 med READ:FINANCE-tilgang"
  - "Matcher kasseutbetalinger mot banktransaksjoner i ReAI innenfor 8 dager"
  - "Inkluderer eksempelmodus og sikker CSV-eksport for regnskapet"
---

## Avstemming av Zettle-utbetalinger mot bank

Zettle samler kortbetalinger fra kassen på likviditetskontoen, trekker kortgebyr og utbetaler nettobeløpet til bedriftskontoen. Ved å avstemme Zettle-utbetalingene mot banklinjene i ReAI hver måned sikrer du at dagsoppgjør, kortgebyrer (`7770`) og bankinnskudd (`1920`) alltid stemmer.
