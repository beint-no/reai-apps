---
title: Hybel Bilagsjournal
seoTitle: Hybel Bilagsjournal — Månedlig CSV-bro for ReAI regnskap
description: Forhåndsvis, valider og bokfør en månedlig Hybel CSV-journal i ReAI som et balansert kontrollbilag rett fra nettleseren.
summary: Valider en månedlig Hybel CSV-bilagsjournal i nettleseren og opprett kontrollbilag i ReAI.
industry: real-estate
status: experimental
webAppUrl: /app/hybel/
sourcePath: web/worker/apps/hybel.js
highlights:
  - "CSV-parsing, automatisk kolonnegjenkjenning og balansekontroll per referanse"
  - "Innebygd eksempel-CSV for å teste hele flyten uten konto"
  - "Validerer organisasjonsnummer, kontoplan, bankkontoer og duplikater mot ReAI-API-et"
  - "Oppretter ett balansert kontrollbilag med SHA-256 kontrollspor"
icon: icons/hybel.avif
---

## Rett i nettleseren

Erstatter den tidligere Mac-prototypen slik at regnskapsførere og utleiere på alle plattformer kan validere månedlig Hybel-CSV (NOK, MVA-kode `0`) og opprette kontrollbilag uten installasjon.
