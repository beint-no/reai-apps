---
title: "Integrasjon mellom Driversnote kjørebok og regnskap"
seoTitle: "Driversnote kjørebok til ReAI: yrkesturer i kjøreboken"
description: "Hent yrkesturer eller innsendte rapporter fra Driversnote API og registrer dem i ReAI Kjørebok, koblet til ansatt og kjøretøy. Gratis og åpen kildekode."
summary: "Hent yrkesturer fra Driversnote og registrer dem i ReAI Kjørebok etter kontroll."
industry: operations
webAppUrl: /app/driversnote/
sourcePath: web/worker/apps/driversnote/
highlights:
  - "Leser turer fra Driversnote API med din egen API-nøkkel"
  - "Henter dine egne yrkesturer eller rapportene teamet har sendt inn"
  - "Hopper over turer som allerede ligger i kjøreboken"
---

## Dette overføres til ReAI

Integrasjonen henter yrkesturer fra Driversnote for en periode og viser dem for kontroll. Du velger mellom dine egne turer og rapportene som medlemmene i teamet ditt har sendt inn. Private turer, slettede turer og turer utenfor rapporten tas ikke med, og det samme gjelder avviste rapporter.

Hver tur blir en tur i ReAI Kjørebok med dato, strekning, formål og kilometer. For kjøretøy med kjøregodtgjørelse bokfører ReAI godtgjørelsen med statens sats for turdatoen, uavhengig av satsen i Driversnote.

| Fra Driversnote | I ReAI |
| --- | --- |
| Dato, start og slutt, kommentar, distanse | Tur i kjøreboken |
| Teammedlemmets e-post eller navn | Ansatt med samme e-post eller navn |
| Bilens registreringsnummer | Kjøretøy med samme registreringsnummer |

Driversnote har ikke bompenger, så legg dem inn i ReAI ved behov.

## Slik kommer du i gang

1. Logg inn i Driversnote og åpne **driversnote.com/app/api-keys**. Lag en API-nøkkel og kopier den. API er med i betalt abonnement.
2. Skal du hente teamets rapporter, må brukeren som lager nøkkelen være administrator eller leder i teamet.
3. Registrer bilene i ReAI Kjørebok med samme registreringsnummer som i Driversnote.
4. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap. Lim inn nøkkelen, velg egne turer eller teamets rapporter, velg periode og hent turene. For egne turer velger du hvilken ansatt i ReAI turene gjelder.
5. Kontroller turene, kryss av for bekreftelse og registrer dem. Hvert klikk registrerer en porsjon, og turer med samme dato, strekning og kilometer som allerede ligger i kjøreboken, hoppes over.

Nøkkelen brukes bare til disse forespørslene og lagres aldri. Ikke betal ut godtgjørelsen fra rapporten i Driversnote i tillegg.
