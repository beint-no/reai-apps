---
title: "Provet Cloud, veterinærsalg og regnskap"
seoTitle: "Provet Cloud til ReAI | Gratis integrasjon for dyreklinikker"
description: "Hent fakturaer fra Provet Cloud for en periode og lag et balansert bilag til kontroll i ReAI, med betalinger per type og salg per mva-sats."
summary: "Bokfør fakturaene fra Provet Cloud som ett bilag til kontroll i ReAI per periode: betalinger på klinikken, åpne kundesaldoer og salg per mva-sats."
industry: operations
webAppUrl: /app/provet-cloud/
sourcePath: web/worker/apps/provet-cloud/
highlights:
  - "Henter fakturaer, fakturalinjer og betalinger fra Provet Cloud REST API"
  - "Bruker OAuth 2.0 med klientnøkler som du får fra Provet"
  - "Lager et bilag du godkjenner i ReAI; nøklene lagres aldri"
---

## Dette overføres til ReAI

Appen henter utstedte fakturaer med fakturadato i perioden du velger (utkast og annullerte fakturaer tas ikke med), fakturalinjene og betalingene som er registrert på dem. Den lager ett bilag til kontroll i ReAI:

| Provet Cloud | Konto i ReAI | Mva-kode |
| --- | --- | --- |
| Kort og mobilbetaling | `1580` | 0 |
| Kontant | `1900` | 0 |
| Gavekort, verdikort og forskudd som er brukt | `2900` | 0 |
| Øreavrunding | `7790` | 0 |
| Åpne saldoer og betaling via bank, finansiering eller samlefaktura | `1570` | 0 |
| Linjer med 25 % mva, inkl. mva | `3000` | 3 |
| Linjer med 15 % mva, inkl. mva | `3010` | 31 |
| Linjer med 12 % mva, inkl. mva | `3020` | 33 |
| Linjer med 0 % mva | `3200` | 6 |

ReAI deler hver salgslinje i inntekt og utgående mva ut fra mva-koden. Kreditnotaer reduserer de samme kontoene. Betalinger som venter eller har feilet, tas ikke med. Bilaget merkes for kontroll, lages bare når fakturalinjene stemmer med fakturatotalene, og samme periode kan ikke bokføres to ganger.

## Slik kommer du i gang

1. Fyll ut skjemaet **Request Sandbox and API access** på utviklersidene til Provet og be om en integrasjon med klientnøkler (client credentials) for klinikken. Provet setter den opp og sender deg **client ID** og **client secret**.
2. Gi den virtuelle brukeren til integrasjonen tilgangen **Financial: Invoices**.
3. Kopier adressen til Provet Cloud, for eksempel `https://provetcloud.com/1234/`.
4. Åpne appen, klikk **Connect to ReAI** og velg selskap.
5. Fyll inn adresse, client ID, client secret og periode, klikk **Fetch from Provet Cloud API**, kontroller forhåndsvisningen og lag bilaget.

Klinikken må bruke NOK. Kontroller bilaget mot salgsrapporten i Provet Cloud og legg den ved i ReAI.
