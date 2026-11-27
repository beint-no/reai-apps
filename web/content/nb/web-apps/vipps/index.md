---
title: Vipps-avstemming
seoTitle: ReAI Vipps-avstemming — Sammenlign Vipps-utbetalinger mot bank
description: Sammenlign planlagte Vipps-utbetalinger mot uavstemte banktransaksjoner i ReAI og last ned CSV-rapport.
summary: Sammenlign Vipps-utbetalinger mot uavstemte banktransaksjoner i ReAI og eksporter CSV.
industry: payments
status: example
webAppUrl: /app/vipps/
sourcePath: web/worker/apps/reconcile.js
highlights:
  - "Kaller Vipps Report API v2 ved behov uten å lagre salgsenhetsnøkler"
  - "Matcher utbetalinger mot uavstemte banktransaksjoner i ReAI innenfor 8 dager"
  - "Kun lesing med sikker CSV-eksport og innebygd eksempeldata"
icon: icons/vipps.avif
---

## Kun lesing av Vipps-utbetalinger

Bruker den delte avstemmingsmotoren i `web/worker/lib/reconcile.js` uten å opprette automatiske posteringer.
