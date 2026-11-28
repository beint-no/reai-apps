---
title: "Integrasjon mellom Mollie og regnskap"
seoTitle: "Avstemming av Mollie oppgjør mot bank i ReAI"
description: "Avstem utbetalinger fra Mollie mot banktransaksjoner i ReAI og last ned en CSV for avstemmingen. Gratis og åpen kildekode."
summary: "Hent Mollie oppgjør via Settlements API og match hver utbetaling mot en uavstemt banktransaksjon i ReAI."
industry: payments
webAppUrl: /app/mollie/
sourcePath: web/worker/apps/mollie/
highlights:
  - "Leser Mollie oppgjør med en avansert tilgangsnøkkel"
  - "Viser utbetalt beløp, betalingsvolum og kostnader for hvert oppgjør"
  - "Matcher utbetalinger mot uavstemte banktransaksjoner i ReAI innenfor 8 dager"
---

## Dette overføres til ReAI

Integrasjonen viser alle Mollie oppgjør som ble utbetalt i valgt måned i selskapets valuta, med utbetalt beløp, betalingsvolum og kostnadene Mollie har trukket. Hver utbetaling matches mot uavstemte transaksjoner på bankkontoen du velger i ReAI: samme beløp innenfor 8 dager, og oppgjørsreferansen når den står i bankteksten.

Ingenting bokføres. Du får en avstemmingstabell og en CSV som du kan legge ved eller bruke når du fører Mollie utbetalinger og kostnader i ReAI, vanligvis mellom bankkontoen (`1920`) og mellomkontoen du bruker for Mollie. Salget selv kommer fra nettbutikken.

## Oppsett

1. Logg inn i Mollie som administrator og gå til **Developers → API keys**.
2. Lag en avansert tilgangsnøkkel (advanced access token) med tilgangen **settlements.read**, og kopier den. Nøkkelen vises bare én gang.
3. Klikk **Åpne integrasjon**, koble til ReAI, velg bankkonto og måned, og lim inn nøkkelen.

Nøkkelen brukes bare til denne forespørselen og lagres aldri.
