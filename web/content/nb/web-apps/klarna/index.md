---
title: Klarna-avstemming
seoTitle: ReAI Klarna-avstemming — Sammenlign Klarna-oppgjør mot bank
description: Sammenlign oppgjør fra Klarna med uavstemte banktransaksjoner i ReAI og eksporter avstemmings-CSV.
summary: Sammenlign Klarna-oppgjør mot uavstemte banklinjer i ReAI og eksporter CSV.
industry: payments
status: example
webAppUrl: /app/klarna/
sourcePath: web/worker/apps/reconcile.js
highlights:
  - "Henter oppgjør fra Klarna Settlements v1 ved behov uten å lagre API-nøkkelen"
  - "Fremhever referanse- og beløpstreff mot uavstemte banktransaksjoner i ReAI"
  - "Inkluderer eksempelmodus og CSV-eksport"
icon: icons/klarna.avif
---

## Avstemming av Klarna-oppgjør

Lim inn en Klarna API-nøkkel for én kontrolløkt og eksporter avstemmingsresultatene til CSV.
