---
title: "Integrasjon mellom Timma salong og regnskap"
seoTitle: "Timma salong og booking til ReAI regnskap — Gratis integrasjon"
description: "Bokfør oppgjørsrapporter fra Timma frisør, skjønnhet og velvære i ReAI med riktig splitt på 25 % behandling/varesalg, 0 % helse og bookinggebyrer."
summary: "Importer oppgjørsrapporter fra Timma salong og booking i ReAI med automatisk splitt på 25 % salg, 0 % helse og gebyrer."
industry: operations
webAppUrl: /app/timma/
sourcePath: web/worker/apps/timma.js
highlights:
  - "Skiller avgiftsfrie helsetjenester (3100) fra avgiftspliktig behandling og varesalg (3000 + 2700)"
  - "Bokfører kort- og bookinggebyrer ryddig på konto 7770"
  - "Oppretter balansert månedlig kontrollbilag klart for regnskapsfører"
---

## Riktig regnskap for salonger, klinikker og terapeuter

Systemer som **Timma**, **Fresha**, **Fixit**, **Hano**, **Physica** og **Aspit** blander ofte MVA-unntatte helsetjenester (`3100`) med 25 % avgiftspliktige behandlinger og varesalg (`3000`) i samme utbetaling.

| Postering | Typisk norsk konto | Forklaring |
| --- | --- | --- |
| Netto oppgjør / mellomregning | `1580` (Debet) | Avstemmes mot utbetaling på bankkonto `1920` |
| Booking- og kortgebyr | `7770` (Debet, MVA `0`) | Gebyr trukket fra utbetalingen |
| Helsetjenester unntatt MVA | `3100` (Kredit) | Unntatt etter mval. § 3-2 |
| Avgiftspliktig salg 25 % | `3000` + `2700` (Kredit) | Netto omsetning + utgående MVA |

## Slik gjør du det i ReAI

1. Eksporter månedlig oppgjørsrapport som CSV fra Timma, Fresha, Fixit eller klinikkjournalsystemet ditt.
2. Klikk **Åpne integrasjon**, koble til ReAI og last opp filen (eller prøv testrapporten med ett klikk).
3. Kontroller posteringene og opprett kontrollbilaget i ReAI.
