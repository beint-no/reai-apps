---
title: Integrasjon mellom HubSpot CRM og regnskap
seoTitle: Integrasjon mellom HubSpot og regnskap for ReAI
description: Hent bedrifter fra HubSpot CRM, finn dem som allerede er kunder i ReAI og opprett resten med kontroll av norsk organisasjonsnummer.
summary: Skann bedrifter i HubSpot, finn eksisterende kunder i ReAI og opprett manglende kunder med ett klikk.
industry: operations
webAppUrl: /app/hubspot/
sourcePath: web/worker/apps/hubspot/
highlights:
  - "Leser bedrifter fra HubSpot CRM med en tjenestenøkkel med lesetilgang"
  - "Finner eksisterende ReAI-kunder på organisasjonsnummer eller navn"
  - "Kontrollerer norsk organisasjonsnummer før kunden opprettes i ReAI"
---

## Fra HubSpot til fakturakunde i ReAI

Når salget skjer i HubSpot og faktureringen i ReAI, gir manuell kopiering lett duplikater eller kunder uten organisasjonsnummer, og da stopper EHF. Her henter du bedriftene fra HubSpot, ser hvilke som allerede finnes i ReAI og oppretter resten med ett klikk.

## Slik setter du det opp

1. Gå til **Development → Keys → Service keys** i HubSpot og velg **Create service key**. Gi nøkkelen tilgangen `crm.objects.companies.read`. Et eksisterende token fra en privat app med samme tilgang fungerer også.
2. HubSpot har ikke et eget felt for organisasjonsnummer. Bruker dere en egen egenskap til dette, finner du det interne navnet under **Settings → Properties → Company properties**.
3. Klikk **Åpne integrasjon**, koble til ReAI og lim inn nøkkelen og eventuelt navnet på egenskapen. Med en dato i **Changed since** hentes bare bedrifter som er endret etter den datoen.
4. Kontroller listen. Norske bedrifter uten gyldig organisasjonsnummer får et felt der du fyller det inn før kunden opprettes. Før kunden opprettes, sjekker integrasjonen på nytt at den ikke allerede finnes i ReAI.
