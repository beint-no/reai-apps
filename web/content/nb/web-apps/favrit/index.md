---
title: "Integrasjon mellom Favrit og regnskap"
seoTitle: "Integrasjon mellom Favrit og ReAI: dagens salg til regnskap"
description: "Bokfør dagens salg fra Favrit som bilag til kontroll i ReAI, med salg per konto og MVA-sats, refusjoner og tips. Gratis og åpen kildekode."
summary: "Hent ordrelinjene fra Favrit for én dag og lag ett balansert bilag til kontroll i ReAI."
industry: payments
webAppUrl: /app/favrit/
sourcePath: web/worker/apps/favrit/
highlights:
  - "Leser ordrelinjene fra Favrit Orderline API med klient-id og hemmelighet"
  - "Beholder salgskontoene fra Favrit og fører salg med utgående MVA-kode i ReAI"
  - "Lager et bilag til kontroll som du godkjenner, med sperre mot dobbel føring"
---

## Dette kommer over i ReAI

Integrasjonen henter ordrelinjene som ble opprettet på valgt dato (norsk tid) for ett utsalgssted. Refusjoner og forkastede linjer trekkes fra salget den dagen de skjer. Ingenting bokføres før du har kontrollert forhåndsvisningen og opprettet bilaget.

| Linje | Konto i ReAI |
| --- | --- |
| Salg per konto og MVA-sats | Kontoreferansen fra Favrit, ført inklusive MVA med utgående MVA-kode |
| Tips | `2930` |
| Betalinger | `1580` til avstemming mot utbetalingen i banken |

Ordrelinjene har ikke med betalingsgebyr. Bokfør gebyret når utbetalingen kommer i banken.

## Slik kommer du i gang

1. Logg inn i Favrit admin, velg utsalgssted og gå til **Company Settings → Integration**.
2. Velg **Integrate to Favrit** under **Developer**, kryss av for **prod/transaction** og klikk **Create Client APP**. Kopier **ClientId** og **SecretId**.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Fyll inn ClientId, SecretId og dato. Gjelder klienten flere utsalgssteder, fyller du også inn id for utsalgsstedet.
5. Kontroller forhåndsvisningen mot salgsrapporten i Favrit, kryss av for bekreftelse og opprett bilaget.

Nøklene brukes bare til denne ene forespørselen og lagres aldri.
