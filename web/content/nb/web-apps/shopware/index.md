---
title: "Integrasjon mellom Shopware og regnskap"
seoTitle: "Integrasjon mellom Shopware 6 og ReAI: betalte ordrer til regnskap"
description: "Hent betalte ordrer fra Shopware 6 og legg dem inn som ordrer i ReAI med varelinjer, frakt og MVA-sats. Gratis og åpen kildekode."
summary: "Hent betalte Shopware-ordrer for en periode og legg dem inn som ordrer i ReAI."
industry: ecommerce-logistics
webAppUrl: /app/shopware/
sourcePath: web/worker/apps/shopware.js
highlights:
  - "Leser betalte ordrer fra Shopware Admin API med en integrasjon"
  - "Én ordrelinje per vare, rabatt og frakt, med MVA-satsen Shopware beregnet"
  - "Finner eller oppretter kunden og hopper over ordrer som allerede er lagt inn"
---

## Dette kommer over i ReAI

Integrasjonen henter ordrer med ordredato i valgt periode der betalingen har status *betalt*. Priser inklusive MVA regnes om til beløp uten MVA med skatten Shopware har beregnet per linje. Når du klikker **Stage in ReAI**, blir ordren en ordre i ReAI som du kontrollerer før fakturering.

| Fra Shopware | I ReAI |
| --- | --- |
| Varelinje og rabatt | Ordrelinje med antall, pris uten MVA og MVA-kode for satsen |
| Frakt | Egen ordrelinje med fraktens MVA-sats |
| Kunde | Kunde som finnes på e-post eller navn, ellers en ny kunde |
| Ordre-ID | Ekstern referanse, slik at samme ordre ikke legges inn to ganger |

## Slik kommer du i gang

1. Gå til **Innstillinger → System → Integrasjoner** i Shopware Administration og opprett en integrasjon med lesetilgang til ordrer.
2. Kopier **tilgangsnøkkel-ID** og **hemmelig tilgangsnøkkel**. Den hemmelige nøkkelen vises bare når integrasjonen opprettes.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Fyll inn adressen til butikken, nøklene og perioden, og hent ordrene.
5. Kontroller linjene og legg inn ordrene du vil fakturere eller bokføre i ReAI.

Nøklene brukes bare til denne forespørselen og lagres aldri.
