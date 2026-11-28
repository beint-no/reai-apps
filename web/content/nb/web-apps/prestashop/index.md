---
title: "Integrasjon mellom PrestaShop og regnskap"
seoTitle: "PrestaShop regnskapsintegrasjon for ReAI — Gratis produkt- og salgssynk"
description: "Synkroniser produkter og betalte ordrer fra PrestaShop til ReAI via PrestaShop Webservice API — helt uten månedlige tilleggsgebyrer."
summary: "Hent varekatalog og betalte ordrer fra PrestaShop Webservice API og synkroniser direkte til ReAI."
industry: ecommerce-logistics
icon: icons/prestashop.svg
webAppUrl: /app/prestashop/
sourcePath: web/worker/apps/ecommerce.js
highlights:
  - "Krever ingen ekstra plugin i PrestaShop — bruker innebygd Webservice API"
  - "Matcher varenummer/referanse mot eksisterende varer i ReAI"
  - "Trygg, idempotent import av betalte nettbutikkordrer"
---

## Synkroniser PrestaShop med ReAI uten plugin

PrestaShop har et innebygd Webservice-API som lar ReAI lese produkter og ordrer direkte uten at du trenger å installere eller vedlikeholde tredjepartsmoduler i butikken.

## Slik kommer du i gang

1. Gå til **Advanced Parameters → Webservice** i PrestaShop, aktiver Webservice og lag en nøkkel med `GET`-tilgang til `products` og `orders`.
2. Klikk **Åpne integrasjon**, koble til ReAI og legg inn nettbutikkens adresse og nøkkel.
3. Synkroniser nye produkter og importer betalte ordrer med ett klikk.
