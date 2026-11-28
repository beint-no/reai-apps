---
title: "Integrasjon mellom Favrit og regnskap"
seoTitle: "Integrasjon mellom Favrit og ReAI: oppgjør til regnskap"
description: "Bokfør oppgjørene fra Favrit som bilag til kontroll i ReAI, med salg per konto og MVA-sats, tips og betalingsgebyr. Gratis og åpen kildekode."
summary: "Hent oppgjørene fra Favrit for én dag og lag ett balansert bilag til kontroll i ReAI."
industry: payments
webAppUrl: /app/favrit/
sourcePath: web/worker/apps/favrit.js
highlights:
  - "Leser oppgjørsrapporter fra Favrit Accounting API med klient-id og hemmelighet"
  - "Beholder salgskontoene fra Favrit og fører salg med utgående MVA-kode i ReAI"
  - "Lager et bilag til kontroll som du godkjenner, med sperre mot dobbel føring"
---

## Dette kommer over i ReAI

Integrasjonen henter oppgjørene som Favrit opprettet på valgt dato for ett utsalgssted, sammen med regnskapsrapporten for hvert oppgjør. Ingenting bokføres før du har kontrollert forhåndsvisningen og opprettet bilaget.

| Linje | Konto i ReAI |
| --- | --- |
| Salg per konto og MVA-sats | Kontoreferansen fra Favrit, ført inklusive MVA med utgående MVA-kode |
| Leveringsgebyr | `3000` med 25 % MVA |
| Tips | `2930` |
| Betalingsgebyr | `7770` |
| Utbetaling fra Favrit | `1580` til avstemming mot banken |

## Slik kommer du i gang

1. Logg inn i Favrit admin, velg utsalgssted og gå til **Company Settings → Integration**.
2. Velg **Integrate to Favrit** under **Developer**, kryss av for **prod/accounting** og gjerne **prod/user**, og klikk **Create Client APP**. Kopier **ClientId** og **SecretId**.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Fyll inn ClientId, SecretId og dato. Har du flere utsalgssteder, fyller du også inn id for utsalgsstedet.
5. Kontroller forhåndsvisningen mot oppgjørsrapporten i Favrit, kryss av for bekreftelse og opprett bilaget.

Nøklene brukes bare til denne ene forespørselen og lagres aldri.
