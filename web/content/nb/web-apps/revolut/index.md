---
title: "Integrasjon mellom Revolut Business og regnskap"
seoTitle: "Integrasjon mellom Revolut Business og ReAI: kortkjøp til regnskap"
description: "Hent kortkjøp og gebyrer fra Revolut Business API og lag ett bilag til kontroll i ReAI mot bankkontoen for Revolut. Gratis og åpen kildekode."
summary: "Hent fullførte kortkjøp i NOK fra Revolut Business for en periode og lag ett balansert bilag til kontroll i ReAI."
industry: operations
webAppUrl: /app/revolut/
sourcePath: web/worker/apps/revolut.js
highlights:
  - "Leser kortkjøp og gebyrer fra Revolut Business API med din egen API-nøkkel"
  - "Fører gebyrer på konto 7770 og kortkjøp på kostnadskontoen du velger"
  - "Lager et bilag til kontroll med sperre mot dobbel føring"
---

## Dette kommer over i ReAI

Integrasjonen henter fullførte kortkjøp og gebyrer i NOK for perioden du velger. Hvert kjøp føres på kostnadskontoen du oppgir, og hvert gebyr på `7770`. Motposten er kontoen for Revolut-kontoen i ReAI, for eksempel `1925`.

| Linje | Konto i ReAI |
| --- | --- |
| Kortkjøp | Kostnadskontoen du velger, for eksempel `6800` |
| Gebyr fra Revolut | `7770` |
| Motpost | Kontoen for Revolut-kontoen, for eksempel `1925` |

Linjene føres uten MVA. Sett riktig MVA-kode i ReAI når du legger ved kvitteringen, for eksempel omvendt avgiftsplikt for tjenester kjøpt fra utlandet. Transaksjoner i andre valutaer enn NOK hoppes over.

## Slik kommer du i gang

1. Åpne API-konsollet på **developer.revolut.com/console**, velg **API keys** og klikk **New**. Gi nøkkelen tilgangen **Accounts → Transactions → Read**.
2. Lagre API-nøkkelen og den private signeringsnøkkelen (`private.pem`) som konsollet lager.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Lim inn API-nøkkelen og innholdet i `private.pem`, velg periode og kontoer, og hent transaksjonene.
5. Kontroller forhåndsvisningen, kryss av for bekreftelse og opprett bilaget.

Nøklene brukes bare til denne ene forespørselen og lagres aldri.
