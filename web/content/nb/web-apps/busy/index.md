---
title: "Integrasjon mellom Finago Busy og regnskap"
seoTitle: "Finago Busy timer til ReAI | Gratis integrasjon"
description: "Hent timer fra Finago Busy via API og før dem i ReAI Timelister per ansatt og prosjekt."
summary: "Hent timer fra Finago Busy via API og før dem i ReAI Timelister per ansatt og prosjekt."
industry: operations
webAppUrl: /app/busy/
sourcePath: web/worker/apps/busy/
highlights:
  - "Bruker Finago Busy API v2 med et API-token fra arbeidsområdet"
  - "Henter bare godkjente timer hvis du ønsker det"
  - "Viser prosjekt og bruker fra Busy før timene føres i ReAI"
---

## Overfør timer fra Finago Busy til ReAI

Busy heter nå Finago Busy og leveres av 24SevenOffice. Integrasjonen henter timeføringene for en periode, trekker fra pauser og viser prosjekt, bruker og kommentar fra Busy. Hver føring går til den ansatte i ReAI med samme e-post som brukeren i Busy. Henter du timene til én person, brukes den ansatte du velger. Føringer som allerede er overført til ReAI, hoppes over.

## Slik setter du opp Finago Busy mot ReAI

1. En administrator oppretter et API-token i innstillingene for arbeidsområdet under **Integrasjoner** i Finago Busy. Gi tokenet tilgangene `hourEntries:read`, `users:read` og `projects:read`.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg eventuelt ansatt og prosjekt.
3. Lim inn tokenet, velg periode og eventuelt e-posten til brukeren i Busy for å hente timene til én person.
4. Kontroller timene og klikk **Post to ReAI** for hver føring.
