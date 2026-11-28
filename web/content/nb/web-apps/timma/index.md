---
title: "Integrasjon for booking, salong og klinikk (Timma / Fresha / Aspit)"
seoTitle: "Timma, Fresha, Fixit & klinikk regnskapsintegrasjon for ReAI — Gratis"
description: "Bokfør oppgjørsrapporter fra Timma, Fresha, Fixit, Hano, Physica og Aspit i ReAI med riktig splitt mellom avgiftsfrie helsetjenester (3100) og 25 % varesalg (3000)."
summary: "Importer oppgjørsrapport fra bookingsystem eller journalsystem med automatisk splitt på 0 % helse og 25 % salg."
industry: operations
icon: icons/timma.svg
webAppUrl: /app/timma/
sourcePath: web/worker/apps/billing.js
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
