---
title: "Integrasjon mellom Handyman og regnskap"
seoTitle: "Handyman serviceordrer til ReAI | Gratis integrasjon"
description: "Hent fullførte serviceordrer med timer og materiell fra Handyman API og legg dem inn som ordrer og timer i ReAI."
summary: "Hent fullførte serviceordrer fra Handyman API og legg dem inn som ordrer og timer i ReAI."
industry: operations
webAppUrl: /app/handyman/
sourcePath: web/worker/apps/handyman/
highlights:
  - "Bruker Handyman API på deres egen Handyman-server"
  - "Summerer timer, arbeid og materiell per fullført ordre"
  - "Fastpris på ordren brukes når den er satt"
---

## Overfør serviceordrer fra Handyman til ReAI

Handyman fra GSGroup har et REST API som kjører på kundens egen Handyman-server. Integrasjonen henter ordrer som er fullført i perioden, summerer timer fra lønnsarter med enhet timer, og regner ordreverdien ut fra kundepris på arbeid og materiell eller fra fastprisen. Du kan legge ordren inn som ordre i ReAI og føre timene på en ansatt.

## Slik setter du opp Handyman mot ReAI

1. Åpne **Handyman ControlCenter**, gå til fanen **Integration**, skriv inn en API-nøkkel og et navn for integrasjonen og klikk **Apply**.
2. Installer og start tjenesten **HandymanAPI** under **Services** som beskrevet i [GSGroup support](https://support.gsgroup.no/hc/en-us/articles/17674524711441).
3. Be IT-partneren deres gjøre API-et tilgjengelig over https fra internett med et eget sertifikat, se [veiledningen for ekstern tilgang](https://support.gsgroup.no/hc/en-us/articles/17762953047953).
4. Klikk **Åpne integrasjon**, koble til ReAI og legg inn https-adressen til API-et, API-nøkkelen og klientnummeret fra ControlCenter.
5. Kontroller ordrene og klikk **Stage order** eller **Log hours**.
