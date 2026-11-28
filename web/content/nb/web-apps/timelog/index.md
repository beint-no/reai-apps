---
title: "Integrasjon mellom TimeLog og regnskap"
seoTitle: "TimeLog timer til ReAI | Gratis integrasjon"
description: "Hent timeregistreringene dine fra TimeLog PSA via API og før dem i ReAI Timelister, koblet til riktig ansatt og prosjekt. Gratis og åpen kildekode."
summary: "Hent en måned med timer fra TimeLog og før dem i ReAI Timelister."
industry: operations
webAppUrl: /app/timelog/
sourcePath: web/worker/apps/timelog/
highlights:
  - "Bruker TimeLog REST API med din personlige tilgangsnøkkel"
  - "Finner ansatt i ReAI på e-post og prosjekt på navn"
  - "Hopper over fravær og timer som allerede er ført"
---

## Dette kommer over i ReAI

Integrasjonen henter timeregistreringene dine for en måned fra TimeLog. Hver registrering blir én rad i ReAI Timelister på samme dato, med prosjekt, oppgave og kommentar fra TimeLog. Fravær som ferie og sykdom tas ikke med.

| Fra TimeLog | I ReAI |
| --- | --- |
| Timeregistrering | Timeliste for ansatt og dato |
| Prosjektnavn | Prosjekt med samme navn i ReAI |
| Registrerings-ID | Merke i kommentaren som hindrer dobbel føring |

## Slik kommer du i gang

1. Logg inn i TimeLog og gå til **login.timelog.com/personaltoken**. Klikk **New Token**, gi nøkkelen et navn og en utløpsdato, og kopier den.
2. Finn TimeLog-adressen din under **System Administration → Integrations and API → Transactional API settings**. Den ser ut som `https://app4.timelog.com/firmanavn`.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Lim inn adressen og nøkkelen, velg måned og hent timene.
5. Kontroller ansatt og prosjekt, og klikk **Post to ReAI** for hver rad.

Nøkkelen brukes bare til disse forespørslene og lagres aldri. Hver medarbeider bruker sin egen nøkkel, fordi TimeLog gir tilgang til timene til den som eier nøkkelen.
