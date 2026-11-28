---
title: "Integrasjon mellom Svea Checkout og regnskap"
seoTitle: "Avstemming av Svea Checkout utbetalinger i ReAI"
description: "Avstem daglige utbetalinger fra Svea Checkout mot banktransaksjoner i ReAI og last ned en CSV for avstemmingen. Gratis og åpen kildekode."
summary: "Hent avstemmingsrapporter fra Svea for hver dag i måneden og match hver utbetaling mot en uavstemt banktransaksjon i ReAI."
industry: payments
webAppUrl: /app/svea/
sourcePath: web/worker/apps/svea/
highlights:
  - "Leser avstemmingsrapporten fra Svea Payment Admin API for hver utbetalingsdato"
  - "Viser utbetalt beløp, gebyrer fra Svea med mva og antall transaksjoner"
  - "Matcher utbetalinger mot uavstemte banktransaksjoner i ReAI innenfor 8 dager"
---

## Dette overføres til ReAI

Svea lager én avstemmingsrapport per utbetalingsdato. Integrasjonen leser rapportene for alle passerte dager i valgt måned og viser beløpet Svea betalte til bankkontoen din (inkludert tilbakeholdt beløp og inngående gjeld), gebyrer fra Svea inkludert mva og antall transaksjoner i utbetalingen. Hver utbetaling matches mot uavstemte transaksjoner på bankkontoen du velger i ReAI: samme beløp innenfor 8 dager.

Ingenting bokføres. Avstemmingstabellen og CSV gir deg grunnlaget for å føre Svea utbetalinger og gebyrer i ReAI, vanligvis mellom bankkontoen (`1920`) og mellomkontoen du bruker for Svea.

## Oppsett

1. Finn merchant ID og secret key som Svea ga deg for avtalen om Svea Checkout. Spør Svea hvis du ikke har dem.
2. Be Svea aktivere avstemmingsrapporter for butikken din hvis de ikke er aktive. Rapporten finnes når Svea er betalingsformidler for deg.
3. Klikk **Åpne integrasjon**, koble til ReAI, velg bankkonto og måned, og skriv inn merchant ID og secret key.

Secret key brukes bare til å signere forespørslene og lagres aldri.
