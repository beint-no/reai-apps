---
title: Integrasjon mellom Dintero og regnskap
seoTitle: Integrasjon mellom Dintero og regnskap — Oppgjør og gebyrbokføring
description: Kontroller Dintero-oppgjør, match utbetalinger mot bank i ReAI og bokfør trukne månedlige gebyrer som kontrollbilag.
summary: Match betalte Dintero-oppgjør mot bank i ReAI og bokfør trukne månedsgebyrer med kontrollflagg.
industry: payments
webAppUrl: /app/dintero/
sourcePath: web/worker/apps/dintero.js
highlights:
  - "Summerer trukne gebyrer i betalte Dintero-oppgjør i selskapets valuta"
  - "Matcher nettoutbetalinger mot bank i ReAI og eksporterer avstemmings-CSV"
  - "Oppretter kontrollbilag for gebyrer først etter duplikatsjekk og kontokontroll"
---

## Slik bokfører du trukne Dintero-gebyrer

Når Dintero trekker gebyrer direkte fra oppgjøret (i stedet for å sende egen faktura), blir det liggende en rest på mellomregningskontoen (`1580`). Integrasjonen summerer månedens gebyrer, kontrollerer mot ReAI at bilaget ikke allerede er bokført, og oppretter ett samlet bilag (debet kostnadskonto `7770`, kredit mellomregning `1580`, MVA-kode `0`) merket for regnskapsførerkontroll.
