---
title: "PsykBase Online, fakturaer og regnskap"
seoTitle: "PsykBase til ReAI | Gratis integrasjon for psykologpraksiser"
description: "Hent fakturaer fra PsykBase Online for en periode og lag et balansert bilag til kontroll i ReAI, med mva-fri behandlingsinntekt og betalinger per betalingsmåte."
summary: "Bokfør fakturaene fra PsykBase Online som ett bilag til kontroll i ReAI per periode, med mva-frie helsetjenester på mva-kode 6."
industry: operations
webAppUrl: /app/psykbase/
sourcePath: web/worker/apps/psykbase.js
highlights:
  - "Henter fakturaer og fakturalinjer fra PsykBase API med et personlig tilgangstoken"
  - "Fører mva-frie helsetjenester på 3200 med mva-kode 6"
  - "Lager et bilag du godkjenner i ReAI; tokenet lagres aldri"
---

## Dette overføres til ReAI

Appen henter fakturaer fra PsykBase med fakturadato i perioden du velger (utkast tas ikke med) og lager ett bilag til kontroll i ReAI:

| Faktura i PsykBase | Konto i ReAI | Mva-kode |
| --- | --- | --- |
| Betalt med kort eller annen betalingsmåte | `1580` | 0 |
| Betalt kontant | `1900` | 0 |
| Ubetalte fakturaer, bankoverføring og helseforsikring | `1570` | 0 |
| Behandlingslinjer uten mva | `3200` | 6 |
| Linjer med 25 % mva, inkl. mva | `3000` | 3 |
| Linjer med 15 % mva, inkl. mva | `3010` | 31 |
| Linjer med 12 % mva, inkl. mva | `3020` | 33 |

Helsetjenester fra psykologer og psykiatere er unntatt fra merverdiavgift, så behandlingsinntekten føres med mva-kode 6. Selger du også varer eller tjenester med mva, deler ReAI de linjene i inntekt og utgående mva. Bilaget merkes for kontroll, og samme periode kan ikke bokføres to ganger.

## Slik kommer du i gang

1. Gå til **Apper** i PsykBase og aktiver **API**-appen.
2. Åpne **API-innstillinger** og klikk **Create New Token** under **Personal Access Tokens**. Velg tilgangen **invoices-read** og kopier tokenet; det vises bare én gang.
3. Åpne appen, klikk **Connect to ReAI** og velg selskap.
4. Lim inn tokenet, velg periode, klikk **Fetch from PsykBase API**, kontroller forhåndsvisningen og lag bilaget.

Bare fakturaer i NOK støttes. API-et har ikke datofilter, så appen leser de nyeste fakturaene først; svært gamle perioder må kanskje deles opp. Kontroller bilaget mot regnskapsrapporten i PsykBase og legg den ved i ReAI.
