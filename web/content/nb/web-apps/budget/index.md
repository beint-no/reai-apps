---
title: "Budsjettimport fra CSV"
seoTitle: "Budsjett fra CSV til ReAI | Gratis integrasjon med åpen kildekode"
description: "Last opp månedsbudsjett per resultatkonto fra Excel eller CSV til ReAI, og se det lagrede budsjettet per kvartal."
summary: "Last opp månedsbudsjett per resultatkonto til ReAI og se det lagrede budsjettet per kvartal."
industry: operations
webAppUrl: /app/budget/
sourcePath: web/worker/apps/budget/
highlights:
  - "Ett budsjettår lagres samlet i ReAI"
  - "Godtar norske tallformater"
  - "Viser det lagrede budsjettet per kvartal"
---

## Dette overføres til ReAI

Filen har kontonummer i første kolonne og ett beløp per måned fra januar til desember. Bare resultatkontoer (3000 til 8999) er med. Inntekter og kostnader føres som positive beløp, reduksjoner som negative.

Appen erstatter hele budsjettåret i ReAI. Kontoer som ikke står i filen, får null i budsjett. Hvis noen har endret budsjettet i ReAI mens du lastet opp, avvises opplastingen og du kan prøve igjen.

## Slik kommer du i gang

1. Lagre budsjettet fra Excel som CSV med en overskriftsrad.
2. Åpne appen, klikk **Connect to ReAI** og velg selskap.
3. Velg år, last opp filen og klikk **Replace budget in ReAI**.
4. Klikk **Load live ReAI budget** for å kontrollere resultatet.
