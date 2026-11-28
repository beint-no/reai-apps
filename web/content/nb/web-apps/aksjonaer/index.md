---
title: "Aksjeinvesteringer fra CSV"
seoTitle: "Aksjeinvesteringer fra CSV til ReAI | Gratis integrasjon med åpen kildekode"
description: "Registrer aksjebeholdninger fra en porteføljefil i ReAI aksjeinvesteringer, koblet til verdipapirregisteret i ReAI med ISIN."
summary: "Registrer aksjebeholdninger fra en porteføljefil i ReAI og se beholdningene som allerede ligger der."
industry: operations
webAppUrl: /app/aksjonaer/
sourcePath: web/worker/apps/aksjonaer/
highlights:
  - "Kobler hver beholdning til verdipapirregisteret i ReAI med ISIN"
  - "Hopper over beholdninger som allerede finnes i ReAI"
  - "Fritaksmetoden settes bare når filen sier det"
---

## Dette overføres til ReAI

Appen leser en CSV med én rad per beholdning og registrerer den i ReAI under aksjeinvesteringer:

| Kolonne i filen | I ReAI |
| --- | --- |
| Navn (påkrevd) | Navn på beholdningen |
| ISIN | Kobles til verdipapirregisteret i ReAI |
| Type: børsnotert, unotert, fond, obligasjon eller annet | Instrumenttype, trengs når ISIN mangler i registeret |
| Konto | Balansekonto, for eksempel `1350` eller `1810` |
| Antall, kostpris og dato | Inngående beholdning |
| Fritak: ja eller nei | Innenfor fritaksmetoden; tom betyr ikke vurdert |

Beholdninger med samme ISIN, eller samme navn uten ISIN, som allerede finnes i ReAI blir ikke registrert på nytt. Appen lager ingen bilag.

## Slik kommer du i gang

1. Lag en CSV med kolonnene over. Tall kan ha komma eller punktum som desimaltegn.
2. Åpne appen, klikk **Connect to ReAI** og velg selskap.
3. Last opp filen, kontroller forhåndsvisningen og klikk **Register** for hver beholdning.

Transaksjoner fra Nordnet importerer du i ReAI under aksjeinvesteringer. Kontroller fritaksmetoden for hver beholdning før salg eller utbytte.
