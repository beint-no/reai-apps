---
title: "Integrasjon for Revolut Business og Wise"
seoTitle: "Revolut Business & Wise regnskapsintegrasjon for ReAI — Gratis import"
description: "Importer kontoutskrifter fra Revolut Business og Wise til balanserte bilag i ReAI med automatisk utskilling av valutagebyrer på konto 7770."
summary: "Leser CSV-utskrifter fra Revolut og Wise, skiller ut gebyrer på 7770 og oppretter balansert kontrollbilag i ReAI."
industry: operations
webAppUrl: /app/revolut/
sourcePath: web/worker/apps/revolut.js
highlights:
  - "Støtter kontoutskrift i CSV fra både Revolut Business og Wise Business"
  - "Skiller automatisk ut kort- og valutagebyrer på konto 7770"
  - "Balanserer mot egen bank-/kortkonto i regnskapet (f.eks. 1925)"
---

## Enkel bokføring av Revolut Business og Wise i Norge

Mange norske selskaper bruker **Revolut Business** eller **Wise** til utenlandske programvareabonnementer og leverandører. Denne nettappen leser CSV-utskriften, skiller ut valutagebyrer på konto `7770` og lager et ferdig balansert kontrollbilag mot konto `1925`.

## Slik gjør du det i ReAI

1. Last ned månedens kontoutskrift som CSV fra **Revolut Business** eller **Wise**.
2. Klikk **Åpne integrasjon**, koble til ReAI, bekreft motkonto (`1925`) og slipp filen i opplastingsfeltet.
3. Kontroller forhåndsvisningen og opprett kontrollbilaget i ReAI.
