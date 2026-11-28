---
title: "Integrasjon mellom Toggl Track og regnskap"
seoTitle: "Integrasjon mellom Toggl Track og ReAI: timer til timelister"
description: "Hent førte timer fra Toggl Track API og før dem i timelistene i ReAI på valgt ansatt og prosjekt. Gratis og åpen kildekode."
summary: "Hent månedens timer fra Toggl Track og før dem i ReAI Timelister."
industry: operations
webAppUrl: /app/toggl/
sourcePath: web/worker/apps/toggl.js
highlights:
  - "Henter timer fra Toggl Track API for valgt måned"
  - "Kobler timene til valgt ansatt og prosjekt i ReAI"
  - "Klart for prosjektfakturering og lønn uten dobbeltføring"
---

## Dette kommer over i ReAI

Integrasjonen henter dine egne tidsregistreringer i Toggl Track med start i valgt måned. Registreringer som fortsatt går, tas ikke med. Du fører linjene enkeltvis til ReAI Timelister på ansatten og prosjektet du velger.

## Slik kommer du i gang

1. Åpne **Profile settings** i Toggl Track og kopier **API Token** nederst på siden.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg ansatt, eventuelt prosjekt og måned.
3. Kontroller timene og klikk **Post to ReAI** på linjene du vil føre.

Tokenet brukes bare til denne ene forespørselen og lagres aldri.
