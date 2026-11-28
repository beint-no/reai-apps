---
title: "Integrasjon mellom Nexi Checkout og regnskap"
seoTitle: "Nexi Checkout (tidligere Nets Easy) og ReAI: avstem utbetalinger"
description: "Hent utbetalingene fra Nexi Checkout for en måned og avstem dem mot banktransaksjonene i ReAI. Gratis og åpen kildekode."
summary: "Avstem utbetalinger fra Nexi Checkout, tidligere Nets Easy, mot banken i ReAI og last ned avstemmingen som CSV."
industry: payments
webAppUrl: /app/nets/
sourcePath: web/worker/apps/nets.js
highlights:
  - "Leser utbetalinger fra Nexi Checkout Reporting API med den hemmelige nøkkelen"
  - "Viser beløp, gebyr og referanse for hver utbetaling"
  - "Matcher utbetalingene mot ventende banktransaksjoner i ReAI"
---

## Dette gjør integrasjonen

Integrasjonen henter utbetalingene for valgt måned fra Nexi Checkout Reporting API. Hver utbetaling vises med dato, referanse, utbetalt beløp og gebyrene Nexi har trukket. Har du valgt en bankkonto i ReAI, matches utbetalingene mot ventende banktransaksjoner på referanse eller beløp. Ingenting bokføres. Du kan laste ned avstemmingen som CSV til månedsavslutningen.

| Postering | Vanlig konto |
| --- | --- |
| Mellomregning for kortsalg på nett | `1580` |
| Gebyrer fra Nexi | `7770` |
| Utbetaling til bank | `1920` |

## Slik kommer du i gang

1. Logg inn i Nexi Checkout portalen, åpne **Company → Integration** og kopier den hemmelige nøkkelen for live (den starter med `live-secret-key-`).
2. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
3. Lim inn nøkkelen, velg måned og eventuelt bankkonto. Merchant number trengs bare for partnernøkler.
4. Kontroller matchene og last ned CSV ved behov.

Nøkkelen brukes bare til denne ene forespørselen og lagres aldri.
