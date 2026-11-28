---
title: "Integrasjon mellom Wix og regnskap"
seoTitle: "Integrasjon mellom Wix og ReAI: betalte nettbutikkordrer til regnskap"
description: "Hent betalte ordrer fra Wix og legg dem inn som ordrer i ReAI med varelinjer, frakt og MVA-sats. Gratis og åpen kildekode."
summary: "Hent betalte Wix-ordrer for en periode og legg dem inn som ordrer i ReAI."
industry: ecommerce-logistics
webAppUrl: /app/wix/
sourcePath: web/worker/apps/wix/
highlights:
  - "Leser betalte ordrer fra Wix eCommerce API med API-nøkkel og site ID"
  - "Én ordrelinje per vare og frakt, med MVA-satsen Wix beregnet"
  - "Finner eller oppretter kunden og hopper over ordrer som allerede er lagt inn"
---

## Dette kommer over i ReAI

Integrasjonen henter betalte og delvis refunderte ordrer opprettet i valgt periode, regnet i norske kalenderdager. Testordrer og arkiverte ordrer tas ikke med. Hver ordre vises med varelinjer, frakt og tilleggsgebyrer, med beløp uten MVA etter rabatt. Når du klikker **Stage in ReAI**, blir ordren en ordre i ReAI som du kontrollerer før fakturering.

| Fra Wix | I ReAI |
| --- | --- |
| Varelinje | Ordrelinje med antall, pris uten MVA og MVA-kode for satsen Wix beregnet |
| Frakt | Egen ordrelinje med fraktens MVA-sats |
| Tilleggsgebyr | Egen ordrelinje med gebyrets MVA-sats |
| Kjøper | Kunde som finnes på e-post eller navn, ellers en ny kunde |
| Ordre-ID | Ekstern referanse, slik at samme ordre ikke legges inn to ganger |

## Slik kommer du i gang

1. Åpne **API Keys Manager** i Wix-kontoen din og lag en API-nøkkel med tilgang til å lese ordrer i Wix eCommerce for nettstedet.
2. Kopier site ID fra adressen til nettstedets dashbord. Den står etter `/dashboard/`.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Lim inn site ID og API-nøkkel, velg periode og hent ordrene.
5. Kontroller linjene og legg inn ordrene du vil fakturere eller bokføre i ReAI.

Delvis refunderte ordrer merkes og legges inn med hele salget. Før refusjonen som kreditnota i ReAI.

API-nøkkelen brukes bare til denne forespørselen og lagres aldri.
