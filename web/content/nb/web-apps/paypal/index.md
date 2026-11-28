---
title: "Integrasjon mellom PayPal og regnskap"
seoTitle: "PayPal og ReAI: avstem uttak til bank"
description: "Hent uttakene fra PayPal Business til banken for en måned og avstem dem mot banktransaksjonene i ReAI. Gratis og åpen kildekode."
summary: "Avstem uttak fra PayPal Business mot banken i ReAI og last ned avstemmingen som CSV."
industry: payments
webAppUrl: /app/paypal/
sourcePath: web/worker/apps/paypal.js
highlights:
  - "Leser uttak til bank fra PayPal Transaction Search API"
  - "Bruker en egen live REST app med Transaction search slått på"
  - "Matcher uttakene mot ventende banktransaksjoner i ReAI"
---

## Dette gjør integrasjonen

Integrasjonen henter transaksjonene for valgt måned fra PayPal Transaction Search API og viser uttakene fra PayPal saldoen til bankkontoen. Har du valgt en bankkonto i ReAI, matches uttakene mot ventende banktransaksjoner på referanse eller beløp. Ingenting bokføres. Du kan laste ned avstemmingen som CSV.

| Postering | Vanlig konto |
| --- | --- |
| Saldo i PayPal | `1580` eller egen konto for PayPal |
| Gebyrer fra PayPal | `7770` |
| Uttak til bank | `1920` |

## Slik kommer du i gang

1. Logg inn på PayPal Developer Dashboard med bedriftskontoen, velg **Live** under **Apps & Credentials** og opprett en app.
2. Slå på **Transaction search** under appens funksjoner og kopier **Client ID** og **Secret**. Det kan ta noen timer før tilgangen virker.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap, måned og eventuelt bankkonto.
4. Lim inn Client ID og Secret og kontroller matchene.

Nøklene brukes bare til denne ene forespørselen og lagres aldri.
