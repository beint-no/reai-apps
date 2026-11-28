---
title: "Integrasjon mellom Pipedrive og regnskap"
seoTitle: "Integrasjon mellom Pipedrive og ReAI: kunder og vunne avtaler"
description: "Gjør vunne avtaler i Pipedrive om til ordreutkast i ReAI klare for fakturering, og opprett kundene som mangler. Gratis og åpen kildekode."
summary: "Opprett ordreutkast i ReAI fra vunne avtaler i Pipedrive, og kundene som mangler."
industry: operations
webAppUrl: /app/pipedrive/
sourcePath: web/worker/apps/pipedrive/
highlights:
  - "Leser vunne avtaler fra valgt dato og organisasjonene deres fra Pipedrive API med din personlige API-nøkkel"
  - "Kontrollerer norsk organisasjonsnummer før kunden opprettes i ReAI"
  - "Oppretter ordreutkast med fast ekstern referanse per avtale, så samme avtale ikke blir fakturert to ganger"
---

## Dette kommer over i ReAI

Integrasjonen henter avtalene som er vunnet fra datoen du velger, og organisasjonene de hører til. Organisasjoner som ikke finnes i ReAI med samme navn, kan du opprette som kunder etter at du har lagt inn organisasjonsnummeret. Finnes organisasjonsnummeret allerede i ReAI, opprettes ingen ny kunde. Vunne avtaler for en kjent kunde blir ordreutkast i ReAI med avtalens tittel, verdi, valuta og vinnerdato.

| Fra Pipedrive | I ReAI |
| --- | --- |
| Organisasjon | Kunde, med organisasjonsnummeret du skriver inn |
| Vunnet avtale | Ordreutkast med én linje og ekstern referanse `pipedrive-deal-<id>` |

Finnes det allerede en ordre med samme eksterne referanse, lenker integrasjonen til den i stedet for å lage en ny. Kontroller MVA-kode og beløp på ordren før du fakturerer.

## Slik kommer du i gang

1. I Pipedrive klikker du på navnet ditt øverst til høyre og går til **Company settings → Personal preferences → API**. Kopier den personlige API-nøkkelen.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
3. Lim inn nøkkelen, velg fra hvilken dato avtalene er vunnet, og klikk **Scan Pipedrive**.
4. Opprett manglende kunder og klikk **Stage order** på de vunne avtalene du vil fakturere.

Nøkkelen brukes bare til denne skanningen og lagres aldri.
