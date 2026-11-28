---
title: "Integrasjon mellom EG HoltePortalen og regnskap"
seoTitle: "EG HoltePortalen timer til ReAI | Gratis integrasjon"
description: "Hent prosjekttimer fra HoltePortalen API og før dem i ReAI Timelister per ansatt og prosjekt."
summary: "Hent prosjekttimer fra HoltePortalen API og før dem i ReAI Timelister."
industry: operations
webAppUrl: /app/holte/
sourcePath: web/worker/apps/holte/
highlights:
  - "Bruker HoltePortalen API med et API-token fra innstillingene"
  - "Viser prosjektnummer, prosjektnavn og bruker fra HoltePortalen"
  - "Tar ikke med fravær og negative føringer"
---

## Overfør timer fra EG HoltePortalen til ReAI

Holte er nå en del av EG, og løsningen heter EG HoltePortalen. Integrasjonen henter timeregistreringer på prosjekter for en periode og viser prosjekt, bruker og kommentar. Du velger ansatt og eventuelt prosjekt i ReAI og fører timene én og én.

## Slik setter du opp HoltePortalen mot ReAI

1. Logg inn i HoltePortalen og åpne **Innstillinger**, fanen **API tokens**.
2. Gi tokenet et navn og en utløpsdato, klikk **Create new token** og kopier verdien. Den vises bare én gang.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg ansatt og eventuelt prosjekt.
4. Lim inn tokenet, velg periode og eventuelt e-posten til brukeren i HoltePortalen for å hente timene til én person.
5. Kontroller timene og klikk **Post to ReAI** for hver føring.
