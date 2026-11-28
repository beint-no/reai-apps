---
title: "Integrasjon mellom Pleo og regnskap"
seoTitle: "Integrasjon mellom Pleo og ReAI: eksportjobber til bilag"
description: "Bokfør eksportjobber fra Pleo som bilag til kontroll i ReAI, med kontoene, MVA og motkontoen fra Pleo. Gratis og åpen kildekode."
summary: "Hent den eldste eksportjobben fra Pleo, lag ett balansert bilag i ReAI og marker utgiftene som eksportert i Pleo."
industry: operations
webAppUrl: /app/pleo/
sourcePath: web/worker/apps/pleo.js
highlights:
  - "Leser eksportjobber fra Pleo Export API med en API-nøkkel fra Pleo"
  - "Bruker kontoen og MVA-satsen på hver utgift og motkontoen fra Pleo"
  - "Markerer utgiftene som eksportert i Pleo med lenke til bilaget i ReAI"
---

## Dette kommer over i ReAI

Integrasjonen henter den eldste eksportjobben som venter i Pleo. Hver utgiftslinje føres til debet på kontoen som er valgt i Pleo, inklusive MVA med inngående MVA-kode i ReAI. Summen for hver utgift føres til kredit på motkontoen fra Pleo, for eksempel kortkontoen. Ingenting bokføres før du har kontrollert forhåndsvisningen og opprettet bilaget.

| Fra Pleo | I ReAI |
| --- | --- |
| Utgiftslinje | Debet på kontoen fra Pleo, med inngående MVA-kode for satsen |
| Utgiftens sum | Kredit på motkontoen fra Pleo |
| Eksportjobb | Ett bilag til kontroll, med sperre mot dobbel føring |

Når bilaget er opprettet, blir utgiftene markert som eksportert i Pleo med bilagsnummer og lenke. Leverandørfakturaer som Pleo fører som leverandørgjeld, blir stående i Pleo.

## Slik kommer du i gang

1. Be Pleo Support om å slå på API-nøkler hvis **API Keys** mangler under **Settings** i Pleo.
2. Gå til **Settings → API Keys → Create API Key** i Pleo. Gi nøkkelen tilgangene `export-jobs:read`, `export-jobs:write` og `export-items:read`, og kopier den.
3. Kontroller at hver utgift har en firesifret konto, og at motkonto er valgt under **Settings → Accounting → Contra accounts**.
4. Velg utgiftene under **Exports**, klikk **Add to Export Queue**, åpne **Export Queue** og klikk **Export**.
5. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap. Lim inn nøkkelen og hent eksportjobben.
6. Kontroller forhåndsvisningen, kryss av for bekreftelse og opprett bilaget.

Nøkkelen brukes bare til disse forespørslene og lagres aldri.
