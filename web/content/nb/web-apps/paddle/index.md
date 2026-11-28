---
title: "Integrasjon mellom Paddle og regnskap"
seoTitle: "Bokfør utbetalinger fra Paddle i ReAI"
description: "Hent avstemmingsrapporten for én utbetaling fra Paddle og bokfør salg, gebyrer og innbetalingen i banken i ReAI. Gratis og åpen kildekode."
summary: "Bokfør en utbetaling fra Paddle Billing i ReAI ut fra avstemmingsrapporten, kontrollert mot utbetalingsspesifikasjonen."
industry: payments
webAppUrl: /app/paddle/
sourcePath: web/worker/apps/paddle/
highlights:
  - "Leser avstemmingsrapporten for utbetalinger via Paddle API"
  - "Kontrollerer rapporten mot beløpet på utbetalingsspesifikasjonen"
  - "Lager et kontrollbilag med salg eks. avgift, gebyrer og innbetalingen i banken"
---

## Dette overføres til ReAI

Paddle er selger overfor kundene dine (merchant of record), krever inn avgiften og betaler resten til deg. Integrasjonen lager avstemmingsrapporten for én utbetaling i Paddle, summerer salg, refusjoner, tilbakeføringer, gebyrer, rabatter og overføringsgebyrer, og kontrollerer at summen er lik beløpet du fører inn fra utbetalingsspesifikasjonen.

Bilaget opprettes til kontroll i ReAI:

| Postering | Standardkonto | Mva-kode |
| --- | --- | --- |
| Beløp mottatt i banken | `1920` | `0` |
| Salg eks. avgift, fratrukket refusjoner | `3100` | `52` (utførsel) |
| Gebyrer fra Paddle fratrukket rabatter | `7770` | `0` |

Er utbetalingen i en annen valuta enn selskapets, fører du inn beløpet som kom inn i banken. Alle linjer regnes om med den kursen. Referansen for utbetalingen står i bilagsteksten, så samme utbetaling bokføres ikke to ganger. Avklar mva-behandlingen med regnskapsføreren din.

## Oppsett

1. Gå til **Developer tools** og **Authentication** i Paddle og lag en API-nøkkel med lese- og skrivetilgang til rapporter.
2. Åpne **Payouts** i Paddle og kopier referansen (remittance reference) og beløpet for utbetalingen.
3. Klikk **Åpne integrasjon**, koble til ReAI og legg inn nøkkelen, referansen, beløpet og datoen på kontoutskriften.
4. Klikk **Fetch from Paddle API**. Holder Paddle fortsatt på med rapporten, klikker du **Check again** etter et minutt.
5. Kontroller forhåndsvisningen og klikk **Create review voucher in ReAI**. Legg ved utbetalingsspesifikasjonen i ReAI.

API-nøkkelen brukes bare til denne forespørselen og lagres aldri.
