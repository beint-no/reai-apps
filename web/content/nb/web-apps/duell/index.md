---
title: "Integrasjon mellom Duell og regnskap"
seoTitle: "Integrasjon mellom Duell og ReAI: dagsoppgjør til regnskap"
description: "Bokfør dagsoppgjør fra Duell som bilag til kontroll i ReAI, med kontoene og MVA-satsene fra kontoplanen i Duell. Gratis og åpen kildekode."
summary: "Hent dagsoppgjørene fra Duell for én dag og lag ett balansert bilag til kontroll i ReAI."
industry: payments
webAppUrl: /app/duell/
sourcePath: web/worker/apps/duell/
highlights:
  - "Leser dagsoppgjør fra Duell API med avtalenummer og token"
  - "Beholder kontoene fra Duell og fører salg med riktig MVA-kode i ReAI"
  - "Lager et bilag til kontroll som du godkjenner, med sperre mot dobbel føring"
---

## Dette kommer over i ReAI

Integrasjonen henter alle dagsoppgjør (Z-rapporter) med valgt dato fra Duell API, sammen med regnskapslinjene (GBAT10). Du ser ett bilag med betalinger på debetsiden og salg per MVA-sats på kreditsiden. Ingenting bokføres før du har kontrollert forhåndsvisningen og opprettet bilaget.

| Linje | Konto i ReAI |
| --- | --- |
| Kontant, terminal, Vipps og andre betalinger | Kontoen Duell oppgir for linjen, for eksempel `1900` eller `1580` |
| Salg per MVA-sats | Salgskontoen fra Duell, ført inklusive MVA med utgående MVA-kode for 25 %, 15 % eller 12 % |
| Øreavrunding og andre linjer | Kontoen Duell oppgir |

ReAI deler hvert salgsbeløp i grunnlag og utgående MVA. Kort og Vipps blir stående på mellomkontoen til de avstemmes mot banken.

## Slik kommer du i gang

1. Gå til **System → Integrasjoner → API-oppsett** i Duell Admin og kopier **avtalenummer** og **token**. Finner du ikke menyvalget, ber du Duell support om å åpne for API.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
3. Fyll inn avtalenummer, token og dato. La avdeling stå tom for å ta med alle aktive avdelinger, eller skriv inn avdelingens id eller navn.
4. Kontroller forhåndsvisningen mot dagsoppgjøret i Duell, kryss av for bekreftelse og opprett bilaget. Legg ved PDF av dagsoppgjøret i ReAI.

Tokenet brukes bare til denne ene forespørselen og lagres aldri.
