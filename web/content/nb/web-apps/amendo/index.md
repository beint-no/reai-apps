---
title: "Integrasjon mellom Amendo og regnskap"
seoTitle: "Integrasjon mellom Amendo og ReAI: dagsoppgjør til regnskap"
description: "Bokfør dagsoppgjør fra Amendo som bilag til kontroll i ReAI, fordelt på MVA-satser og betalingsmåter. Gratis og åpen kildekode."
summary: "Hent dagsoppgjørene fra Amendo for én dag og lag ett balansert bilag til kontroll i ReAI."
industry: payments
webAppUrl: /app/amendo/
sourcePath: web/worker/apps/amendo.js
highlights:
  - "Leser dagsoppgjør via ProTouch API v3, som backoffice i Amendo bygger på"
  - "Fordeler salg på MVA-satser, fratrukket returer, og betalinger på betalingstype"
  - "Lager et bilag til kontroll som du godkjenner, med sperre mot dobbel føring"
---

## Dette kommer over i ReAI

Integrasjonen henter dagsoppgjørene som er signert på valgt dag, og summerer omsetning per MVA-sats og per betalingstype.

| Linje | Konto i ReAI |
| --- | --- |
| Kontant | `1900` |
| Kort, Vipps, faktura og andre betalingstyper | `1580` mellomkonto |
| Salg inklusive MVA med 25 %, 15 % og 12 %, fratrukket returer | `3000`, `3010` og `3020` med utgående MVA-kode i ReAI |

ReAI deler hvert salgsbeløp i grunnlag og utgående MVA. Går ikke betalinger og salg i balanse, for eksempel på grunn av gavekort eller avrunding, viser forhåndsvisningen differansen, og bilaget kan ikke opprettes.

## Slik kommer du i gang

1. Be Amendo support om API-tilgang. Amendo gir eksisterende kunder **brukernavn**, **passord** og **API-nøkkel** på forespørsel. Det kan hende integrasjonsmodulen må aktiveres på kontoen din.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
3. Fyll inn de tre opplysningene og datoen for dagsoppgjøret og hent tallene.
4. Kontroller forhåndsvisningen mot dagsoppgjøret under **Rapporter → Dagsoppgjør** i backoffice, kryss av for bekreftelse og opprett bilaget.

Opplysningene brukes bare til denne ene forespørselen og lagres aldri.
