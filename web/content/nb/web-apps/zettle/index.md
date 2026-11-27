---
title: Zettle-avstemming
seoTitle: ReAI Zettle-avstemming — Sammenlign Zettle-utbetalinger mot bank
description: Sammenlign Zettle-utbetalinger med uavstemte banktransaksjoner i ReAI og last ned strukturert CSV-rapport.
summary: Sammenlign Zettle-utbetalinger mot uavstemte banktransaksjoner i ReAI og eksporter CSV.
industry: payments
status: example
webAppUrl: /app/zettle/
sourcePath: web/worker/apps/reconcile.js
highlights:
  - "Bruker Zettle READ:FINANCE-nøkkel per gjennomgang uten å lagre nøkkelen"
  - "Matcher kasseutbetalinger mot uavstemte banktransaksjoner i ReAI"
  - "Kun lesing med CSV-nedlasting og eksempeldata"
icon: icons/zettle.avif
---

## Kontroll av kasseutbetalinger

Matcher utbetalinger fra Zettle Finance API mot banktransaksjoner i ReAI uten automatiske posteringer.
