---
title: "Integrasjon mellom Clockify og regnskap"
seoTitle: "Clockify timer til ReAI | Gratis integrasjon"
description: "Hent månedens timer fra Clockify via API og før dem i ReAI Timelister for fakturering og prosjektregnskap."
summary: "Hent timeregistreringer fra Clockify via API og før dem i ReAI Timelister."
industry: operations
webAppUrl: /app/clockify/
sourcePath: web/worker/apps/clockify/
highlights:
  - "Bruker Clockify API v1 med din personlige API-nøkkel"
  - "Støtter arbeidsområder i alle Clockify-regioner"
  - "Viser prosjektnavn fra Clockify og hopper over tidtakere som går"
---

## Overfør timer fra Clockify til ReAI

Integrasjonen henter dine avsluttede timeføringer for en måned i det aktive arbeidsområdet i Clockify, regner om varigheten til timer og viser prosjektnavn og beskrivelse. Du velger ansatt og eventuelt prosjekt i ReAI og fører timene én og én.

## Slik setter du opp Clockify mot ReAI

1. I Clockify åpner du profilmenyen og velger **Preferences → Advanced → Manage API keys**. Klikk **Generate new**, gi nøkkelen et navn og kopier den.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg ansatt, prosjekt og måned.
3. Velg dataregionen til arbeidsområdet. Bruk **Global** hvis du ikke har valgt en egen region i Clockify.
4. Kontroller timene og klikk **Post to ReAI** for hver føring.
