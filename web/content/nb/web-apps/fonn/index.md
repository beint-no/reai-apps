---
title: "Integrasjon mellom Fonn og regnskap"
seoTitle: "Fonn timekort til ReAI Timelister"
description: "Hent timekort fra Fonn per prosjekt og før dem som timelisterader i ReAI per ansatt og prosjekt. Gratis og åpen kildekode."
summary: "Hent timekort fra Fonn via Fonn API og før dem i ReAI Timelister."
industry: operations
icon: icons/fonn.svg
webAppUrl: /app/fonn/
sourcePath: web/worker/apps/fonn.js
highlights:
  - "Bruker Fonn API med abonnementsnøkkel og tilgangstoken"
  - "Henter timekort for alle prosjekter eller ett prosjektnummer"
  - "Tar med timeklassifisering, notat, kunde og navn på prosjektmedlemmer"
---

## Dette overføres til ReAI

Timekort registrert i Fonn blir timelisterader i ReAI. Hver rad tar med dato, timer, timeklassifisering, notat, prosjekt og kunden på prosjektet. Prosjektmedlemmer kobles til ansatte i ReAI på navn, og du velger en ansatt som brukes når navnet ikke finnes. Radene kan knyttes til ett prosjekt i ReAI.

Ingenting bokføres i hovedboken. Timene havner i ReAI Timelister, der du godkjenner og fakturerer dem fra prosjektet som vanlig. Fonn API gir ikke tilgang til varer eller fakturagrunnlag, så bare timer hentes.

## Oppsett

1. Registrer deg på **Fonn API developer portal** (api-developer.fonn.io) med samme e-post som Fonn-brukeren din, åpne **Profile** og legg til et abonnement. Fonn aktiverer det, og **abonnementsnøkkelen** vises deretter under **Profile**.
2. Som organisasjonsadministrator i Fonn klikker du **ORGANIZATION** øverst til høyre, åpner **Integrations → API**, velger brukeren tokenet skal gjelde for og klikker **Generate token**.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg ansatt og eventuelt prosjekt.
4. Fyll inn abonnementsnøkkel og tilgangstoken. La organisasjons-ID stå tom for å finne den automatisk, og fyll inn prosjektnummer hvis organisasjonen har mange prosjekter. Velg en periode på inntil 62 dager og klikk **Fetch from Fonn API**.
5. Kontroller radene og klikk **Log hours** på dem du vil ha inn i ReAI.

Nøklene brukes bare til denne forespørselen og lagres aldri.
