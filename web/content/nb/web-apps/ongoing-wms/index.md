---
title: "Integrasjon mellom Ongoing WMS og regnskap"
seoTitle: "Ongoing WMS og ReAI: artikler fra lageret til produktregisteret"
description: "Hent artiklene lageret ditt har registrert i Ongoing WMS og opprett de som mangler som produkter i ReAI. Gratis og åpen kildekode."
summary: "Les artiklene fra Ongoing WMS og opprett manglende varenumre som produkter i ReAI."
industry: ecommerce-logistics
webAppUrl: /app/ongoing-wms/
sourcePath: web/worker/apps/ongoing-wms.js
highlights:
  - "Leser artikler fra Ongoing WMS Goods Owner REST API"
  - "Sammenligner varenumre med produktene i ReAI"
  - "Oppretter manglende produkter med pris, innpris og strekkode"
---

## Dette gjør integrasjonen

Integrasjonen henter de aktive artiklene bedriften din har på lageret i Ongoing WMS, med varenummer, navn, utpris, innpris, strekkode og antall på lager. Varenumrene sammenlignes med produktene i ReAI. Artikler som mangler kan du opprette som lagerførte produkter i ReAI, én om gangen. Lagerbeholdningen i ReAI endres ikke.

## Slik kommer du i gang

1. Be lageret om **goods owner ID** og en API bruker for bedriften din. Lageret lager brukeren under **Administration → API for goods owners** og velger OAuth (anbefalt) eller Basic. Med OAuth får du client ID og client secret, med Basic brukernavn og passord.
2. Finn lagernavnet i adressen du logger inn med: `https://{lager}.ongoingsystems.se/{lager}`.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Fyll inn lagernavn, goods owner ID, type API bruker og nøklene, og hent artiklene.
5. Opprett produktene som mangler i ReAI.

Nøklene brukes bare til denne ene forespørselen og lagres aldri.
