---
title: "Integrasjon mellom SmartDok og regnskap"
seoTitle: "Integrasjon mellom SmartDok og ReAI: attesterte timer til timelister"
description: "Hent attesterte timer fra SmartDok API og før dem i timelistene i ReAI på valgt ansatt og prosjekt. Gratis og åpen kildekode."
summary: "Hent attesterte timer fra SmartDok for en periode og før dem i ReAI Timelister."
industry: operations
webAppUrl: /app/smartdok/
sourcePath: web/worker/apps/smartdok/
highlights:
  - "Leser attesterte timer fra SmartDok API med API-tilgangsnøkkel"
  - "Viser ansatt, prosjekt, underprosjekt og lønnsart før du fører noe"
  - "Fører hver linje som en timeregistrering på valgt ansatt og prosjekt i ReAI"
---

## Dette kommer over i ReAI

Integrasjonen henter attesterte timer fra SmartDok i valgt periode, høyst 93 dager om gangen. Også timer som allerede er sendt til lønn, kommer med. Fravær, tillegg, diett og maskintimer tas ikke med. Du kan begrense til én ansatt med navn eller ansattnummer. Antall timer er nettotimer etter pause når SmartDok oppgir dem.

Du fører linjene enkeltvis til ReAI Timelister på ansatten og prosjektet du velger. En linje som allerede er ført, blir ikke ført på nytt.

## Slik kommer du i gang

1. Logg inn i SmartDok som administrator og åpne **Company settings → API administration**. Lag en API-tilgangsnøkkel. Mangler menyvalget, må API-tilgang bestilles hos SmartDok.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
3. Fyll inn nøkkelen og perioden, og velg ansatt og eventuelt prosjekt i ReAI.
4. Kontroller timene og klikk **Post to ReAI** på linjene du vil føre.

Nøkkelen brukes bare til denne ene forespørselen og lagres aldri.
