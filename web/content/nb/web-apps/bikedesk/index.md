---
title: "Integrasjon mellom Bikedesk og regnskap"
seoTitle: "Integrasjon mellom Bikedesk og ReAI: dagsoppgjør til regnskap"
description: "Bokfør dagsoppgjør fra Bikedesk (Customers 1st) som bilag til kontroll i ReAI, med betalinger per betalingsmåte og salg per MVA-sats. Gratis og åpen kildekode."
summary: "Hent kasseoppgjørene fra Bikedesk for én dag og lag ett balansert bilag til kontroll i ReAI."
industry: payments
webAppUrl: /app/bikedesk/
sourcePath: web/worker/apps/bikedesk/
highlights:
  - "Leser kasseoppgjør fra Customers 1st API med en API-bruker"
  - "Beholder kontoene fra Bikedesk og fører salg med riktig MVA-kode i ReAI"
  - "Lager et bilag til kontroll som du godkjenner, med sperre mot dobbel føring"
---

## Dette kommer over i ReAI

Integrasjonen henter alle kasseoppgjør (Z-rapporter) med valgt dato fra Bikedesk, som bygger på Customers 1st. Du ser ett bilag med betalinger per betalingsmåte på debetsiden og salg per MVA-sats på kreditsiden. Ingenting bokføres før du har kontrollert forhåndsvisningen og opprettet bilaget.

| Linje | Konto i ReAI |
| --- | --- |
| Kontant | Kontoen på betalingsmåten i Bikedesk, ellers `1900` |
| Kort, Vipps og andre betalinger | Kontoen på betalingsmåten, ellers `1580` |
| Betaling med gavekort og solgte gavekort | Kontoen på betalingsmåten, ellers `2900` |
| Salg per MVA-sats | Salgskontoen fra Bikedesk, ellers `3000`, `3010`, `3020` eller `3100`, ført inklusive MVA med utgående MVA-kode |
| Øreavrunding | `7990` |

Kassedifferansen vises i forhåndsvisningen, men bokføres ikke. Går ikke betalinger og salg opp, for eksempel fordi kunder har betalt faktura i kassen, fører du dagen manuelt fra oppgjørsrapporten.

## Slik kommer du i gang

1. Logg inn på app.c1st.com, gå til **Settings → API → API users**, opprett en API-bruker for ReAI og kopier tokenet.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
3. Fyll inn token og dato. La kasse stå tom for å ta med alle kasser.
4. Kontroller forhåndsvisningen mot oppgjørsrapporten, kryss av for bekreftelse og opprett bilaget.

Tokenet brukes bare til denne ene forespørselen og lagres aldri.
