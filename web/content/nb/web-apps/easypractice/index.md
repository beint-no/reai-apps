---
title: "Integrasjon mellom EasyPractice og regnskap"
seoTitle: "Integrasjon mellom EasyPractice og ReAI: fakturaer til regnskap"
description: "Bokfør fakturaene fra EasyPractice for en periode som bilag til kontroll i ReAI, fordelt på MVA-sats og betalingsstatus. Gratis og åpen kildekode."
summary: "Hent fakturaene fra EasyPractice for en periode og lag ett balansert bilag til kontroll i ReAI."
industry: operations
webAppUrl: /app/easypractice/
sourcePath: web/worker/apps/easypractice.js
highlights:
  - "Leser fakturaer fra EasyPractice API med et personlig tilgangstoken"
  - "Skiller behandlinger uten MVA fra salg med MVA og fører riktig MVA-kode i ReAI"
  - "Lager et bilag til kontroll som du godkjenner, med sperre mot dobbel føring"
---

## Dette kommer over i ReAI

Integrasjonen henter fakturaene med fakturadato i valgt periode. Utkast tas ikke med. Ingenting bokføres før du har kontrollert forhåndsvisningen og opprettet bilaget.

| Linje | Konto i ReAI |
| --- | --- |
| Betalt kontant | `1900` |
| Betalt med kort eller annen betalingsmåte | `1580` til avstemming mot banken |
| Ikke betalt ennå | `1570` |
| Salg uten MVA | `3100` |
| Salg med MVA | `3000`, ført inklusive MVA med utgående MVA-kode |

Bare fakturaer i NOK kan bokføres.

## Slik kommer du i gang

1. Gå til **Apper** i EasyPractice og aktiver appen **API**.
2. Åpne **API-innstillinger**, klikk **Opprett nytt token** under personlige tilgangstoken, velg tilgangen **invoices-read** og kopier tokenet.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Fyll inn tokenet og perioden.
5. Kontroller forhåndsvisningen mot fakturalisten i EasyPractice, kryss av for bekreftelse og opprett bilaget.

Tokenet brukes bare til denne ene forespørselen og lagres aldri.
