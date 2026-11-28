---
title: "Integrasjon mellom ABAX og regnskap"
seoTitle: "ABAX kjørebok til ReAI | Gratis integrasjon"
description: "Hent yrkesturer og bompenger fra ABAX Open API og før dem i kjøreboken i ReAI."
summary: "Hent yrkesturer og bompenger fra ABAX Open API og før dem i kjøreboken i ReAI."
industry: operations
webAppUrl: /app/abax/
sourcePath: web/worker/apps/abax.js
highlights:
  - "Henter turer fra ABAX Open API V4 med klient-ID og klienthemmelighet"
  - "Tar bare med yrkesturer, ikke private turer eller pendling"
  - "Bompenger fra ABAX følger med hver tur i kjøreboken"
---

## Overfør yrkesturer fra ABAX til ReAI

Integrasjonen henter yrkesturene for en periode fra ABAX, regner om avstanden til kilometer og legger til bompenger som ABAX har registrert på turen. Du ser alle turene før du fører dem i kjøreboken i ReAI, der kilometergodtgjørelsen beregnes.

## Slik setter du opp ABAX mot ReAI

1. Logg inn i [ABAX Developer Portal](https://developers.abax.cloud) med en administratorbruker og opprett API-legitimasjon for produksjon.
2. Be ABAX support om å aktivere klientlegitimasjon (client credentials) for denne legitimasjonen. Den er ikke aktivert som standard.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg ansatt og eventuelt kjøretøy.
4. Lim inn klient-ID og klienthemmelighet, velg periode (høyst tre måneder) og eventuelt sjåførens e-post i ABAX.
5. Kontroller turene og klikk **Record trip** for hver tur som skal føres.
