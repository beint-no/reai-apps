---
title: Integrasjon mellom Hybel.no og regnskap
seoTitle: "Integrasjon mellom Hybel.no og ReAI: månedlig bilagsjournal"
description: Kontroller og bokfør bilagsjournalen fra Hybel Premium som ett bilag til kontroll i ReAI. Gratis og åpen kildekode.
summary: Kontroller en månedlig bilagsjournal (CSV) fra Hybel og opprett et balansert bilag til kontroll i ReAI.
industry: real-estate
webAppUrl: /app/hybel/
sourcePath: web/worker/apps/hybel/
highlights:
  - "Leser bilagsjournalen fra Hybel som CSV i UTF-8 eller Windows-1252, med automatisk kolonnegjenkjenning"
  - "Kontrollerer at hver dato og BatchID balanserer til 0,00 før noe sendes til ReAI"
  - "Sjekker organisasjonsnummer, kontoplan, bankkontoer og tidligere import mot ReAI"
---

## Slik får du utleieregnskapet fra Hybel inn i ReAI

Hybel Premium fører leietakerreskontroen og lar deg ta ut en **Bilagsjournal** med alle transaksjoner i en periode. Integrasjonen kontrollerer én måned av bilagsjournalen mot kontoplanen og bankkontoene i ReAI og lager ett balansert bilag til kontroll, med et SHA-256-kontrollspor. Leietakerreskontroen blir værende i Hybel.

## Slik kommer du i gang

1. Gå til **Rapporter → Innstillinger** i Hybel og legg inn kontoene fra ReAI, for eksempel `1510 Fordringer leietakere` og `1520 Fordringer forvalter`. Sett MVA-koden til `0`. Bruk ikke `1500`, som i ReAI krever kundereskontro.
2. Gå til **Rapporter**, velg **Bilagsjournal**, én kalendermåned og et CSV-format, og trykk **Last ned**.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Last opp filen, kontroller kolonnene og forhåndsvisningen, og opprett bilaget. Legg ved perioderapporten fra Hybel i ReAI.
