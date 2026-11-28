---
title: "Integrasjon mellom Magento og regnskap"
seoTitle: "Magento 2 / Adobe Commerce regnskapsintegrasjon for ReAI — Gratis"
description: "Koble Magento 2 eller Adobe Commerce gratis til ReAI for synkronisering av produkter og betalte ordrer rett fra REST API-et."
summary: "Synkroniser produkter på SKU og importer betalte ordrer fra Magento 2 / Adobe Commerce direkte til ReAI."
industry: ecommerce-logistics
webAppUrl: /app/magento/
sourcePath: web/worker/apps/magento.js
highlights:
  - "Bruker standard Magento REST API v1 (/rest/V1/products og /orders)"
  - "Oppretter nye produkter i ReAI med pris og lagerstatus"
  - "Idempotent ordreimport uten risiko for dobbeltføring"
---

## Direkte integrasjon fra Magento 2 til ReAI

Du trenger ikke kostbar mellomvare for å få produkter og betalte ordrer fra Magento 2 eller Adobe Commerce inn i regnskapet. ReAI henter katalogen og ordrene direkte via Magento REST API.

## Slik setter du opp koblingen

1. Gå til **System → Extensions → Integrations** i Magento Admin, opprett en integrasjon med lesetilgang til Catalog og Sales, og kopier Access Token.
2. Klikk **Åpne integrasjon**, koble til ReAI-selskapet ditt og legg inn nettbutikkens URL og nøkkel.
3. Skann og synkroniser nye produkter og betalte ordrer.
