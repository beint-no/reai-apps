---
title: "Integrasjon mellom Two og regnskap"
seoTitle: "Integrasjon mellom Two og ReAI: utbetalinger til regnskap"
description: "Hent oppgjørsrapporten fra Two og bokfør hver utbetaling som bilag til kontroll i ReAI, med fakturabeløp, gebyr og netto utbetaling. Gratis og åpen kildekode."
summary: "Hent oppgjørsrapporten fra Two for en periode og lag ett balansert bilag til kontroll i ReAI per utbetaling."
industry: payments
webAppUrl: /app/two/
sourcePath: web/worker/apps/two/
highlights:
  - "Leser oppgjørsrapporten fra Two API med din egen API-nøkkel"
  - "Ett bilag per utbetaling, gruppert på betalingsreferansen fra Two"
  - "Lager et bilag til kontroll med sperre mot dobbel føring"
---

## Dette kommer over i ReAI

Integrasjonen henter oppgjørsrapporten fra Two for perioden du velger og samler linjene per betalingsreferanse. Bare linjer som Two har betalt ut tas med. For hver utbetaling ser du ett bilag:

| Linje | Konto i ReAI |
| --- | --- |
| Netto utbetaling | `1580`, eller kontoen du velger, til den avstemmes mot banken |
| Gebyr til Two | `7770`, med inngående MVA hvis rapporten oppgir MVA på gebyret |
| Fakturaer Two har betalt ut, brutto | `1579`, eller kontoen der du fører fordringen på Two |

Kreditnotaer i rapporten trekkes fra i samme utbetaling. Bare oppgjør i NOK tas med.

## Slik kommer du i gang

1. Logg inn i Two Merchant Portal, gå til **Settings → Integration**, velg fanen **Production** og klikk **Create key**. Bare administratorer kan lage nøkler for produksjon.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
3. Lim inn API-nøkkelen, velg periode og kontroller kontoene.
4. Kontroller hver utbetaling mot oppgjørsrapporten i Two, kryss av for bekreftelse og opprett bilaget.

API-nøkkelen brukes bare til denne ene forespørselen og lagres aldri.
