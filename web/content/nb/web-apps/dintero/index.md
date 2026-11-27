---
title: Dintero-gebyrer
seoTitle: ReAI Dintero-gebyrer — Kontroller gebyrer og lag månedsbilag
description: Kontroller trukne Dintero-gebyrer, match nettoutbetalinger mot bank i ReAI og opprett månedlig kontrollbilag.
summary: Kontroller trukne Dintero-gebyrer, eksporter CSV og opprett kontrollbilag ved behov.
industry: payments
status: example
webAppUrl: /app/dintero/
sourcePath: web/worker/apps/reconcile.js
highlights:
  - "Summerer trukne gebyrer i betalte Dintero-oppgjør i selskapets valuta"
  - "Sammenligner nettoutbetalinger mot uavstemte banktransaksjoner og eksporterer CSV"
  - "Oppretter kontrollbilag først etter duplikatsjekk, kontokontroll og eksplisitt bekreftelse"
icon: icons/dintero.avif
---

## Gebyravstemming og bokføring

Sjekker ReAI for eksisterende månedlig Dintero-gebyrbilag før bokføring, og tillater aldri bokføring fra testkontoer (`T…`).
