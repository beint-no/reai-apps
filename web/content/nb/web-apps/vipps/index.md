---
title: Integrasjon mellom Vipps og regnskap
seoTitle: Integrasjon mellom Vipps og regnskap — Gratis avstemming for ReAI
description: Avstem Vipps-utbetalinger mot bank i ReAI helt gratis. Komplett guide til hvordan brutto salg, Vipps-gebyrer og netto utbetalinger bokføres riktig.
summary: Match utbetalinger fra Vipps mot banktransaksjoner i ReAI og last ned ferdig avstemmingsrapport i CSV.
industry: payments
icon: icons/vipps.svg
webAppUrl: /app/vipps/
sourcePath: web/worker/apps/reconcile.js
highlights:
  - "Henter planlagte utbetalinger fra Vipps Report API v2 per måned"
  - "Matcher utbetalingene mot uavstemte banktransaksjoner i ReAI (±8 dager)"
  - "0 kr i integrasjonsgebyr — inkludert gratis i ReAI med innebygd testmodus"
---

## Hvordan fungerer Vipps i regnskapet?

Når kunder betaler med Vipps MobilePay, utbetaler Vipps ofte **nettobeløpet** til bedriftskontoen etter fratrekk av gebyrer—eller samler flere dagers salg i én samleutbetaling. For å oppfylle bokføringsloven må du kunne vise hvilke salg og gebyrer som ligger bak hvert innskudd på bankkontoen.

| Postering | Typisk norsk konto | Hva som kontrolleres |
| --- | --- | --- |
| Salgsinntekt (brutto) | `3000` / `3100` (+ MVA `2700`) | Bokføres fra nettbutikk, kasse eller faktura |
| Mellomregning Vipps | `1580` | Fanger tidsforskjell mellom salgsdato og utbetaling |
| Vipps-gebyrer | `7770` (MVA-kode `0`) | Finansiell tjeneste fritatt for MVA |
| Netto innbetaling bank | `1920` | Avstemmes mot planlagt utbetaling fra Vipps |

## Slik avstemmer du Vipps mot ReAI steg for steg

1. Logg inn i **Vipps MobilePay-portalen** og finn salgsenhetens *Client ID*, *Client Secret*, *Ocp-Apim-Subscription-Key* og *MSN*.
2. Klikk **Åpne integrasjon** over, koble til ReAI-selskapet ditt og velg bankkonto og måned.
3. Integrasjonen henter utbetalinger direkte fra Vipps Report API v2 og matcher dem automatisk mot uavstemte banktransaksjoner i ReAI (±8 dager).
4. Last ned avstemmings-CSV-en som vedlegg til månedsavslutningen.

## Ofte stilte spørsmål

### Lagrer apps.reai.no mine Vipps-nøkler?
Nei. Vipps-nøklene brukes kun i den enkelte HTTPS-forespørselen for å hente rapporten og lagres verken i database eller nettleser.

### Koster Vipps-integrasjonen noe ekstra?
Nei. I motsetning til løsninger som krever betalt tilleggsmodul, er Vipps-avstemming helt gratis med ReAI.
