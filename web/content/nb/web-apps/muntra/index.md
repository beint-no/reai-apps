---
title: "Integrasjon mellom Muntra og regnskap"
seoTitle: "Muntra til ReAI | Gratis integrasjon for tannklinikker"
description: "Hent hovedboken fra Muntra for en periode og bokfør den som ett balansert bilag til kontroll i ReAI, summert per konto. Gratis og åpen kildekode."
summary: "Summer posteringene i Muntra per konto for en periode og lag ett bilag til kontroll i ReAI med pasientfakturaer, betalinger og HELFO."
industry: operations
webAppUrl: /app/muntra/
sourcePath: web/worker/apps/muntra/
highlights:
  - "Leser posteringene i Muntra API med et personlig tilgangstoken fra Muntra"
  - "Summerer per konto og lar deg koble Muntra-kontoer til kontoer i ReAI"
  - "Fører behandlingsinntekt med mva-koden for omsetning utenfor mva-loven"
---

## Dette overføres til ReAI

Muntra bokfører pasientfakturaer, betalinger, HELFO-oppgjør og gebyrer i sin egen hovedbok. Integrasjonen henter alle posteringer i perioden du velger, summerer dem per konto og lager ett balansert bilag til kontroll i ReAI, datert siste dag i perioden.

| Fra Muntra | I ReAI |
| --- | --- |
| Inntektskontoer | Samme konto med mva-kode for omsetning utenfor mva-loven |
| Kort, kontant og bank | Samme konto, eller banken som er koblet til kontoen |
| Pasientfordringer og HELFO-fordringer | Kontoen du kobler dem til, for eksempel `1570` og `1530` |
| Andre kontoer | Samme konto med mva-kode 0 |

Helsetjenester fra tannleger er unntatt fra merverdiavgift. Har Muntra ført mva på en `27xx`-konto i perioden, stopper integrasjonen, og varesalg med mva må føres for seg. Kundefordringer på `1500` krever kunde i ReAI, så koble dem til en vanlig konto. Et nytt bilag kan ikke overlappe et Muntra-bilag som allerede er bokført i ReAI.

## Slik kommer du i gang

1. Be Muntra support om et personlig tilgangstoken til Muntra API. Tokenet kan ikke lages i Muntra selv.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
3. Lim inn tokenet og velg periode. Muntra tillater opptil tre måneder per henting.
4. Klikk **Fetch from Muntra API** og se hvilke kontoer som kommer over. Skriv eventuelle koblinger som `1510=1570`, én per linje, og hent på nytt.
5. Kontroller summene mot regnskapsrapportene i Muntra, kryss av for bekreftelse og lag bilaget.

Tokenet brukes bare til disse forespørslene og lagres aldri.
