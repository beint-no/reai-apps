---
title: "Proteria Frakt og regnskap"
seoTitle: "Viderefakturering av frakt fra Proteria Frakt i ReAI"
description: "Importer fakturarapporten fra Proteria Frakt og lag ordreutkast i ReAI for viderefakturering av frakt per sending."
summary: "Les inn Fakturarapport fra Proteria som CSV, velg kolonner og lag ordreutkast i ReAI som du kontrollerer selv."
industry: ecommerce-logistics
webAppUrl: /app/proteria/
sourcePath: web/worker/apps/proteria.js
highlights:
  - "Leser Fakturarapport som CSV fra Proteria sin rapportløsning"
  - "Du velger kolonnene selv, AmountWithoutVAT er forhåndsvalgt"
  - "Lager ordreutkast først når du klikker"
---

## Dette overføres til ReAI

Hver linje i fakturarapporten fra Proteria Frakt blir en fraktlinje som du kan legge inn som ordreutkast i ReAI. Ordrelinjen får fraktbeløpet uten mva, sendingsnummeret og teksten for transportør eller produkt. Mottakere matches mot kunder i ReAI på navn, ellers velger du en standardkunde.

Ingenting faktureres eller bokføres automatisk. Hver ordre er et utkast til du kontrollerer og fakturerer den i ReAI, med vanlig salgskonto og mva-kode for frakt.

## Hvorfor en rapportfil

API-et til Proteria Frakt (CloudConnect) brukes til å bestille sendinger, etiketter og utskrift, men har ikke noe endepunkt som lister sendinger eller fraktkostnader. Fakturarapporten er stedet der fakturert frakt per sending er dokumentert.

## Oppsett

1. Logg inn på Proteria sin rapportløsning på **reportingweb.proteria.com**, velg **Lag Rapport** og deretter **Fakturarapport** (den forenklede varianten har én linje per sending).
2. Last ned rapporten som CSV.
3. Klikk **Åpne integrasjon**, koble til selskapet ditt i ReAI og last opp filen.
4. Velg hvilke kolonner som inneholder beløp uten mva, dato, sendingsnummer, mottaker og produkt.
5. Kontroller fraktlinjene og klikk **Stage order** på dem du vil viderefakturere.
