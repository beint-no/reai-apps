---
title: "Integrasjon mellom Tidsbanken og regnskap"
seoTitle: "Integrasjon mellom Tidsbanken og ReAI: godkjente timer til timelister"
description: "Hent godkjente timer fra Tidsbanken API og før dem i timelistene i ReAI på valgt ansatt og prosjekt. Gratis og åpen kildekode."
summary: "Hent godkjente timer fra Tidsbanken for en periode og før dem i ReAI Timelister."
industry: operations
webAppUrl: /app/tidsbanken/
sourcePath: web/worker/apps/tidsbanken/
highlights:
  - "Leser godkjente timelinjer fra Tidsbanken API med abonnementsnøkkel og tb-key"
  - "Viser ansatt, prosjekt og notat før du fører noe"
  - "Fører hver linje som en timeregistrering på valgt ansatt og prosjekt i ReAI"
---

## Dette kommer over i ReAI

Integrasjonen henter godkjente timelinjer fra Tidsbanken med dato i valgt periode, høyst 93 dager om gangen. Du kan begrense til én ansatt med navn. Hver linje viser dato, ansatt, prosjekt, notat og antall timer.

Du fører linjene enkeltvis til ReAI Timelister på ansatten og prosjektet du velger.

## Slik kommer du i gang

1. Opprett en bruker på [developer.tidsbanken.net](https://developer.tidsbanken.net/products), abonner på produktet **Public** og kopier abonnementsnøkkelen.
2. Logg inn i Tidsbanken som administrator, klikk skiftenøkkelen nederst til høyre og gå til **Integrasjon → API-nøkkel → Hent API-nøkkel**. Dette er tb-key. Ser du ikke valget, må API-lisens bestilles hos Tidsbanken.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Fyll inn begge nøklene og perioden, og velg ansatt og eventuelt prosjekt i ReAI.
5. Kontroller timene og klikk **Post to ReAI** på linjene du vil føre.

Nøklene brukes bare til denne ene forespørselen og lagres aldri.
