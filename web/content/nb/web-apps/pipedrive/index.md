---
title: "Integrasjon mellom Pipedrive og regnskap"
seoTitle: "Integrasjon mellom Pipedrive og ReAI: kunder og vunne avtaler"
description: "Overfør organisasjoner fra Pipedrive til kunderegisteret i ReAI og gjør vunne avtaler om til ordreutkast klare for fakturering. Gratis og åpen kildekode."
summary: "Overfør organisasjoner fra Pipedrive til kunderegisteret i ReAI og opprett ordreutkast fra vunne avtaler."
industry: operations
webAppUrl: /app/pipedrive/
sourcePath: web/worker/apps/pipedrive.js
highlights:
  - "Leser organisasjoner og vunne avtaler fra Pipedrive API med din personlige API-nøkkel"
  - "Kontrollerer norsk organisasjonsnummer før kunden opprettes i ReAI"
  - "Oppretter ordreutkast med fast ekstern referanse per avtale, så samme avtale ikke blir fakturert to ganger"
---

## Dette kommer over i ReAI

Integrasjonen henter organisasjonene og de vunne avtalene i Pipedrive. Organisasjoner som ikke finnes i ReAI med samme navn, kan du opprette som kunder etter at du har lagt inn organisasjonsnummeret. Vunne avtaler for en kjent kunde blir ordreutkast i ReAI med avtalens tittel, verdi, valuta og vinnerdato.

| Fra Pipedrive | I ReAI |
| --- | --- |
| Organisasjon | Kunde, med organisasjonsnummeret du skriver inn |
| Vunnet avtale | Ordreutkast med én linje og ekstern referanse `pipedrive-deal-<id>` |

Finnes det allerede en ordre med samme eksterne referanse, lenker integrasjonen til den i stedet for å lage en ny. Kontroller MVA-kode og beløp på ordren før du fakturerer.

## Slik kommer du i gang

1. I Pipedrive klikker du på navnet ditt øverst til høyre og går til **Company settings → Personal preferences → API**. Kopier den personlige API-nøkkelen.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
3. Lim inn nøkkelen og klikk **Scan Pipedrive**.
4. Opprett manglende kunder og klikk **Stage order** på de vunne avtalene du vil fakturere.

Nøkkelen brukes bare til denne skanningen og lagres aldri.
