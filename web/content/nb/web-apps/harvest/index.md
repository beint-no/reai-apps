---
title: "Integrasjon mellom Harvest og regnskap"
seoTitle: "Harvest timer til ReAI | Gratis integrasjon"
description: "Hent prosjekttimer fra Harvest API v2 og før dem i ReAI Timelister for fakturering og lønn."
summary: "Hent timeregistreringer fra Harvest API v2 og før dem i ReAI Timelister."
industry: operations
webAppUrl: /app/harvest/
sourcePath: web/worker/apps/harvest/
highlights:
  - "Bruker Harvest API v2 med Personal Access Token og Account ID"
  - "Viser prosjekt, bruker og kommentar fra Harvest"
  - "Hopper over tidtakere som fortsatt går"
---

## Overfør timer fra Harvest til ReAI

Integrasjonen henter avsluttede timeføringer for en måned fra Harvest, med prosjekt, bruker og kommentar. Du velger ansatt og eventuelt prosjekt i ReAI og fører timene én og én. Føringer som allerede er sendt til ReAI, blir gjenkjent og ikke ført på nytt.

## Slik setter du opp Harvest mot ReAI

1. Opprett et **Personal Access Token** på `id.getharvest.com/developers` og kopier tokenet og Account ID.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg ansatt, prosjekt og måned.
3. Legg eventuelt inn bruker-ID fra Harvest for å hente timene til én person. Uten bruker-ID får du alle timer tokenet har tilgang til.
4. Kontroller timene og klikk **Post to ReAI** for hver føring.
