---
title: Månedsavslutning
seoTitle: ReAI Månedsavslutning — Kontrollpanel for periodeavslutning
description: Kontroller periodelåser, uavstemte banktransaksjoner, bilag til kontroll og leverandørfakturaer i ReAI i én oversikt.
summary: Kun-lesing kontrollpanel for bank, bilag, periodelåser og leverandøroppgaver.
industry: operations
status: maintained
webAppUrl: /app/close-check/
sourcePath: web/worker/apps/close-check.js
highlights:
  - "Sjekker periodelåser, uavstemte banklinjer, bilagskontroll og leverandøroppgaver samtidig"
  - "100 % lesetilgang med direkte lenker inn i app.reai.no for hvert punkt"
  - "Inkluderer eksempelrapport med ett klikk for umiddelbar test"
---

## Seks API-sjekker i parallell

Kaller `/api/company-settings`, `/api/accounting-periods`, `/api/company-banks`, `/api/bank-reconciliations`, `/api/vouchers` og `/api/supplier-invoices/tasks` direkte fra Worker-proxyen.
