---
title: "Integrasjon mellom Ordrestyring og regnskap"
seoTitle: "Ordrestyring timer og varer til ReAI Timelister og ordrer"
description: "Hent ufakturerte timer og varer fra Ordrestyring, før timene i ReAI Timelister og legg hver sak klar som ordreutkast i ReAI. Gratis og åpen kildekode."
summary: "Hent timer og varer på saker fra Ordrestyring GraphQL API til timelister og ordreutkast i ReAI."
industry: operations
webAppUrl: /app/ordrestyring/
sourcePath: web/worker/apps/ordrestyring/
highlights:
  - "Bruker Ordrestyring GraphQL API med API-token fra Ordrestyring"
  - "Fører ufakturerte timer per ansatt og hopper over avviste timer"
  - "Lager ett ordreutkast per sak med timer, varer og andre utlegg eks. mva."
---

## Dette overføres til ReAI

Integrasjonen leser timer som ikke er fakturert i Ordrestyring, med starttid i valgt periode, og varer og andre utlegg lagt til på sakene i samme periode.

* **Timer** blir timelisterader i ReAI med timetype, beskrivelse og sak. Ansatte kobles til ansatte i ReAI på navn, og du velger en ansatt som brukes når navnet ikke finnes. Avviste timer tas ikke med.
* **Fakturagrunnlag** blir ett ordreutkast i ReAI per sak: salgsprisen for timene pluss summen av varer og andre utlegg, eks. mva. Linjer som allerede ligger i et fakturautkast i Ordrestyring, tas ikke med. Ordren får saksnummeret som ekstern referanse, så samme sak åpner det eksisterende utkastet i stedet for å lage et nytt.

Ingenting faktureres eller bokføres automatisk. Du kontrollerer og fakturerer hvert ordreutkast i ReAI, der salgskonto og mva-kode settes.

## Oppsett

1. Be **Ordrestyring support** om et API-token for firmaet.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg kunde, ansatt og eventuelt prosjekt.
3. Velg **Norway** eller **Denmark** etter hvor Ordrestyring-kontoen ligger, lim inn tokenet, velg periode og klikk **Fetch from Ordrestyring API**.
4. Klikk **Log hours** og **Stage draft order** på radene du vil ha med.

Tokenet brukes bare til denne forespørselen og lagres aldri.
