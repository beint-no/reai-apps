---
title: "Integrasjon mellom Baemingo og regnskap"
seoTitle: "Integrasjon mellom Baemingo og ReAI: dagsomsetning til regnskap"
description: "Summer en driftsdag i Baemingo med ordrer, refusjoner og tips til ett bilag til kontroll i ReAI, fordelt på MVA-satser og betalingsmåter. Gratis og åpen kildekode."
summary: "Hent én driftsdag fra Baemingo via det åpne API-et og lag ett balansert bilag til kontroll i ReAI."
industry: payments
icon: icons/baemingo.svg
webAppUrl: /app/baemingo/
sourcePath: web/worker/apps/baemingo.js
highlights:
  - "Leser ordrer, refusjoner og tipskorrigeringer fra Baemingo API med din x-api-key"
  - "Fordeler salg på MVA-satser og betalinger på betalingsmåte, med tips som gjeld til ansatte"
  - "Lager et bilag til kontroll som du godkjenner, med sperre mot dobbel føring"
---

## Dette kommer over i ReAI

Baemingo leverer én driftsdag om gangen, fra kl. 04.00 UTC på valgt dato til kl. 04.00 UTC dagen etter. Integrasjonen summerer alle ordrer, refusjoner og tipskorrigeringer i døgnet og viser ett bilag.

| Linje | Konto i ReAI |
| --- | --- |
| Kontant | `1900` |
| Kort, Vipps og andre betalinger, også tips betalt med kort | `1580` mellomkonto |
| Salg inklusive MVA med 25 %, 15 % og 12 % | `3000`, `3010` og `3020` med utgående MVA-kode i ReAI |
| Tips til ansatte | `2930` |

Refusjoner tas med på dagen de ble gjort, slik Baemingo rapporterer dem. Serviceavgift og eventuell avrunding føres på ordrens største MVA-sats, slik at hver ordre går i balanse. Kontroller mot Z-rapporten i Baemingo før du bokfører.

## Slik kommer du i gang

1. Gå til **Integrations → Public API** i Baemingo Admin (`admin.baemingo.com/integrations/api`) og lag en API-nøkkel. Nøkkelen vises bare én gang og gjelder ett utsalgssted.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
3. Fyll inn nøkkelen og driftsdagen og hent tallene.
4. Kontroller forhåndsvisningen, kryss av for bekreftelse og opprett bilaget. Legg ved Z-rapporten fra Baemingo i ReAI.

Nøkkelen brukes bare til denne ene forespørselen og lagres aldri.
