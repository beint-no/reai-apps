---
title: "Integrasjon mellom PayPal og regnskap"
seoTitle: "PayPal regnskapsintegrasjon for ReAI — Gratis utbetalingsavstemming"
description: "Avstem PayPal Business-utbetalinger mot bank i ReAI helt gratis. Slik bokfører du PayPal-salg, valutagebyrer og overføringer riktig i Norge."
summary: "Hent utbetalinger fra PayPal Business via Reporting API og match dem automatisk mot banktransaksjoner i ReAI."
industry: payments
icon: icons/paypal.svg
webAppUrl: /app/paypal/
sourcePath: web/worker/apps/paypal.js
highlights:
  - "Kobler direkte til PayPal REST Reporting API per måned"
  - "Viser utbetalinger og gebyrer side om side med banktransaksjoner i ReAI"
  - "Inkludert gratis i ReAI — ingen nøkler lagres i database"
---

## Hvordan føres PayPal i norsk regnskap?

En PayPal Business-konto fungerer som en egen oppgjørskonto der kundebetalinger kommer inn, PayPal trekker gebyrer, og nettobeløpet overføres til bedriftens bankkonto (`1920`).

| Postering | Typisk norsk konto | Forklaring |
| --- | --- | --- |
| Mellomregning / PayPal-saldo | `1930` / `1580` | Viser innestående saldo hos PayPal |
| PayPal-gebyr | `7770` (MVA-kode `0`) | Transaksjons- og valutagebyr |
| Overføring til bank | `1920` | Avstemmes mot utbetalinger fra PayPal |

## Slik gjør du det i ReAI

1. Opprett en REST-app i **PayPal Developer Dashboard** med *Transaction Search* aktivert og kopier Client ID og Secret.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg bankkonto og måned.
3. Kontroller treffene mot banken og last ned CSV-rapporten som bilagsdokumentasjon.
