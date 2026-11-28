---
title: "Integrasjon mellom Magento og regnskap"
seoTitle: "Integrasjon mellom Magento 2 og ReAI: produkter og ordre"
description: "Opprett manglende produkter i ReAI etter SKU og legg ordre fra Magento 2 eller Adobe Commerce inn som ordre i ReAI. Gratis og åpen kildekode."
summary: "Hent produkter og fakturerte ordre fra Magento 2 eller Adobe Commerce og lag produkter og ordre i ReAI."
industry: ecommerce-logistics
webAppUrl: /app/magento/
sourcePath: web/worker/apps/magento/
highlights:
  - "Leser produkter og ordre fra Magento REST API med en integrasjonsnøkkel"
  - "Oppretter produkter som mangler i ReAI, med SKU, pris og lagerstatus"
  - "Hopper over SKU og ordre som allerede finnes i ReAI"
---

## Dette kommer over i ReAI

Integrasjonen leser produktkatalogen og ordre med status **processing** eller **complete** fra og med valgt dato. Du ser alt før noe sendes til ReAI.

| Fra Magento | I ReAI |
| --- | --- |
| Produkt med SKU, navn og pris | Produkt med samme SKU, opprettet bare når du klikker **Create in ReAI** |
| Ordre med totalbeløp | Ordre med én linje, beløp eksklusive MVA (totalbeløp minus MVA), ekstern referanse `magento-<id>` |

Ordren kobles til en kunde i ReAI med samme e-post eller navn. Finnes ikke kunden, oppretter du den i ReAI først. Produktprisen hentes slik Magento lagrer den, så sjekk om butikken bruker priser med eller uten MVA. Ordre med refusjon i Magento vises, men legges ikke inn, så de må du føre manuelt.

## Slik kommer du i gang

1. Gå til **System → Extensions → Integrations** i Magento Admin, klikk **Add New Integration**, gi lesetilgang til **Catalog** og **Sales**, lagre og klikk **Activate**. Kopier **Access Token**.
2. På Magento 2.4.4 og nyere må du sette **Stores → Configuration → Services → OAuth → Consumer Settings → Allow OAuth Access Tokens to be used as standalone Bearer tokens** til **Yes**.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Legg inn nettbutikkens adresse, nøkkelen og datoen, og klikk **Scan**.
5. Opprett manglende produkter og legg inn ordrene du vil fakturere.

Nøkkelen brukes bare til denne ene forespørselen og lagres aldri.
