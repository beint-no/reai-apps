---
title: "Integrasjon mellom Pleo og regnskap"
seoTitle: "Pleo regnskapsintegrasjon for ReAI — Gratis import av firmakort-utlegg"
description: "Importer månedlige utlegg fra Pleo firmakort til balanserte kontrollbilag i ReAI med automatisk motpost på kortkonto (2380)."
summary: "Gjør CSV-eksporten fra Pleo om til balanserte kontrollbilag i ReAI med riktig NS 4102-kontomapping."
industry: operations
webAppUrl: /app/pleo/
sourcePath: web/worker/apps/pleo.js
highlights:
  - "Leser Pleo sin regnskapseksport (CSV) med dato, brukersted, konto og beløp"
  - "Balanserer automatisk mot valgt mellomregningskonto for firmakort (2380)"
  - "Duplikatsjekk og ferdig kontrollmerking for regnskapsfører"
---

## Hvordan bokføres Pleo firmakort i norsk regnskap?

Kjøp med Pleo firmakort debiteres kostnadskonto (`6xxx` / `7xxx`) og krediteres en egen mellomregningskonto for Pleo (`2380` eller `1925`). Når du overfører penger fra bedriftens bankkonto (`1920`) til Pleo-lommeboken, utlignes mellomregningskontoen.

| Postering | Typisk norsk konto | Forklaring |
| --- | --- | --- |
| Programvare / reise / kontor | `6900` / `7140` / `6800` (Debet) | Hver godkjente utleggslinje fra Pleo |
| Mellomregning Pleo | `2380` (Kredit) | Utlignes mot påfylling fra bankkonto `1920` |

## Slik importerer du Pleo til ReAI

1. Eksporter godkjente utlegg som CSV fra **Pleo → Export**.
2. Klikk **Åpne integrasjon**, koble til ReAI, bekreft mellomregningskonto (`2380`) og last opp CSV-en.
3. Forhåndsvis bilaget, opprett kontrollbilaget i ReAI og legg ved kvitterings-PDF-en fra Pleo.
