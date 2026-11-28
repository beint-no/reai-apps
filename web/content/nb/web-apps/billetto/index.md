---
title: "Integrasjon mellom Billetto og regnskap"
seoTitle: "Integrasjon mellom Billetto og ReAI: billettsalg til regnskap"
description: "Bokfør billettsalg fra Billetto som bilag til kontroll i ReAI, med inntekt per MVA-sats, gebyrer og saldo hos Billetto. Gratis og åpen kildekode."
summary: "Hent hovedboken fra Billetto for en periode og lag ett balansert bilag til kontroll i ReAI."
industry: operations
webAppUrl: /app/billetto/
sourcePath: web/worker/apps/billetto/
highlights:
  - "Leser hovedboken (ledger entries) fra Billetto API med et nøkkelpar"
  - "Fører billettinntekt inklusive MVA med riktig MVA-kode, også for avgiftsfrie billetter"
  - "Lager et bilag til kontroll som du godkjenner, med sperre mot dobbel føring"
---

## Dette kommer over i ReAI

Integrasjonen henter alle posteringer i Billettos hovedbok for valgt periode. Billettinntekt og rabatter summeres per MVA-sats, og refusjoner og kanselleringer trekkes fra. Gebyrene Billetto trekker, som betalingsgebyr, provisjon og fakturagebyr, føres som kostnad. Dagen regnes etter norsk tid, og bilaget dateres siste dag i perioden. Ingenting bokføres før du har kontrollert forhåndsvisningen og opprettet bilaget.

| Linje | Konto i ReAI |
| --- | --- |
| Billettinntekt per MVA-sats | `3000` (25 %), `3010` (15 %), `3020` (12 %) eller `3100` (uten MVA), ført inklusive MVA med utgående MVA-kode |
| Gebyrer fra Billetto | `7770`, med inngående MVA bare når Billetto har oppgitt MVA på gebyret |
| Tilbakeføringer (chargebacks) | `7790` |
| Saldo hos Billetto | `1580` |

Utbetalinger fra Billetto vises i forhåndsvisningen, men bokføres ikke her. De avstemmes mot banken og mellomkontoen `1580`.

## Slik kommer du i gang

1. Gå til **Integrasjoner → Developers → API - Key pairs** i Billetto og velg **Create key pair**. Kopier ID og hemmelig nøkkel.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
3. Fyll inn ID, hemmelig nøkkel og periode, og hent hovedboken.
4. Kontroller forhåndsvisningen mot den økonomiske rapporten i Billetto, kryss av for bekreftelse og opprett bilaget.

Nøkkelen brukes bare til denne ene forespørselen og lagres aldri.
