---
title: "Integrasjon mellom Kvalitetskontroll og regnskap"
seoTitle: "Kvalitetskontroll (KS) timer til ReAI Timelister"
description: "Hent godkjente timer fra Kvalitetskontroll og før dem som timelisterader i ReAI per ansatt og prosjekt. Gratis og åpen kildekode."
summary: "Hent godkjente timer fra Kvalitetskontroll via KS API og før dem i ReAI Timelister."
industry: operations
icon: icons/kvalitetskontroll.svg
webAppUrl: /app/kvalitetskontroll/
sourcePath: web/worker/apps/kvalitetskontroll.js
highlights:
  - "Bruker Kvalitetskontroll API med ditt eget personlige tilgangstoken"
  - "Henter bare godkjente timer, med timetype, prosjekt og ansatt"
  - "Kobler ansatte på navn og fører hver rad først når du klikker"
---

## Dette overføres til ReAI

Godkjente timeregistreringer i Kvalitetskontroll blir timelisterader i ReAI. Hver rad tar med dato, timer etter pause, timetype og kommentar. Ansatte kobles til ansatte i ReAI på navn, og du velger en ansatt som brukes når navnet ikke finnes. Radene kan knyttes til ett prosjekt i ReAI.

Ingenting bokføres i hovedboken. Timene havner i ReAI Timelister, der du godkjenner og fakturerer dem fra prosjektet som vanlig. Registreringer som ikke er godkjent i Kvalitetskontroll, tas ikke med.

## Oppsett

1. Logg inn på **api.kvalitetskontroll.no/admin** med brukeren din i Kvalitetskontroll og legg til et nytt **Personal Access Token**.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg ansatt og eventuelt prosjekt.
3. Lim inn tokenet, velg periode og klikk **Fetch from Kvalitetskontroll API**.
4. Kontroller radene og klikk **Log hours** på dem du vil ha inn i ReAI.

Tokenet brukes bare til denne forespørselen og lagres aldri.
