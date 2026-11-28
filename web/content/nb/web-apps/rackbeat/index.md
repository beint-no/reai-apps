---
title: "Integrasjon mellom Rackbeat og regnskap"
seoTitle: "Produkter fra Rackbeat til ReAI"
description: "Sammenlign produktregisteret i Rackbeat med produktene i ReAI på SKU og opprett manglende produkter med priser og strekkode. Gratis og åpen kildekode."
summary: "Les produkter fra Rackbeat via REST API og opprett de som mangler i ReAI."
industry: ecommerce-logistics
icon: icons/rackbeat.svg
webAppUrl: /app/rackbeat/
sourcePath: web/worker/apps/rackbeat.js
highlights:
  - "Leser salgbare produkter fra Rackbeat med en personlig API-nøkkel"
  - "Sammenligner varenummeret i Rackbeat med SKU i ReAI"
  - "Oppretter manglende produkter i ReAI med salgspris, kostpris og strekkode"
---

## Dette overføres til ReAI

Integrasjonen leser alle produkter i Rackbeat som ikke er sperret, og sammenligner varenummeret med SKU på produktene i ReAI. For hvert produkt som mangler, kan du opprette en lagervare i ReAI med navnet fra Rackbeat som tittel, varenummeret som SKU og salgspris, kostpris og strekkode fra Rackbeat. Produkter som allerede finnes i ReAI, endres ikke.

Lagerbeholdningen i Rackbeat vises bare som informasjon. Det opprettes ingen lagerbevegelser, bilag eller ordrer, og salgskonto og mva-kode følger standardoppsettet for produkter i ReAI.

## Oppsett

1. Åpne **Company settings > API** i Rackbeat og opprett en ny nøkkel med et navn som ReAI. Integrasjonen leser bare produkter.
2. Kopier nøkkelen med en gang. Rackbeat viser den bare én gang.
3. Klikk **Åpne integrasjon**, koble til ReAI, lim inn nøkkelen og klikk **Scan Rackbeat products**.
4. Klikk **Create in ReAI** på produktene du vil ha med.

Nøkkelen brukes bare til skanningen og lagres aldri.
