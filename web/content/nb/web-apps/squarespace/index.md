---
title: "Integrasjon mellom Squarespace og regnskap"
seoTitle: "Integrasjon mellom Squarespace og ReAI: nettbutikkordrer til regnskap"
description: "Hent ordrer fra Squarespace Commerce og legg dem inn som ordrer i ReAI med varelinjer, frakt og MVA. Gratis og åpen kildekode."
summary: "Hent Squarespace-ordrer for en periode og legg dem inn som ordrer i ReAI."
industry: ecommerce-logistics
webAppUrl: /app/squarespace/
sourcePath: web/worker/apps/squarespace.js
highlights:
  - "Leser ordrer fra Squarespace Orders API med en API-nøkkel"
  - "Én ordrelinje per vare, frakt og rabatt, med beløp uten MVA"
  - "Finner eller oppretter kunden og hopper over ordrer som allerede er lagt inn"
---

## Dette kommer over i ReAI

Integrasjonen henter ordrer opprettet i valgt periode. Kansellerte ordrer tas ikke med. Squarespace oppgir MVA samlet per ordre, så integrasjonen regner ut ordrens sats og bruker den på alle linjene når den er 25, 15, 12 eller 0 prosent. Ellers får linjene standard MVA-kode i ReAI. Når du klikker **Stage in ReAI**, blir ordren en ordre i ReAI som du kontrollerer før fakturering.

| Fra Squarespace | I ReAI |
| --- | --- |
| Varelinje | Ordrelinje med antall og pris uten MVA |
| Frakt og rabatt | Egne ordrelinjer |
| Kjøper | Kunde som finnes på e-post eller navn, ellers en ny kunde |
| Ordre-ID | Ekstern referanse, slik at samme ordre ikke legges inn to ganger |

## Slik kommer du i gang

1. Gå til **Settings → Advanced → Developer API Keys** i Squarespace, klikk **Generate Key** og gi nøkkelen tillatelsen **Orders**. API-nøkler for utviklere krever en Commerce-plan.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
3. Lim inn API-nøkkelen, velg periode og hent ordrene.
4. Kontroller linjene og MVA-satsen, og legg inn ordrene du vil fakturere eller bokføre i ReAI.

API-nøkkelen brukes bare til denne forespørselen og lagres aldri.
