---
title: "Integrasjon mellom Sharefox og regnskap"
seoTitle: "Utleiesalg fra Sharefox til bilag i ReAI"
description: "Summer bookede utleieordrer fra Sharefox per mva-sats og lag ett balansert bilag til kontroll i ReAI. Gratis og åpen kildekode."
summary: "Hent ordrer fra Sharefox for en periode og før utleiesalget som et bilag til kontroll mot mellomkontoen for betalinger."
industry: ecommerce-logistics
icon: icons/sharefox.svg
webAppUrl: /app/sharefox/
sourcePath: web/worker/apps/sharefox.js
highlights:
  - "Leser ordrer via Sharefox API med innlogging som administrator"
  - "Tar bare med ordrer med status Booked og Closed, også endringsordrer"
  - "Lager ett balansert bilag til kontroll med utgående mva på 25, 15 og 12 prosent"
---

## Dette overføres til ReAI

Integrasjonen henter ordrene i Sharefox for perioden du velger, og tar med ordrene med status **Booked** eller **Closed**, som Sharefox regner som avtalte bookinger. Endringsordrer er med, så forlengelser, endringer og kanselleringer går opp mot den opprinnelige bookingen.

Ordrene summeres per mva-sats til ett bilag i ReAI datert siste dag i perioden:

* Debet mellomkontoen for betalinger (`1580` som standard) med beløpet inkludert mva, slik at det kan avstemmes mot utbetalinger fra Nets, Stripe eller andre.
* Kredit kontoen for leieinntekter (`3000` som standard) med kode for utgående mva på 25, 15 eller 12 prosent, slik at ReAI skiller ut mva.

Ordrer som betales med **Faktura**, holdes utenfor, fordi de faktureres i regnskapssystemet. Ordrer uten mva eller med flere mva-satser listes opp for manuell føring. Bilaget merkes for kontroll, og samme periode føres aldri to ganger.

## Oppsett

1. Be Sharefox Support bekrefte at bruk av API er med i abonnementet ditt.
2. Bruk en administrator i Sharefox og noter admindomenet du logger inn på, for eksempel `yourshop.admin.mysharefox.com`.
3. Klikk **Åpne integrasjon**, koble til ReAI, skriv inn admindomene, e-post, passord og periode, og klikk **Fetch Sharefox orders**.
4. Kontroller summene mot rapporten i Sharefox, juster kontoene ved behov og lag bilaget.

Passordet brukes bare til å hente en token for denne hentingen og lagres aldri.
