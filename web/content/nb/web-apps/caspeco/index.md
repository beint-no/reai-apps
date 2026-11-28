---
title: "Integrasjon mellom Caspeco og regnskap"
seoTitle: "Integrasjon mellom Caspeco og ReAI: dagsomsetning til regnskap"
description: "Summer en driftsdag med kassesalg i Caspeco til ett bilag til kontroll i ReAI, fordelt på MVA-satser, betalingstyper og tips. Gratis og åpen kildekode."
summary: "Hent én driftsdag fra Caspeco via Sales Export API og lag ett balansert bilag til kontroll i ReAI."
industry: payments
webAppUrl: /app/caspeco/
sourcePath: web/worker/apps/caspeco/
highlights:
  - "Leser salgslinjer fra Caspeco Sales Export API med AuthKey fra Caspeco"
  - "Finner MVA-satsen per linje og grupperer betalinger på betalingstype"
  - "Lager et bilag til kontroll som du godkjenner, med sperre mot dobbel føring"
---

## Dette kommer over i ReAI

Caspeco leverer alle salgslinjer i driftsdagen, fra kl. 06.00 på valgt dato til kl. 05.59 neste morgen. Integrasjonen summerer salg inklusive MVA per sats, grupperer de samme beløpene på betalingstype og tar med tipset på hver kvittering én gang.

| Linje | Konto i ReAI |
| --- | --- |
| Kontant | `1900` |
| Kort og andre betalingstyper, også tips | `1580` mellomkonto |
| Salg inklusive MVA med 25 %, 15 % og 12 % | `3000`, `3010` og `3020` med utgående MVA-kode i ReAI |
| Tips til ansatte | `2930` |

Caspeco oppgir én betalingstype per salgslinje, så en kvittering som er delt mellom flere betalingstyper havner under typen på linjene. Rabatter som Caspeco oppgir, vises i forhåndsvisningen. Sammenlign betalinger og salg med dagsrapporten i Caspeco før du bokfører.

## Slik kommer du i gang

1. Be Caspeco support om tilgang til **Sales Export API**. Caspeco sender en **AuthKey** og **systemnavnet** for virksomheten din.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
3. Fyll inn AuthKey, systemnavn og driftsdag og hent tallene. Caspeco tillater et begrenset antall forespørsler per døgn for hver nøkkel.
4. Kontroller forhåndsvisningen, kryss av for bekreftelse og opprett bilaget.

Nøkkelen brukes bare til denne ene forespørselen og lagres aldri.
