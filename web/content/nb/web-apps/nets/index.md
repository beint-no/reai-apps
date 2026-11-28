---
title: "Integrasjon mellom Nets Easy og regnskap"
seoTitle: "Nets Easy / Nexi Checkout regnskapsintegrasjon for ReAI — Gratis"
description: "Avstem utbetalinger fra Nets Easy (Nexi Checkout) mot bank i ReAI helt gratis. Guide til bokføring av nettbetaling, MVA og kortgebyrer."
summary: "Match utbetalinger fra Nets Easy / Nexi mot banktransaksjoner i ReAI og last ned ferdig avstemmings-CSV."
industry: payments
webAppUrl: /app/nets/
sourcePath: web/worker/apps/nets.js
highlights:
  - "Henter utbetalinger direkte fra Nets Easy Reporting API per måned"
  - "Matcher bankinnskudd mot referanser og beløp (±8 dager)"
  - "0 kr i månedlig integrasjonsgebyr — inkludert gratis i ReAI"
---

## Hvordan bokføres Nets Easy i regnskapet?

Nets Easy (Nexi Checkout) samler kortbetalinger og nettbetalinger i felles utbetalinger til bedriftskontoen. For å sikre ryddig avstemming etter bokføringsloven bør hver utbetaling matches mot innskuddet på konto `1920`.

| Postering | Typisk norsk konto | Forklaring |
| --- | --- | --- |
| Salgsinntekt nettbutikk | `3000` (+ MVA `2700`) | Bokføres fra ordre/faktura |
| Mellomregning Nets Easy | `1580` | Utligner tidsforskjell mellom salg og utbetaling |
| Transaksjonsgebyrer | `7770` (MVA-kode `0`) | Gebyr for betalingstjenester (unntatt MVA) |
| Utbetaling til bank | `1920` | Avstemmes mot utbetalingsrapport fra Nets |

## Slik kommer du i gang

1. Finn din **Secret API key** i Nets Easy / Nexi-portalen (med tilgang til Reporting API).
2. Klikk **Åpne integrasjon**, koble til ReAI-selskapet ditt og velg bankkonto og måned.
3. Kontroller alle matchede utbetalinger og last ned avstemmingsrapporten som dokumentasjon.
