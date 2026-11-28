---
title: Integrasjon mellom Vipps og regnskap
seoTitle: "Integrasjon mellom Vipps og ReAI: avstemming av utbetalinger"
description: Avstem Vipps-utbetalinger mot bank i ReAI helt gratis. Komplett guide til hvordan brutto salg, Vipps-gebyrer og netto utbetalinger bokføres riktig.
summary: Match utbetalinger fra Vipps mot banktransaksjoner i ReAI og last ned ferdig avstemmingsrapport i CSV.
industry: payments
webAppUrl: /app/vipps/
sourcePath: web/worker/apps/vipps.js
highlights:
  - "Henter planlagte utbetalinger fra Vipps Report API for én måned"
  - "Matcher utbetalingene mot uavstemte banktransaksjoner i ReAI (±8 dager)"
  - "Lager en CSV-rapport som dokumentasjon til månedsavslutningen"
---

## Hvordan Vipps fungerer i regnskapet

Vipps MobilePay utbetaler ofte nettobeløpet etter gebyrer, eller samler flere dagers salg i én utbetaling. Integrasjonen henter de planlagte utbetalingene for én måned fra Report API og matcher dem mot uavstemte banktransaksjoner i ReAI på beløp, dato og referanse. Ingenting bokføres.

| Postering | Typisk konto | Hva som kontrolleres |
| --- | --- | --- |
| Salgsinntekt | `3000` eller `3100` | Bokføres fra nettbutikk, kasse eller faktura |
| Mellomregning Vipps | `1580` | Tidsforskjell mellom salg og utbetaling |
| Vipps-gebyrer | `7770` (MVA-kode `0`) | Finansiell tjeneste uten MVA |
| Innbetaling bank | `1920` | Avstemmes mot utbetalingen fra Vipps |

## Slik kommer du i gang

1. Logg inn på **portal.vippsmobilepay.com**, velg **For developers** og miljøet **Production**. Klikk **Show keys** på salgsstedet og kopier *client_id*, *client_secret*, en *Ocp-Apim-Subscription-Key* og MSN.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg bankkonto og måned.
3. Kontroller treffene og last ned CSV-rapporten som vedlegg til månedsavslutningen.

Nøklene brukes bare til denne ene forespørselen og lagres aldri. Report API virker med vanlige nøkler for ePayment og Recurring. Salgssteder med Vipps-nummer kan ikke bruke Report API direkte.
