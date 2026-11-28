---
title: "Kasse dagsoppgjør (Z-rapport) til regnskap"
seoTitle: "Kasse dagsoppgjør / Z-rapport i ReAI — Amendo, Baemingo, Mystore POS m.fl."
description: "Bokfør daglige Z-rapporter fra kassasystem i ReAI med automatisk splitt på 25 %, 15 %, 12 % og 0 % MVA samt kontant, kort og Vipps."
summary: "Gjør Z-rapporten fra kassen (Amendo, Baemingo, Mystore POS m.fl.) om til et balansert bilag i ReAI på sekunder."
industry: payments
webAppUrl: /app/z-report/
sourcePath: web/worker/apps/z-report.js
highlights:
  - "Splitter automatisk brutto salg på 25 % (3000), 15 % mat (3010), 12 % (3020) og 0 % (3100)"
  - "Balanserer kontant (1900), bankterminal (1580), Vipps (1580) og gavekort (2900)"
  - "Hindrer dobbeltføring av samme Z-nummer og merker bilaget for kontroll"
---

## Slik bokføres dagsoppgjør (Z-rapport) riktig i Norge

Kassasystemloven krever at hvert dagsoppgjør bokføres oversiktlig fordelt på betalingsmidler og MVA-satser. Denne nettappen fungerer med alle norske kassasystemer—inkludert Amendo/ProTouch, Baemingo, Mystore POS, Quickorder og frittstående betalingsterminaler.

| Postering | Norsk konto | Forklaring |
| --- | --- | --- |
| Kontantkasse | `1900` (Debet) | Dagens kontantomsetning |
| Kortterminal og Vipps | `1580` (Debet) | Mellomregning frem til bankutbetaling |
| Salg 25 % / 15 % / 12 % / 0 % | `3000` / `3010` / `3020` / `3100` (Kredit) | Netto salgsinntekt beregnet automatisk |
| Utgående MVA | `2700` (Kredit) | Samlet utgående merverdiavgift |
| Solgte gavekort | `2900` (Kredit) | Forskuddsbetaling inntil innløsning |

## Steg for steg i ReAI

1. Ta ut dagens **Z-rapport** fra kassen.
2. Klikk **Åpne integrasjon**, fyll inn betalingsmåter og brutto omsetning per MVA-sats, og forhåndsvis det balanserte bilaget.
3. Kontroller at differansen er `0,00`, opprett kontrollbilaget i ReAI og legg ved Z-rapporten som vedlegg.
