---
title: "Integrasjon mellom Flow Retail og regnskap"
seoTitle: "Integrasjon mellom Flow Retail og ReAI: daglige posteringer"
description: "Bokfør regnskapsrapporten fra Flow Retail for én dag som bilag til kontroll i ReAI, med kontoene og MVA-kodene du har satt opp i Flow Retail. Gratis og åpen kildekode."
summary: "Hent regnskapsrapporten fra Flow Retail for én dag og lag ett balansert bilag til kontroll i ReAI."
industry: payments
webAppUrl: /app/flow-retail/
sourcePath: web/worker/apps/flow-retail/
highlights:
  - "Leser den daglige regnskapsrapporten fra Flow Retail API v2 med et integrasjonstoken"
  - "Beholder kontoene og MVA-kodene fra regnskapsoppsettet i Flow Retail"
  - "Lager et bilag til kontroll som du godkjenner, med sperre mot dobbel føring"
---

## Dette kommer over i ReAI

Flow Retail samler dagens salg i debet- og kreditposteringer med konto og MVA-kode. Integrasjonen henter rapporten for valgt dag og viser den som ett bilag.

| Linje | Konto i ReAI |
| --- | --- |
| Kontant, terminal, Vipps og andre betalinger | Eiendelskontoene du har satt opp i Flow Retail |
| Salg | Inntektskontoene du har satt opp i Flow Retail |
| Øreavrunding, kontantuttak og kundefordringer | Kontoene Flow Retail oppgir |

Har rapporten ingen egen MVA-linje, føres salget inklusive MVA med MVA-koden fra Flow Retail, og ReAI deler beløpet i grunnlag og utgående MVA. Fører Flow Retail MVA på en egen `27xx`-linje, beholdes posteringene som de er. Bilaget kan bare opprettes når debet og kredit er like.

## Slik kommer du i gang

1. API-tilgang følger med fra Flow Pro. Gå til **Users → New User** i Flow Retail Admin, velg **Account type** **Integration**, gi brukeren rollen for rapporter og lag et integrasjonstoken.
2. Finn tenant-id (klient) i Flow Retail Admin. Har du flere organisasjoner, trenger du også organisasjonens id.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Fyll inn token, tenant-id, eventuelt organisasjons-id og dato og hent tallene.
5. Kontroller forhåndsvisningen mot regnskapsrapporten i Flow Retail, kryss av for bekreftelse og opprett bilaget.

Tokenet brukes bare til denne ene forespørselen og lagres aldri.
