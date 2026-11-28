---
title: Integrasjon mellom Dintero og regnskap
seoTitle: "Dintero og ReAI: oppgjør og gebyrer"
description: Kontroller Dintero-oppgjør, match utbetalinger mot bank i ReAI og bokfør trukne månedlige gebyrer som kontrollbilag.
summary: Match betalte Dintero-oppgjør mot bank i ReAI og bokfør trukne månedsgebyrer med kontrollflagg.
industry: payments
webAppUrl: /app/dintero/
sourcePath: web/worker/apps/dintero/
highlights:
  - "Summerer trukne gebyrer i betalte Dintero-oppgjør i selskapets valuta"
  - "Matcher nettoutbetalinger mot bank i ReAI og eksporterer avstemmings-CSV"
  - "Oppretter kontrollbilag for gebyrer først etter duplikatsjekk og kontokontroll"
---

## Slik bokfører du trukne Dintero-gebyrer

Når Dintero trekker gebyrer direkte fra oppgjøret (i stedet for å sende egen faktura), blir det liggende en rest på mellomregningskontoen (`1580`). Integrasjonen summerer månedens gebyrer, kontrollerer mot ReAI at bilaget ikke allerede er bokført, og oppretter ett samlet bilag (debet kostnadskonto `7770`, kredit mellomregning `1580`, MVA-kode `0`) merket for regnskapsførerkontroll.

## Slik kobler du Dintero til ReAI

1. Logg inn i [Dintero Backoffice](https://backoffice.dintero.com), gå til **Settings → API clients** og klikk **Create new API client**.
2. Gi klienten tilgang til oppgjørsrapporter (settlements), og lagre klient-ID og klienthemmelighet. Hemmeligheten vises bare én gang.
3. Klikk **Åpne integrasjon**, koble til ReAI og fyll inn konto-ID (P og åtte sifre), klient-ID, klienthemmelighet og måned.
4. Velg bankkontoen i ReAI for å matche utbetalingene, og opprett eventuelt bilaget for gebyrene.
