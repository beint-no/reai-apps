---
title: "Integrasjon mellom Severa og regnskap"
seoTitle: "Integrasjon mellom Severa og ReAI: timer til timelister"
description: "Hent timer fra Severa REST API og før dem i timelistene i ReAI på valgt ansatt og prosjekt. Gratis og åpen kildekode."
summary: "Hent timer fra Severa for en periode og før dem i ReAI Timelister."
industry: operations
webAppUrl: /app/severa/
sourcePath: web/worker/apps/severa/
highlights:
  - "Leser timer fra Severa REST API med klient-ID og klienthemmelighet"
  - "Viser dato, bruker, prosjekt og fase før du fører noe"
  - "Fører hver linje som en timeregistrering på valgt ansatt og prosjekt i ReAI"
---

## Dette kommer over i ReAI

Integrasjonen henter timene fra Severa (tidligere Visma Severa) med dato i valgt periode, høyst 93 dager om gangen. Du kan begrense til én Severa-bruker. Hver linje viser dato, bruker, prosjekt med fase, kommentar og antall timer. Du fører linjene enkeltvis til ReAI Timelister på ansatten og prosjektet du velger.

## Slik kommer du i gang

1. Logg inn i Severa som administrator og åpne **Settings → REST API**. Godta vilkårene første gang og velg **Create client credentials**. Gi klienten tilgangen **hours:read**. Ser du ikke menyen, må REST API-tillegget aktiveres for kontoen.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
3. Fyll inn klient-ID, klienthemmelighet og periode, og velg ansatt og eventuelt prosjekt i ReAI.
4. Kontroller timene og klikk **Post to ReAI** på linjene du vil føre.

Klienthemmeligheten brukes bare til denne ene forespørselen og lagres aldri.
