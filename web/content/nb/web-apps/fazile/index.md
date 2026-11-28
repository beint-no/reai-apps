---
title: "Integrasjon mellom Fazile boligforvaltning og regnskap"
seoTitle: "Fazile boligforvaltning og eiendom til ReAI — Leiefakturering"
description: "Overfør leiekontrakter fra Fazile bolig- og eiendomsforvaltning til faste abonnementer i ReAI — med støtte for både MVA-unntatt utleie (kode 6) og frivillig MVA (kode 3)."
summary: "Importer leieoversikt fra Fazile boligforvaltning og klargjør månedlig leiefakturering i ReAI med full kontroll før aktivering."
industry: real-estate
icon: icons/fazile.svg
webAppUrl: /app/fazile/
sourcePath: web/worker/apps/fazile.js
highlights:
  - "Matcher leietakere automatisk mot kunderegisteret i ReAI"
  - "Støtter både MVA-unntatt utleie (kode 6) og frivillig MVA-registrert utleie (kode 3)"
  - "Oppretter utkast med automatisk fakturering avslått til du godkjenner i ReAI"
---

## Enklere leiefakturering fra Fazile til ReAI

Eiendomsselskaper og utleiere som administrerer kontrakter i **Fazile** kan laste opp leieoversikten og klargjøre repeterende månedlige leieavtaler direkte i ReAI—både for vanlig utleie uten MVA (kode `6`) og frivillig MVA-registrert næringsutleie (kode `3`).

## Slik setter du det opp

1. Eksporter aktiv leieoversikt som CSV fra Fazile (`LeaseID`, `Tenant`, `Email`, `Unit`, `StartDate`, `MonthlyRent`).
2. Klikk **Åpne integrasjon**, koble til ReAI, velg MVA-kode og last opp filen.
3. Klikk **Stage subscription** på hver leietaker og aktiver faktureringen i ReAI når du har kontrollert vilkårene.
