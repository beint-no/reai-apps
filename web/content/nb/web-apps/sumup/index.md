---
title: Integrasjon mellom SumUp og regnskap
seoTitle: Integrasjon mellom SumUp og regnskap — Gratis avstemming for ReAI
description: Koble SumUp-betalingsterminal til ReAI regnskap gratis. Avstem utbetalinger og kortgebyrer mot banktransaksjoner og eksporter CSV.
summary: Sammenlign utbetalinger og kortgebyrer fra SumUp mot uavstemte banktransaksjoner i ReAI.
industry: payments
icon: icons/sumup.svg
webAppUrl: /app/sumup/
sourcePath: web/worker/apps/reconcile.js
highlights:
  - "Henter utbetalinger direkte fra SumUp Payouts API med forhandlerkode og API-nøkkel"
  - "Viser netto utbetaling og trukket SumUp-gebyr sammen med banklinjer i ReAI"
  - "Eksporterer ferdig avstemmings-CSV til månedlig regnskapskontroll"
---

## SumUp i norsk regnskap — enkelt forklart

SumUp er populær blant butikker, frisører, serveringssteder og behandlere. Fordi SumUp trekker kortgebyret før pengene utbetales til bankkontoen, må du skille mellom brutto omsetning, kortgebyr (`7770`, MVA-kode `0`) og netto innskudd på bank (`1920`). Denne gratis integrasjonen henter alle utbetalinger fra SumUp og matcher dem direkte mot banken i ReAI.
