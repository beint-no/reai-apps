---
title: "Integrasjon mellom Tamigo og regnskap"
seoTitle: "Integrasjon mellom Tamigo og ReAI: arbeidede vakter til timelister"
description: "Hent arbeidede vakter fra timearket i Tamigo og før dem i timelistene i ReAI på valgt ansatt og prosjekt. Gratis og åpen kildekode."
summary: "Hent arbeidede vakter fra Tamigo for en periode og før dem i ReAI Timelister."
industry: operations
webAppUrl: /app/tamigo/
sourcePath: web/worker/apps/tamigo/
highlights:
  - "Leser arbeidede timer fra Tamigo API med en applikasjonsnøkkel"
  - "Viser ansatt, avdeling og vakttid før du fører noe"
  - "Fører hver vakt som en timeregistrering på valgt ansatt og prosjekt i ReAI"
---

## Dette kommer over i ReAI

Integrasjonen henter vaktene fra timearket i Tamigo for alle avdelinger i valgt periode, høyst 93 dager om gangen. Vakter uten arbeidede timer tas ikke med. Du kan begrense til én ansatt med navn eller ansatt-ID i Tamigo. Hver linje viser dato, ansatt, avdeling, vakttid og antall timer.

Du fører linjene enkeltvis til ReAI Timelister på ansatten og prosjektet du velger.

## Slik kommer du i gang

1. Logg inn i Tamigo som administrator og åpne **Configuration → Web Services (API)**. Skriv inn et navn på applikasjonen, for eksempel ReAI, og velg **Create Key**.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
3. Fyll inn applikasjonsnavnet, nøkkelen og perioden, og velg ansatt og eventuelt prosjekt i ReAI.
4. Kontroller timene og klikk **Post to ReAI** på linjene du vil føre.

Nøkkelen brukes bare til denne ene forespørselen og lagres aldri.
