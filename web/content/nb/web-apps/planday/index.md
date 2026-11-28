---
title: "Integrasjon mellom Planday og regnskap"
seoTitle: "Integrasjon mellom Planday og ReAI: godkjente vakter til timelister"
description: "Hent godkjente vakter fra Planday for én ansatt og før timene i ReAI Timelister. Gratis og åpen kildekode."
summary: "Hent godkjente vakter fra Planday og før timene i ReAI Timelister."
industry: operations
webAppUrl: /app/planday/
sourcePath: web/worker/apps/planday/
highlights:
  - "Leser godkjente vakter fra Planday Open API med App ID og refresh token"
  - "Trekker fra ubetalte manuelle pauser og viser avdelingen for hver vakt"
  - "Fører timene på valgt ansatt og prosjekt i ReAI Timelister"
---

## Dette kommer over i ReAI

Integrasjonen henter vaktene med status godkjent for én ansatt i Planday i valgt periode. Timene regnes fra start til slutt på vakten, minus ubetalte manuelle pauser. Pauser fra pauseregler i Planday kommer ikke med i API-et, så kontroller timene der dere bruker pauseregler. Du ser hver vakt med dato, avdeling og kommentar, og fører den på en ansatt og eventuelt et prosjekt i ReAI med ett klikk.

| Fra Planday | I ReAI |
| --- | --- |
| Godkjent vakt | Timeliste for valgt ansatt og dato |
| Avdeling | Vises i forhåndsvisningen |
| Kommentar på vakten | Kommentar på timelisten, merket med vaktens id |

## Slik kommer du i gang

1. En administrator i Planday går til **Settings → Integrations → API Access** og oppretter en API-applikasjon med tilgangene `shift:read` og `department:read`.
2. Godkjenn applikasjonen i Planday og kopier **App ID** og **refresh token**.
3. Finn ansattnummeret (id) til den ansatte i Planday.
4. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap, ansatt og eventuelt prosjekt.
5. Fyll inn App ID, refresh token, ansattens id og periode, og hent vaktene. Kontroller timene og klikk **Post to ReAI** på hver linje.

En vakt som allerede er ført, blir ikke ført på nytt.

Refresh token brukes bare til denne ene forespørselen og lagres aldri.
