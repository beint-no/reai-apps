---
title: "Bytt til ReAI med SAF-T (Tripletex, Fiken, PowerOffice, Visma)"
description: "Flytt til ReAI med SAF-T Financial fra det gamle regnskapssystemet: importer kunder og leverandører og lagre utgående saldo som inngående balanse i ReAI."
summary: "Last opp SAF-T Financial fra det gamle systemet, importer kunder og leverandører til ReAI og lagre utgående saldo som inngående balanse."
industry: operations
webAppUrl: /app/saft/
sourcePath: web/worker/apps/saft/
highlights:
  - "Leser SAF-T Financial versjon 1.30 og 1.40"
  - "Saldo på kunder og leverandører føres per kunde og leverandør"
  - "Kontrollerer at balansen går i null før noe lagres"
---

## Slik fungerer det

Alle norske regnskapssystemer kan eksportere SAF-T Financial. Verktøyet leser filen og viser utgående saldo per konto og kundene og leverandørene i filen.

| Steg | ReAI API |
| --- | --- |
| Importer kunder og leverandører som ikke finnes i ReAI, funnet på nummer, organisasjonsnummer eller navn | `POST /api/customers`, `POST /api/suppliers` |
| Lagre utgående saldo på balansekontoene som inngående balanse, datert siste dag i perioden filen gjelder | `PUT /api/opening-balance` |

## Kom i gang

1. Eksporter SAF-T Financial for siste avsluttede år fra det gamle systemet. Avslutt året først, slik at resultatet er overført til egenkapitalen.
2. Koble til selskapet ditt i ReAI over og last opp filen.
3. Klikk **Import missing customers and suppliers** til alle er importert.
4. Klikk **Save opening balance in ReAI**.

## Greit å vite

- Kontoene for kunder og leverandører føres per kunde og leverandør med saldoene i filen.
- Bankkontoer føres på bankkontoen i ReAI som bruker samme hovedbokskonto. Registrer driftsmidler i ReAI først.
- Kontoer som ikke er firesifrede kontoer etter NS 4102 listes opp, slik at du kan føre dem manuelt.
- En eksisterende inngående balanse i ReAI erstattes bare når du krysser av for det.
