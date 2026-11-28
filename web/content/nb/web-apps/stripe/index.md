---
title: Integrasjon mellom Stripe og regnskap
seoTitle: Integrasjon mellom Stripe og regnskap — Fakturaer og abonnementer i ReAI
description: Importer betalte Stripe-fakturaer og flytt faste abonnementer til ReAI gratis. Guide til trygg regnskapsføring og overgang fra Stripe.
summary: Importer betalte Stripe-fakturaer trygt til ReAI og klargjør aktive abonnementer uten dobbeltfakturering.
industry: payments
icon: icons/stripe.svg
webAppUrl: /app/stripe/
sourcePath: web/worker/apps/stripe.js
highlights:
  - "Bruker begrenset lesenøkkel fra Stripe (rk_live_ eller rk_test_) uten skrivetilgang"
  - "Idempotent import av historiske fakturaer (accounting=none) så ingenting dobbeltføres"
  - "Klargjør måneds- og årsabonnementer i ReAI med autofakturering skrudd av"
---

## Trygg migrering av Stripe-fakturaer og abonnementer

Ved overgang fra Stripe til fakturering i ReAI er de to vanligste feilene dobbeltbokføring av historiske inntekter eller dobbeltfakturering av abonnenter. Denne integrasjonen har innebygde sikkerhetssperrer:

* **Historiske betalte fakturaer** importeres idempotent med `accounting=none`, slik at historisk regnskap ikke bokføres på nytt.
* **Aktive abonnementer** opprettes fra neste periodeskifte med automatisk fakturering skrudd av, slik at du kan kontrollere MVA, beløp og betalingsmåte før du skrur av fakturering i Stripe.
