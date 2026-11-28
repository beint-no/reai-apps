---
title: "Integrasjon mellom Quinyx og regnskap"
seoTitle: "Integrasjon mellom Quinyx og ReAI: vakter til timelister"
description: "Hent vaktene til én ansatt fra Quinyx og før timene i ReAI Timelister. Gratis og åpen kildekode."
summary: "Hent vakter fra Quinyx og før timene i ReAI Timelister."
industry: operations
webAppUrl: /app/quinyx/
sourcePath: web/worker/apps/quinyx/
highlights:
  - "Leser vakter fra Quinyx API med egne integrasjonsnøkler"
  - "Trekker fra pauser og hopper over fridager og vakter som ikke teller som arbeidstid"
  - "Fører timene på valgt ansatt og prosjekt i ReAI Timelister"
---

## Dette kommer over i ReAI

Integrasjonen henter vaktene i vaktplanen til én ansatt i Quinyx i valgt periode. Timene regnes fra start til slutt på vakten, minus pauser. Fridager, slettede vakter og vakter som ikke teller som arbeidstid, tas ikke med. Du ser hver vakt med dato, gruppe og kommentar, og fører den på en ansatt og eventuelt et prosjekt i ReAI med ett klikk. Kommentaren på timelisten får vakt-ID fra Quinyx, slik at en vakt som allerede er ført, ikke føres på nytt.

| Fra Quinyx | I ReAI |
| --- | --- |
| Vakt i vaktplanen | Timeliste for valgt ansatt og dato |
| Gruppe | Vises i forhåndsvisningen |
| Kommentar på vakten | Kommentar på timelisten |

Timene er planlagte vakter. Kontroller dem mot stemplingene i Quinyx før du fører dem.

## Slik kommer du i gang

1. En kontoansvarlig i Quinyx går til **Account settings → Access rights → Integration credentials** og klikker **Generate credentials**.
2. Velg **Version 3**, gi lesetilgang til **Shifts** og lagre. Kopier client ID og client secret med en gang, siden hemmeligheten bare vises én gang.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap, ansatt og eventuelt prosjekt.
4. Fyll inn client ID, client secret, region (`eu` for Norden), ansattnummeret (badge number) og perioden, og hent vaktene.
5. Kontroller timene og klikk **Post to ReAI** på hver linje.

Nøklene brukes bare til denne ene forespørselen og lagres aldri.
