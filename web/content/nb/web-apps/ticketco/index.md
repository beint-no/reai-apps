---
title: "Integrasjon mellom TicketCo og regnskap"
seoTitle: "Integrasjon mellom TicketCo og ReAI: billettsalg til regnskap"
description: "Bokfør billettsalg fra TicketCo som bilag til kontroll i ReAI, med salg per MVA-sats, gebyrer og tilgode hos TicketCo. Gratis og åpen kildekode."
summary: "Hent transaksjonene fra TicketCo for en periode eller ett arrangement og lag ett balansert bilag til kontroll i ReAI."
industry: operations
webAppUrl: /app/ticketco/
sourcePath: web/worker/apps/ticketco/
highlights:
  - "Leser billettransaksjoner fra TicketCo Public API"
  - "Fører salg inklusive MVA med riktig MVA-kode, også for avgiftsfrie billetter"
  - "Lager et bilag til kontroll som du godkjenner, med sperre mot dobbel føring"
---

## Dette kommer over i ReAI

Integrasjonen henter alle billettransaksjoner i valgt periode, eventuelt for ett arrangement, og summerer dem per MVA-sats. Refusjoner trekkes fra. Dagen regnes etter norsk tid, og bilaget dateres siste dag i perioden. Har kontoen mange transaksjoner, henter du ett arrangement om gangen. Ingenting bokføres før du har kontrollert forhåndsvisningen og opprettet bilaget.

| Linje | Konto i ReAI |
| --- | --- |
| Tilgode hos TicketCo (salg minus gebyrer) | `1580` |
| TicketCo-gebyrer | `7770`, med inngående MVA når TicketCo oppgir MVA på gebyret |
| Billettsalg uten MVA | `3100`, med kode for unntatt omsetning |
| Billettsalg med 25 %, 15 % eller 12 % MVA | `3000`, `3010` eller `3020`, ført inklusive MVA med utgående MVA-kode |

ReAI deler hvert salgsbeløp i grunnlag og MVA. Tilgodebeløpet blir stående på `1580` til utbetalingen fra TicketCo avstemmes mot banken.

## Slik kommer du i gang

1. Send en e-post til TicketCo på **cs@ticketco.net** fra e-postadressen som er knyttet til TicketCo-brukeren din, og be om en API-token med tilgang til transaksjonsdata (*item grosses*).
2. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
3. Lim inn tokenet, velg periode og eventuelt arrangement-ID, og hent transaksjonene.
4. Kontroller forhåndsvisningen mot oppgjørsrapporten i TicketCo, kryss av for bekreftelse og opprett bilaget. Legg ved rapporten i ReAI.

Tokenet brukes bare til denne forespørselen og lagres aldri.
