---
title: "Integrasjon mellom Qondor og regnskap"
seoTitle: "Qondor fakturaer til ReAI | Gratis integrasjon"
description: "Hent fakturagrunnlag og fakturaer fra Qondor via API og lag ordre eller fakturaer i ReAI med varelinjer og MVA fra Qondor. Gratis og åpen kildekode."
summary: "Hent ubehandlede fakturaer fra Qondor, før dem i ReAI og marker dem som behandlet i Qondor."
industry: operations
webAppUrl: /app/qondor/
sourcePath: web/worker/apps/qondor/
highlights:
  - "Leser fakturaer fra Qondor Invoicing API med abonnementsnøkkelen din"
  - "Tar med linjer, valuta og MVA-sats fra Qondor"
  - "Markerer fakturaen som behandlet i Qondor med nummeret fra ReAI"
---

## Dette kommer over i ReAI

Integrasjonen henter fakturaer som ikke er behandlet ennå i Qondor. Et fakturagrunnlag blir en ordre i ReAI som du fakturerer derfra. En faktura som allerede har fakturanummer i Qondor, blir importert i ReAI med samme nummer og bokført.

| Fra Qondor | I ReAI |
| --- | --- |
| Fakturagrunnlag | Ordre klar til fakturering |
| Faktura med nummer | Importert faktura med nummeret fra Qondor |
| Pris på et produkt | Ordrelinje uten MVA, med MVA-kode for satsen |
| Mottaker | Eksisterende kunde funnet på organisasjonsnummer eller e-post, ellers ny kunde |

Kreditnotaer, kortbetalinger og linjer der MVA er beregnet av et annet grunnlag enn prisen, blir stående i Qondor. Før dem manuelt i ReAI.

## Slik kommer du i gang

1. Be Qondor support om tilgang til API-portalen for miljøet Production.
2. Logg inn i Qondor API-portalen og kopier primærnøkkelen fra profilen din.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Lim inn nøkkelen og hent fakturaene.
5. Kontroller beløpene og klikk **Stage order** eller **Import invoice** for hver faktura.

Nøkkelen brukes bare til disse forespørslene og lagres aldri.
