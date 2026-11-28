---
title: "Integrasjon mellom Proresult og regnskap"
seoTitle: "Proresult timerapporter til ReAI Timelister og ordrer"
description: "Importer en timerapport fra Proresult, før timene i ReAI Timelister og legg ufakturerte timer klar som ordreutkast per prosjekt. Gratis og åpen kildekode."
summary: "Importer rapporten Timelister egendefinert fra Proresult til timelister og ordreutkast i ReAI."
industry: operations
webAppUrl: /app/proresult/
sourcePath: web/worker/apps/proresult.js
highlights:
  - "Leser timerapporten Timelister egendefinert lagret som CSV"
  - "Fører timer per ansatt med timetype, prosjekt og kommentar"
  - "Lager ett ordreutkast per prosjekt og måned av ufakturerte timer ganger timetypepris"
---

## Dette overføres til ReAI

Proresult har ikke et API som kunder kan bruke, så integrasjonen leser timerapporten **Timelister egendefinert**.

* **Timer** blir timelisterader i ReAI. Ansatte kobles til ansatte i ReAI på navn, og du velger en ansatt som brukes når navnet ikke finnes.
* **Fakturagrunnlag**: rader som ikke er merket **Fakturert**, prises med **Timetype-pris** og summeres til ett ordreutkast i ReAI per prosjekt og måned. Ordren får prosjekt og måned som ekstern referanse, så samme prosjektmåned legges aldri inn to ganger.

Ingenting faktureres eller bokføres automatisk. Du kontrollerer og fakturerer hvert ordreutkast i ReAI, der salgskonto og mva-kode settes. Fakturagrunnlag som Proresult allerede sender til et annet regnskapssystem, skal ikke legges inn på nytt her.

## Oppsett

1. Åpne **Rapporter → Timer → Timelister egendefinert** i Proresult.
2. Velg kolonnene **Dato**, **Prosjektnummer**, **Prosjekt**, **Kunde**, **Ansatt**, **Timetype**, **Timetype-pris**, **Kommentar** og **Fakturert**, la timene være synlige og velg periode.
3. Lagre rapporten som Excel, åpne filen og lagre arket som CSV.
4. Klikk **Åpne integrasjon**, koble til ReAI, velg kunde, ansatt og eventuelt prosjekt, og last opp filen.
5. Klikk **Log hours** og **Stage draft order** på radene du vil ha med.

Filen leses bare for forhåndsvisningen og lagres aldri.
