---
title: "Maler for Make, Zapier og n8n"
seoTitle: "ReAI API i Make, Zapier og n8n | Gratis maler med åpen kildekode"
description: "Ferdige HTTP-forespørsler mot ReAI API for n8n, Make og Zapier, og en test av tilkoblingen og selskaps-ID."
summary: "Ferdige HTTP-forespørsler mot ReAI API for n8n, Make og Zapier."
industry: operations
webAppUrl: /app/automations/
sourcePath: web/worker/apps/automations/
highlights:
  - "Maler for kunder, ordre, kundeemner, kjørebok og bilag"
  - "Slår opp kunden før den opprettes, så ingen blir dobbelt"
  - "Viser hvilken selskaps-ID du skal bruke"
---

## Slik fungerer det

Hvert HTTP-steg i Make, Zapier eller n8n kaller `https://app.reai.no/api/` med en token i `Authorization: Bearer`. En personlig token trenger også `X-Tenant-Id` med selskaps-ID. Appen viser maler for vanlige oppgaver og lenker til [ReAI OpenAPI](https://app.reai.no/openapi/public) for alle felt.

## Slik kommer du i gang

1. Lag en token i ReAI under profilen din, **Access tokens**.
2. Åpne appen, klikk **Connect to ReAI**, velg selskap og klikk **Test ReAI connection** for å se selskaps-ID.
3. Kopier malen inn i et HTTP-steg og bytt ut token og selskaps-ID.
