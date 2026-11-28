---
title: "Integrasjon mellom LetsReg og regnskap"
seoTitle: "Integrasjon mellom LetsReg og ReAI: oppgjør til regnskap"
description: "Bokfør hvert oppgjør fra LetsReg som bilag til kontroll i ReAI, med påmeldinger per MVA-sats, gebyrer og utbetalt beløp. Gratis og åpen kildekode."
summary: "Hent oppgjørene LetsReg har utbetalt i en måned og lag ett balansert bilag til kontroll i ReAI for hvert oppgjør."
industry: operations
webAppUrl: /app/letsreg/
sourcePath: web/worker/apps/letsreg/
highlights:
  - "Leser oppgjør og ordrelinjer fra LetsReg API"
  - "Fører påmeldinger inklusive MVA med riktig MVA-kode, også for avgiftsfrie arrangementer"
  - "Lager ett bilag til kontroll per utbetaling, med sperre mot dobbel føring"
---

## Dette kommer over i ReAI

Integrasjonen henter oppgjørene LetsReg har utbetalt i valgt måned, med alle ordrene i hvert oppgjør. For hvert oppgjør ser du ett bilag med påmeldinger per MVA-sats, gebyret til LetsReg og beløpet som er utbetalt. Bilaget dateres utbetalingsdagen. Ingenting bokføres før du har kontrollert forhåndsvisningen og opprettet bilaget.

| Linje | Konto i ReAI |
| --- | --- |
| Påmeldinger per MVA-sats | `3000` (25 %), `3010` (15 %), `3020` (12 %) eller `3100` (uten MVA), ført inklusive MVA med utgående MVA-kode |
| Gebyr til LetsReg | `7770`, uten fradrag for inngående MVA |
| Utbetalt fra LetsReg | `1580` |

Viser fakturaen fra LetsReg MVA på gebyret, retter du MVA-koden i bilaget. Utbetalingen blir stående på mellomkontoen `1580` til den avstemmes mot banken. API-et viser de siste oppgjørene, så hent hver måned kort tid etter at den er over.

## Slik kommer du i gang

1. Bruk innloggingen til en administrator hos arrangøren. Be LetsReg support om API-tilgang til oppgjør for denne brukeren.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
3. Fyll inn brukernavn, passord og måned. Nettstedets id er `1` for letsreg.no; spør LetsReg hvis arrangøren ligger på et annet nettsted. Har brukeren flere arrangører, fyller du inn arrangørens id.
4. Kontroller hvert bilag mot oppgjørsrapporten i LetsReg, kryss av for bekreftelse og opprett bilaget.

Passordet brukes bare til denne ene forespørselen og lagres aldri.
