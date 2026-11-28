---
title: Integrasjon mellom Hybel.no og regnskap
seoTitle: Integrasjon mellom Hybel.no og regnskap — Månedlig bilagsjournal til ReAI
description: Valider og bokfør månedlig bilagsjournal fra Hybel.no rett inn i ReAI gratis. Praktisk guide for utleiere og regnskapsførere.
summary: Valider en månedlig bilagsjournal (CSV) fra Hybel og opprett et balansert kontrollbilag i ReAI.
industry: real-estate
icon: icons/hybel.svg
webAppUrl: /app/hybel/
sourcePath: web/worker/apps/hybel.js
highlights:
  - "Leser UTF-8 og Windows-1252 CSV fra Hybel med automatisk kolonnegjenkjenning"
  - "Kontrollerer at alle dato- og bilagsgrupper balanserer til 0,00 før bokføring"
  - "Validerer org.nr, kontoplan, aktive bankkontoer og duplikater mot ReAI"
---

## Slik får du utleieregnskapet fra Hybel inn i ReAI

Mange norske utleieselskaper bruker Hybel.no til leiekontrakter, depositum og leietakeroppfølging, og ReAI til hovedbok, skattemelding og årsregnskap. Ved å eksportere månedens **Bilagsjournal** (hovedbok, NOK, MVA-kode `0`) som CSV og kjøre den gjennom denne integrasjonen får du automatisk kontroll av balanse, kontoplan, bankkonto og duplikater—og ett ryddig kontrollbilag i ReAI med SHA-256-kontrollspor. Leietakerreskontro forblir i Hybel.
