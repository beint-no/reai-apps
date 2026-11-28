---
title: "Integrasjon mellom Teamtailor og regnskap"
seoTitle: "Nyansatte fra Teamtailor til ReAI | Gratis integrasjon"
description: "Hent ansatte kandidater fra Teamtailor via API og opprett dem som ansatte i ReAI med kontaktinformasjon og startdato. Gratis og åpen kildekode."
summary: "Opprett ansatte i ReAI fra kandidater i steget Ansatt i Teamtailor."
industry: operations
webAppUrl: /app/teamtailor/
sourcePath: web/worker/apps/teamtailor/
highlights:
  - "Leser kandidater i steget Ansatt via Teamtailor API"
  - "Bruker startdato og jobbepost fra Teamtailor Onboarding når den finnes"
  - "Hopper over personer som allerede er ansatt i ReAI"
---

## Dette kommer over i ReAI

Integrasjonen leser kandidater som er flyttet til et ansattsteg i Teamtailor fra en dato du velger. Hver ansettelse vises med stilling, epost og dato, og sammenlignes med de ansatte i ReAI på epost eller navn. Du oppretter de nye ansatte én og én.

| Fra Teamtailor | I ReAI |
| --- | --- |
| Navn, epost, telefon og adresse på kandidaten | Ansatt |
| Startdato fra Onboarding, eller datoen du velger | Ansettelsesdato og arbeidsforhold |
| Jobbepost fra Onboarding | Epost på den ansatte |

Fødselsnummer, kontonummer, lønn og skattekort finnes ikke i Teamtailor. Legg dem inn i ReAI før første lønnskjøring.

## Slik kommer du i gang

1. I Teamtailor åpner en bruker med Company Admin **Settings → Integrations → API keys** og klikker **New API key**.
2. Velg omfanget **Admin** med **Read** og kopier nøkkelen.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Lim inn nøkkelen, velg dataregion og tidligste ansettelsesdato, og hent.
5. Kontroller startdatoen på hver rad og klikk **Create in ReAI**.

Nøkkelen brukes bare til disse forespørslene og lagres aldri.
