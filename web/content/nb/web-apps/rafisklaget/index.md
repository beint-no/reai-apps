---
title: "Integrasjon mellom Råfisklaget og regnskap"
seoTitle: "Råfisklaget avregninger til ReAI: sluttsedler som bilag"
description: "Hent avregninger fra Norges Råfisklag og bokfør hver av dem som et balansert bilag til kontroll i ReAI. Gratis og åpen kildekode."
summary: "Hent avregningene for en periode fra Råfisklaget og lag ett bilag per avregning med fangstverdi, MVA, avgifter, trekk og utbetaling."
industry: operations
webAppUrl: /app/rafisklaget/
sourcePath: web/worker/apps/rafisklaget/
highlights:
  - "Leser avregninger fra Råfisklagets webtjeneste for seddeldata"
  - "Fører fangstverdien som salg med utgående MVA og hver avgift og hvert trekk på egen konto"
  - "Kontrollerer at avregningen går opp mot beløpet til utbetaling før bilaget lages"
---

## Dette kommer over i ReAI

Integrasjonen henter avregningene for fiskernummeret eller organisasjonsnummeret ditt i perioden du velger. Hver avregning blir ett bilag til kontroll, datert på salgsdatoen.

| Fra avregningen | I ReAI |
| --- | --- |
| Fangstverdi og utgående MVA | Kredit på salgskonto med utgående MVA-kode for satsen |
| Lagsavgift, produktavgift, forskningsavgift, kontrollavgift og ressursavgift | Debet på kontoene du velger |
| Pensjonstrekk, medlemstrekk, sløyekostnad og egenandeler | Debet på kontoene du velger |
| Heftelser | Debet på en gjeldskonto du velger |
| Inngående MVA | På trekket som MVA-grunnlaget gjelder, med inngående MVA-kode |
| Til utbetaling | Debet på en fordringskonto som avstemmes mot utbetalingen i banken |

Bilaget lages bare når fangstverdi, MVA og trekk går opp mot beløpet til utbetaling. Samme avregning kan ikke bokføres to ganger.

## Slik kommer du i gang

1. Be om brukernavn og passord til webtjenesten for seddeldata hos Råfisklaget, via Min side eller it-vakt@rafisklaget.no. Regnskapsfører kan også søke om tilgang.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
3. Skriv inn brukernavn, passord, fiskernummer eller organisasjonsnummer og perioden. Kontroller kontoene under **Accounts**.
4. Kontroller forhåndsvisningen mot avregningen på Min side, kryss av og opprett bilaget.
5. Last opp PDF-en av avregningen på bilaget i ReAI.

Brukernavn og passord brukes bare til disse forespørslene og lagres aldri.
