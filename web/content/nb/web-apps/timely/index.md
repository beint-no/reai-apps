---
title: "Timely og regnskap"
seoTitle: "Timely timeregistrering til ReAI Timelister"
description: "Hent registrerte timer fra Timely med din egen OAuth-app og før dem inn i ReAI Timelister per ansatt og prosjekt."
summary: "Godkjenn din egen Timely-app, hent timer for en periode og før dem inn i ReAI Timelister."
industry: operations
webAppUrl: /app/timely/
sourcePath: web/worker/apps/timely/
highlights:
  - "Bruker Timely sitt API med en OAuth-app du lager selv i Timely"
  - "Matcher personer på e-post eller navn og prosjekter på navn"
  - "Før inn én og én linje eller alle matchede linjer etter kontroll"
---

## Dette overføres til ReAI

Registrerte timer i Timely blir timeføringer i ReAI med dato, timer, ansatt, prosjekt og en kommentar med prosjekt og notat fra Timely. Personer matches mot ansatte i ReAI på e-post eller navn, og prosjekter på navn. Utkast og slettede føringer hoppes over.

Timeføringer er ikke bilag. De brukes til prosjektfakturering og lønnsgrunnlag i ReAI, der du godkjenner dem som vanlig.

## Oppsett

1. Som administrator i Timely går du til **Settings → Devs** og legger til en applikasjon. Sett redirect URI til `https://apps.reai.no/app/timely/`.
2. Klikk **Åpne integrasjon** og koble til selskapet ditt i ReAI.
3. Fyll inn applikasjons-ID og konto-ID i Timely (tallet i `app.timelyapp.com/<id>/`), lag godkjenningslenken og godkjenn tilgangen i Timely.
4. Tilbake på siden fyller du inn hemmeligheten (secret) og perioden, og henter timene. Koden fra Timely kan brukes én gang, så du godkjenner på nytt ved neste henting.
5. Kontroller føringene og før dem inn i ReAI Timelister.

Hemmeligheten og tokenet brukes til én forespørsel og lagres aldri.
