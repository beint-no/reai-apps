---
title: Stripe-import
seoTitle: ReAI Stripe-import — Betalte fakturaer og klargjorte abonnementer
description: Gjennomgå betalte MVA-frie Stripe-fakturaer og klargjør enkle abonnementer i ReAI direkte i nettleseren.
summary: Importer enkle historiske Stripe-fakturaer og klargjør abonnementer uten autofakturering.
industry: payments
status: example
webAppUrl: /app/stripe/
sourcePath: web/worker/apps/stripe.js
highlights:
  - "Bruker begrenset Stripe-lesenøkkel per forespørsel uten å lagre nøkkelen"
  - "Idempotent import av historiske fakturaer med accounting=none"
  - "Klargjør faste måneds- eller årsabonnementer med automatisk fakturering skrudd av"
icon: icons/stripe.avif
---

## Kontrollert overgang fra Stripe

Kjører server-til-server mellom Cloudflare Worker, Stripe og ReAI med full kontroll på valuta, MVA og kundematch.
