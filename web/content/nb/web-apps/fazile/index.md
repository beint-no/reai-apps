---
title: "Integrasjon mellom Fazile eiendomsforvaltning og regnskap"
seoTitle: "Fazile eiendomsforvaltning til ReAI: leiefakturering"
description: "Hent aktive leiekontrakter fra Fazile via API og klargjør dem som faste abonnementer i ReAI, med MVA-kode etter satsen på hver kontraktslinje."
summary: "Hent aktive leiekontrakter fra Fazile og klargjør leiefakturering i ReAI med full kontroll før aktivering."
industry: real-estate
webAppUrl: /app/fazile/
sourcePath: web/worker/apps/fazile/
highlights:
  - "Leser aktive kontrakter og leietakere med en API-nøkkel fra Fazile"
  - "Finner leietakeren i ReAI på organisasjonsnummer, e-post eller navn"
  - "Oppretter abonnementer med automatisk fakturering avslått til du godkjenner dem"
---

## Leiefakturering fra Fazile i ReAI

Fazile lagrer leie, felleskostnader og markedsføringsbidrag som årsbeløp på kontraktslinjene. Integrasjonen henter de aktive kontraktene, deler årsbeløpet på faktureringsfrekvensen og lager ett abonnement i ReAI per kontrakt og frekvens. Linjer med MVA får ReAI sin utgående MVA-kode med samme sats, og linjer uten MVA får koden du velger. Rabatter, leiefritak og periodiseringer tas ikke med og må legges inn i ReAI ved behov.

Fazile sender vanligvis fakturagrunnlaget til økonomisystemet selv. Bruk integrasjonen for kontrakter som skal faktureres fra ReAI.

## Slik setter du det opp

1. Gå til **Firmaprofil → API Nøkler** i Fazile og velg **Opprett API-nøkkel**. Gi nøkkelen lesetilgang til kontrakter og leietakere. Nøkkelen vises bare én gang. Fazile fakturerer API-tilgang etter avtale.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg MVA-kode for linjer uten MVA.
3. Lim inn nøkkelen og hent kontraktene.
4. Kontroller beløp, frekvens og startdato, og klikk **Stage subscription**. Slå på automatisk fakturering i ReAI når vilkårene stemmer.
