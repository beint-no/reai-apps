---
title: "Integrasjon mellom SpeedyCraft og regnskap"
seoTitle: "SpeedyCraft arbeidsordrer til ReAI Timelister og ordrer"
description: "Hent timer og varer fra SpeedyCraft, før timene i ReAI Timelister og legg hver arbeidsordre klar som ordreutkast i ReAI. Gratis og åpen kildekode."
summary: "Hent timer og varer på arbeidsordrer fra SpeedyCraft REST API til timelister og ordreutkast i ReAI."
industry: operations
icon: icons/speedycraft.svg
webAppUrl: /app/speedycraft/
sourcePath: web/worker/apps/speedycraft.js
highlights:
  - "Bruker SpeedyCraft REST API med tilgang du får fra Devinco"
  - "Fører timer per ansatt og hopper over avviste timer"
  - "Lager ett ordreutkast per arbeidsordre med timer og varer eks. mva."
---

## Dette overføres til ReAI

Integrasjonen leser timer (AssignmentService) og varer (AssignmentProduct) registrert i valgt periode, sammen med arbeidsordren, kunden og den ansatte de hører til.

* **Timer** blir timelisterader i ReAI. Timetyper som SpeedyCraft holder utenfor timesummen, for eksempel kjøring og tilleggskostnader, og fraværstyper føres ikke som timer.
* **Fakturagrunnlag** blir ett ordreutkast i ReAI per arbeidsordre. Beløpet er antall ganger kundepris minus rabatt for timer og varer, eks. mva. Ordren får arbeidsordrenummeret som ekstern referanse, så samme arbeidsordre åpner det eksisterende utkastet i stedet for å lage et nytt.

Ingenting faktureres eller bokføres automatisk. Du kontrollerer og fakturerer hvert ordreutkast i ReAI, der salgskonto og mva-kode settes.

## Oppsett

1. SpeedyCraft må kjøre i Devincos sky. Send e-post til **support@devinco.com** og be om API-tilgang for firmaet: **subjectId** og **API-nøkkel** for brukeren som skal kjøre integrasjonen, og **klient-ID** (GUID) for SpeedyCraft-klienten. Devinco avgjør om tilgangen koster noe.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg kunde, ansatt og eventuelt prosjekt.
3. Fyll inn de tre verdiene fra Devinco, velg periode og klikk **Fetch from SpeedyCraft API**.
4. Klikk **Log hours** og **Stage draft order** på radene du vil ha med.

Opplysningene brukes bare til denne forespørselen og lagres aldri.
