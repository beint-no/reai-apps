---
title: "Integrasjon mellom Front Systems og regnskap"
seoTitle: "Integrasjon mellom Front Systems og ReAI: kasseoppgjør til regnskap"
description: "Bokfør kasseoppgjørene fra Front Systems som bilag til kontroll i ReAI, fordelt på betalingstype og MVA-sats. Gratis og åpen kildekode."
summary: "Hent kasseoppgjørene fra Front Systems for én dag og lag ett balansert bilag til kontroll i ReAI."
industry: payments
webAppUrl: /app/front-systems/
sourcePath: web/worker/apps/front-systems/
highlights:
  - "Leser kasseoppgjør fra Front Systems REST API med abonnementsnøkkel og API-nøkkel"
  - "Fører salg per MVA-sats med utgående MVA-kode i ReAI"
  - "Lager et bilag til kontroll som du godkjenner, med sperre mot dobbel føring"
---

## Dette kommer over i ReAI

Integrasjonen henter alle kasseoppgjør med valgt dato fra Front Systems, for alle butikker eller for én butikk. Du ser ett bilag med betalinger på debetsiden og salg per MVA-sats på kreditsiden. Ingenting bokføres før du har kontrollert forhåndsvisningen og opprettet bilaget.

| Linje | Konto i ReAI |
| --- | --- |
| Betalingstyper | Kontoen som er satt på betalingstypen i Front Systems, ellers `1900` for kontant og `1580` for kort og Vipps |
| Salg per MVA-sats | Kontoen fra Z-rapporten, ellers `3000`, `3010`, `3020` eller `3100`, ført inklusive MVA med utgående MVA-kode |

ReAI deler hvert salgsbeløp i grunnlag og utgående MVA. Går ikke betalinger og salg opp, kan bilaget ikke opprettes.

## Slik kommer du i gang

1. Registrer deg på **developer.frontsystems.com**, velg et abonnement og kopier **abonnementsnøkkelen** fra profilen din.
2. Logg inn i Front Systems Portal som administrator, gå til **Admin → Integration users**, klikk **Create new**, velg **Company** som omfang og kopier **API-nøkkelen**.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Fyll inn begge nøklene og datoen. La butikk stå tom for å ta med alle butikker.
5. Kontroller forhåndsvisningen mot Z-rapporten, kryss av for bekreftelse og opprett bilaget.

Nøklene brukes bare til denne ene forespørselen og lagres aldri.
