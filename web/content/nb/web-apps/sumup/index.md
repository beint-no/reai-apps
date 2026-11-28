---
title: Integrasjon mellom SumUp og regnskap
seoTitle: "Integrasjon mellom SumUp og ReAI: avstemming av utbetalinger"
description: Koble SumUp-betalingsterminal til ReAI regnskap gratis. Avstem utbetalinger og kortgebyrer mot banktransaksjoner og eksporter CSV.
summary: Sammenlign utbetalinger og kortgebyrer fra SumUp mot uavstemte banktransaksjoner i ReAI.
industry: payments
webAppUrl: /app/sumup/
sourcePath: web/worker/apps/sumup/
highlights:
  - "Henter utbetalinger direkte fra SumUp Payouts API med forhandlerkode og API-nøkkel"
  - "Viser netto utbetaling og trukket SumUp-gebyr sammen med banklinjer i ReAI"
  - "Eksporterer ferdig avstemmings-CSV til månedlig regnskapskontroll"
---

## Dette kommer over i ReAI

Integrasjonen henter alle vellykkede utbetalinger fra SumUp for én måned og matcher dem mot uavstemte banktransaksjoner i ReAI på beløp, dato og referanse. Trekk for refusjoner og tilbakeføringer vises som en egen merknad. Du får en CSV-rapport som dokumentasjon. Ingenting bokføres.

SumUp trekker kortgebyret før pengene utbetales. Brutto omsetning, kortgebyr (`7770`, MVA-kode `0`) og netto innskudd på bank føres hver for seg.

## Slik kommer du i gang

1. Logg inn på **me.sumup.com**, åpne profilen og gå til **Settings → For Developers → Toolkit → API Keys**. Klikk **Create** og kopier nøkkelen.
2. Finn forhandlerkoden (merchant code) under profilen i SumUp.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Fyll inn forhandlerkode, API-nøkkel og måned, velg bankkontoen i ReAI og last ned rapporten.

Nøkkelen brukes bare til denne ene forespørselen og lagres aldri.
