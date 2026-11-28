---
title: Integrasjon mellom Stripe og regnskap
seoTitle: "Integrasjon mellom Stripe og ReAI: fakturaer og abonnementer"
description: Importer betalte Stripe-fakturaer og flytt faste abonnementer til ReAI gratis. Guide til trygg regnskapsføring og overgang fra Stripe.
summary: Importer betalte Stripe-fakturaer trygt til ReAI og klargjør aktive abonnementer uten dobbeltfakturering.
industry: payments
webAppUrl: /app/stripe/
sourcePath: web/worker/apps/stripe/
highlights:
  - "Bruker begrenset lesenøkkel fra Stripe (rk_live_ eller rk_test_) uten skrivetilgang"
  - "Idempotent import av historiske fakturaer (accounting=none) så ingenting dobbeltføres"
  - "Klargjør måneds- og årsabonnementer i ReAI med autofakturering skrudd av"
---

## Dette kommer over i ReAI

Integrasjonen er laget for deg som flytter fakturering fra Stripe til ReAI.

* **Betalte fakturaer** uten MVA importeres som historiske fakturaer med `accounting=none`, koblet til kunden med samme e-post i ReAI. Inntekt og MVA bokføres ikke på nytt, og samme faktura kan ikke importeres to ganger.
* **Aktive abonnementer** med én fast måneds- eller årspris klargjøres i ReAI fra neste periode i Stripe, med automatisk fakturering skrudd av. Du kontrollerer kunde, pris og MVA før du skrur på fakturering i ReAI og stopper den i Stripe.

Fakturaer og abonnementer med rabatt, MVA, flere linjer eller annen valuta enn selskapet vises med årsak og må håndteres manuelt.

## Slik kommer du i gang

1. Gå til **Developers → API keys** i Stripe Dashboard og klikk **Create restricted key**. Gi lesetilgang til Customers, Invoices og Subscriptions, og kopier nøkkelen som starter med `rk_live_`.
2. Opprett et produkt uten MVA i ReAI som fakturalinjene kan knyttes til.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Lim inn nøkkelen, velg produktet og eventuelt en startdato for fakturaene, og kontroller listen. Importer fakturaer og klargjør abonnementer én og én.

Nøkkelen brukes bare til disse forespørslene og lagres aldri.
