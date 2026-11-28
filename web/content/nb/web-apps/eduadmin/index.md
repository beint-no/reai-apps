---
title: "Integrasjon mellom EduAdmin og regnskap"
seoTitle: "EduAdmin kursbestillinger til ReAI | Gratis integrasjon"
description: "Hent kursbestillinger som ikke er fakturert fra EduAdmin via API og lag ordre i ReAI med kursrader, priser og MVA fra EduAdmin. Gratis og åpen kildekode."
summary: "Gjør bekreftede EduAdmin-bestillinger om til ordre i ReAI, klare til fakturering."
industry: operations
webAppUrl: /app/eduadmin/
sourcePath: web/worker/apps/eduadmin/
highlights:
  - "Leser bestillinger fra EduAdmin API med en API-bruker"
  - "Tar med kursrader, rabatt og MVA-sats fra EduAdmin"
  - "Markerer bestillingen som fakturert i EduAdmin når ordren er laget"
---

## Dette kommer over i ReAI

Integrasjonen henter bekreftede bestillinger i perioden du velger, som ikke er fakturert ennå. Hver bestilling blir én ordre i ReAI for kunden i EduAdmin, med én linje per fakturerbar ordrerad. Du fakturerer ordren fra ReAI som vanlig.

| Fra EduAdmin | I ReAI |
| --- | --- |
| Bestilling | Ordre med referanse til bestillingen |
| Kunde | Eksisterende kunde funnet på organisasjonsnummer eller e-post, ellers ny kunde |
| Ordrerad | Ordrelinje uten MVA, med MVA-kode for satsen |

Kurs er ofte unntatt MVA. Rader uten MVA får MVA-koden du velger før du henter. Bestillinger der radene ikke stemmer med totalsummen, for eksempel på grunn av en rabattkode, vises, men må rettes i EduAdmin først.

## Slik kommer du i gang

1. Opprett en API-bruker i EduAdmin. Spør EduAdmin support hvis du ikke finner valget.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
3. Skriv inn brukernavn og passord for API-brukeren, velg periode og MVA-kode for rader uten MVA, og hent bestillingene.
4. Kontroller kunde, rader og beløp, og klikk **Stage order in ReAI** for hver bestilling.
5. Fakturer ordrene i ReAI.

Passordet brukes bare til å hente en tilgangsnøkkel for disse forespørslene og lagres aldri.
