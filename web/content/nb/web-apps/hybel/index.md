---
title: Hybel Bilagsjournal
seoTitle: Hybel Bilagsjournal — Nettapp og Mac-bro for ReAI
description: Forhåndsvis, valider og bokfør en månedlig Hybel CSV-journal i ReAI som et balansert kontrollbilag direkte fra nettleseren eller Mac.
summary: Valider en månedlig Hybel CSV-bilagsjournal i nettleseren og opprett et balansert kontrollbilag i ReAI.
industry: real-estate
status: experimental
icon: icons/hybel.avif
webAppUrl: /app/hybel/
appId: hybel
sourcePath: web/apps/hybel
highlights:
  - "Rask CSV-parsing i nettleseren med automatisk kolonnegjenkjenning og balansekontroll"
  - "Inkluderer en syntetisk eksempel-CSV så du kan teste hele flyten uten konto"
  - "Validerer organisasjonsnummer, kontoplan, bankkontoer og eksisterende bilag mot ReAI-API-et"
  - "Merker bilaget for regnskapsførerkontroll med SHA-256 kontrollspor"
---

## Slik fungerer det

1. Eksporter én hel kalendermåned med **Bilagsjournal** som CSV fra Hybel (eller last inn eksempel-filen).
2. Tilordne kolonnene én gang—ikke-sensitive kolonnevalg lagres lokalt i nettleseren.
3. Koble til ReAI via sikker Worker-proxy, bekreft organisasjonsnummer og valider alle kontoer og balansegrupper mot selskapet ditt.
4. Bekreft sjekklisten og opprett et balansert kontrollbilag i ReAI. Legg ved original rapport fra Hybel før kontrollen lukkes.

## Avgrensning

Hybel dokumenterer CSV-eksport og leverandørstyrte integrasjoner, ikke et åpent lese-API. Appen støtter månedlige hovedboksjournaler i NOK med MVA-kode `0`, mens leietakerreskontro forblir i Hybel.
