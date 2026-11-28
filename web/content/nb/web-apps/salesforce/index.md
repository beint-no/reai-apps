---
title: "Integrasjon mellom Salesforce og regnskap"
seoTitle: "Integrasjon mellom Salesforce og ReAI: vunne salgsmuligheter til fakturering"
description: "Hent vunne salgsmuligheter fra Salesforce og legg dem inn som ordrer i ReAI med produktene og kontoen som kunde. Gratis og åpen kildekode."
summary: "Hent salgsmuligheter med status Closed Won og legg dem inn som ordrer i ReAI."
industry: operations
webAppUrl: /app/salesforce/
sourcePath: web/worker/apps/salesforce/
highlights:
  - "Leser vunne salgsmuligheter fra Salesforce REST API med client credentials"
  - "Én ordrelinje per produkt på salgsmuligheten, ellers beløpet"
  - "Finner kunden på organisasjonsnummer eller navn, og hopper over salgsmuligheter som allerede er lagt inn"
---

## Dette kommer over i ReAI

Integrasjonen henter salgsmuligheter som er vunnet (*Closed Won*) med avslutningsdato i valgt periode. Når du klikker **Stage in ReAI**, blir salgsmuligheten en ordre i ReAI som du kontrollerer før fakturering.

| Fra Salesforce | I ReAI |
| --- | --- |
| Produkter på salgsmuligheten | Ordrelinjer med antall og totalpris, med standard MVA-kode |
| Beløp, når det ikke finnes produkter | Én ordrelinje |
| Konto | Kunde som finnes på organisasjonsnummer eller navn, ellers en ny bedriftskunde |
| Salgsmulighetens ID | Ekstern referanse, slik at den ikke legges inn to ganger |

Salesforce har ikke noe standardfelt for organisasjonsnummer. Har dere et eget felt på kontoen, skriver du API-navnet, for eksempel `Organisasjonsnummer__c`.

## Slik kommer du i gang

1. Opprett en external client app (eller connected app) under **Setup** i Salesforce med OAuth-omfanget **api**.
2. Slå på **Enable Client Credentials Flow** i OAuth-innstillingene og velg en bruker under **Run As** med lesetilgang til salgsmuligheter og kontoer.
3. Kopier **Consumer Key** og **Consumer Secret**, og finn My Domain-adressen under **Setup → My Domain**.
4. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
5. Fyll inn adressen, nøklene og perioden, og hent salgsmulighetene. Har Salesforce flere valutaer, brukes valutaen på hver salgsmulighet. Ellers fyller du inn valutaen dere bruker.
6. Kontroller linjene og legg inn ordrene du vil fakturere.

Nøklene brukes bare til denne forespørselen og lagres aldri.
