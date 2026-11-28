---
title: "Integrasjon mellom Spense og regnskap"
seoTitle: "Spense oppgjør til ReAI: utbetalinger, gebyrer og bankavstemming"
description: "Les inn oppgjørsrapporten fra Spense, avstem hver utbetaling mot banken i ReAI og lag ett kontrollbilag for innbetalinger, gebyrer og utbetalinger. Gratis."
summary: "Avstem utbetalinger fra Spense mot uavstemte banktransaksjoner i ReAI og før oppgjøret som kontrollbilag."
industry: payments
webAppUrl: /app/spense/
sourcePath: web/worker/apps/spense.js
highlights:
  - "Leser Spense sin dokumenterte oppgjørsfil i formatet payouts eller transactions"
  - "Matcher nettoutbetalinger mot uavstemte banktransaksjoner i ReAI innenfor åtte dager"
  - "Valgfritt kontrollbilag for utbetalinger og trukne gebyrer, med sperre mot dobbeltføring"
---

## Dette overføres til ReAI

Spense tar betalt for verksteder og forhandlere med betalingslenker og terminaler, trekker gebyrer for enkelte betalingsleverandører og utbetaler til bedriftens bankkonto. Oppgjørsrapporten viser hver utbetaling med bruttobeløp, gebyrer og nettobeløp.

Integrasjonen leser rapporten for én måned, matcher hver nettoutbetaling mot uavstemte banktransaksjoner i ReAI og lager en CSV med avstemmingen. Deretter kan du lage ett balansert bilag som merkes for kontroll:

| Postering | Standardkonto |
| --- | --- |
| Nettoutbetaling (debet) | Valgt bankkonto i ReAI |
| Gebyrer trukket av Spense (debet) | `7770` |
| Innbetalinger fra kunder via Spense (kredit) | Mellomkonto `1580` |

Gebyrer føres bare når utbetalingen er lavere enn bruttobeløpet. Gebyrer som Spense fakturerer senere, føres ikke her. Bruk mellomkontoen der verkstedsystemet fører fakturaer som kundene betaler via Spense.

## Slik kommer du i gang

1. Hent oppgjørsrapporten fra Spense som CSV i formatet **payouts** eller **transactions**. Spense beskriver begge formatene i utviklerdokumentasjonen under **Settlements**. En utvikler kan lage filen med en API-nøkkel fra Spense Portal (app.spensepay.com).
2. Klikk **Åpne integrasjon**, koble til ReAI og velg måned og bankkonto.
3. Last opp filen, kontroller treffene og last ned avstemmingen ved behov.
4. Når summene stemmer med rapporten, velger du kontoer og lager kontrollbilaget.

Spense har et API, men oppgjørsendepunktet krever et forespørselsformat som denne nettappen ikke kan sende. Derfor leser appen inn filen.
