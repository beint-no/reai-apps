---
title: "Integrasjon mellom ExtendaGO og regnskap"
seoTitle: "Integrasjon mellom ExtendaGO og ReAI: GBAT10 til regnskap"
description: "Bokfør den daglige GBAT10-filen fra ExtendaGO som bilag til kontroll i ReAI, med kontoene og MVA-kodene fra ExtendaGO. Gratis og åpen kildekode."
summary: "Last opp den daglige GBAT10-filen fra ExtendaGO og lag ett balansert bilag til kontroll i ReAI."
industry: payments
webAppUrl: /app/extendago/
sourcePath: web/worker/apps/extendago/
highlights:
  - "Leser GBAT10-filen som ExtendaGO leverer til SFTP hver natt"
  - "Beholder kontoene og MVA-kodene fra regnskapsoppsettet i ExtendaGO"
  - "Lager et bilag til kontroll som du godkjenner, med sperre mot dobbel føring"
---

## Dette kommer over i ReAI

ExtendaGO lager én GBAT10-fil per dag med betalinger per betalingsmåte og omsetning per MVA-sats. Integrasjonen viser ett bilag med betalinger på debetsiden og omsetning på kreditsiden. Ingenting bokføres før du har kontrollert forhåndsvisningen og opprettet bilaget.

| Linje | Konto i ReAI |
| --- | --- |
| Betalinger | Kontoen satt for betalingsmåten i ExtendaGO |
| Omsetning per MVA-sats | Kontoen og MVA-koden satt for satsen i ExtendaGO, ført inklusive MVA |
| Avvik | Avvikskontoen satt i ExtendaGO |

MVA-kodene i ExtendaGO må være utgående MVA-koder i ReAI, for eksempel `3` for 25 %.

## Slik kommer du i gang

1. Gå til **Settings → Integrations → Accounting** i ExtendaGO og fyll inn SFTP-serveren filen skal leveres til.
2. Sett konto for hver betalingsmåte, konto og MVA-kode for hver MVA-sats, avdelingsnummer for butikken og en avvikskonto.
3. Hent filen for dagen fra SFTP-serveren.
4. Klikk **Åpne integrasjon**, koble til ReAI, velg selskap og last opp filen.
5. Kontroller forhåndsvisningen mot Z-rapporten, kryss av for bekreftelse og opprett bilaget.
