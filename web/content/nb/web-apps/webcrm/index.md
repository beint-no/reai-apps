---
title: "Integrasjon mellom webCRM og regnskap"
seoTitle: "webCRM leveranser til ordrer i ReAI | Gratis integrasjon"
description: "Hent leveranser fra webCRM via REST API og legg dem inn som ordreutkast i ReAI, med kunder opprettet fra organisasjonene i webCRM. Gratis og åpen kildekode."
summary: "Legg leveranser fra webCRM inn som ordrer i ReAI og opprett kundene som mangler."
industry: operations
webAppUrl: /app/webcrm/
sourcePath: web/worker/apps/webcrm/
highlights:
  - "Leser leveranser opprettet i en periode via webCRM REST API"
  - "Finner organisasjonsnummeret i MVA-nummeret fra webCRM"
  - "Legger inn hver leveranse bare én gang, med sjekk mot duplikater i ReAI"
---

## Dette kommer over i ReAI

Integrasjonen leser leveransene som er opprettet i webCRM i perioden du velger, sammen med organisasjonene de hører til. Organisasjonene sammenlignes med kundene i ReAI på organisasjonsnummer eller navn, og du oppretter de som mangler med ett klikk. Deretter kan hver leveranse legges inn som ordreutkast i ReAI.

| Fra webCRM | I ReAI |
| --- | --- |
| Organisasjon med navn, MVA-nummer og adresse | Kunde |
| Leveranse med ordreverdi og valuta | Ordreutkast med én linje |
| Leveransens id | Ekstern referanse som hindrer duplikater |

Ordreverdien brukes som pris uten MVA, og ReAI bruker kundens standard MVA-kode. Kontroller ordren før du fakturerer.

## Slik kommer du i gang

1. I webCRM går du til **Configuration → Integration → API → REST** og oppretter en applikasjonsnøkkel. API krever webCRM Plus eller Enterprise.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
3. Lim inn nøkkelen, velg periode og hent.
4. Opprett kundene som mangler, hent på nytt og klikk **Stage order** for hver leveranse.

Nøkkelen brukes bare til disse forespørslene og lagres aldri.
