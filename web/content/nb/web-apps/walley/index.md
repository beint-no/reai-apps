---
title: "Integrasjon mellom Walley og regnskap"
seoTitle: "Avstemming av Walley oppgjør mot bank i ReAI"
description: "Avstem utbetalinger fra Walley mot banktransaksjoner i ReAI og last ned en CSV for avstemmingen. Gratis og åpen kildekode."
summary: "Hent Walley oppgjør via Reports API og match hver utbetaling mot en uavstemt banktransaksjon i ReAI."
industry: payments
webAppUrl: /app/walley/
sourcePath: web/worker/apps/walley.js
highlights:
  - "Leser Walley oppgjør med en API-nøkkel fra Merchant Hub"
  - "Viser utbetalt beløp, gebyrer og oppgjørsperiode for hver utbetaling"
  - "Matcher utbetalinger mot uavstemte banktransaksjoner i ReAI innenfor 8 dager"
---

## Dette overføres til ReAI

Integrasjonen viser alle Walley oppgjør som ble utbetalt i valgt måned, med utbetalt beløp, gebyrer fra Walley (compensations), butikk og perioden oppgjøret gjelder. Hver utbetaling matches mot uavstemte transaksjoner på bankkontoen du velger i ReAI: samme beløp innenfor 8 dager, og oppgjørsreferansen når den står i bankteksten.

Ingenting bokføres. Du får en avstemmingstabell og en CSV som du kan legge ved eller bruke når du fører Walley utbetalinger og gebyrer i ReAI, vanligvis mellom bankkontoen (`1920`) og mellomkontoen du bruker for Walley.

## Oppsett

1. Logg inn i Walley Merchant Hub, klikk på navnet ditt øverst til høyre og velg **Manage Organization**.
2. Velg **Create new** og deretter **Api key**, fyll ut skjemaet og velg **Create**.
3. Kopier client ID og secret. Secret vises bare én gang.
4. Klikk **Åpne integrasjon**, koble til ReAI, velg bankkonto og måned, og lim inn client ID og secret.

Nøklene brukes bare til denne forespørselen og lagres aldri.
