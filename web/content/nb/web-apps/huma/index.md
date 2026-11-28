---
title: "Integrasjon mellom Huma og regnskap"
seoTitle: "Huma ansatte til ReAI | Gratis integrasjon"
description: "Hent aktive ansatte fra Huma Open API og opprett de som mangler i ReAI Ansatte, med startdato og bankkonto."
summary: "Hent aktive ansatte fra Huma Open API og opprett de som mangler i ReAI Ansatte."
industry: operations
webAppUrl: /app/huma/
sourcePath: web/worker/apps/huma.js
highlights:
  - "Bruker Huma Open API med klient-ID og klienthemmelighet"
  - "Finner ansatte som allerede finnes i ReAI på e-post eller navn"
  - "Kontrollerer norske kontonumre før de sendes til ReAI"
---

## Overfør ansatte fra Huma til ReAI

Integrasjonen henter aktive ansatte fra Huma med navn, e-post, startdato, stillingsprosent og norsk bankkonto. Ansatte som allerede finnes i ReAI vises som koblet, og du oppretter resten én og én. Integrasjonen sender ingen invitasjoner og leverer ingen A-melding.

## Slik setter du opp Huma mot ReAI

1. I Huma går du til **Systeminnstillinger → Open API** og klikker **Legg til API-nøkkel**. Kopier klient-ID og klienthemmelighet. Hemmeligheten vises bare én gang.
2. Gi API-nøkkelen en rolle som kan lese ansatte, stillinger og bankkonto. En ny nøkkel har ingen tilgang før den får en rolle.
3. Klikk **Åpne integrasjon**, koble til ReAI og lim inn klient-ID og klienthemmelighet.
4. Kontroller listen og klikk **Create in ReAI** for hver ansatt som skal opprettes.
