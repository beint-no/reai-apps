---
title: "Integrasjon mellom RecMan og regnskap"
seoTitle: "RecMan regnskapsintegrasjon for ReAI — Faktura, PDF, KID og lønn med AGA-soner"
description: "Koble RecMan gratis til ReAI. Importer fakturaer og kreditnotaer med original PDF og KID, og klargjør lønnsutkast med automatisk Kartverket-oppslag av arbeidsstedskommune (AGA-sone)."
summary: "Bokfør utstedte RecMan-fakturaer og kreditnotaer med original PDF og KID, og klargjør lønnsutkast i ReAI med automatisk AGA-kommuneoppslag."
industry: operations
icon: icons/recman.svg
webAppUrl: /app/recman/
sourcePath: web/worker/apps/recman.js
highlights:
  - "Importerer utstedte fakturaer og kreditnotaer med original PDF, KID, MVA-koder og 3xxx-kontoer — uten å sende EHF eller e-post på nytt"
  - "Slår automatisk opp vikarers arbeidssted via Kartverket til norsk kommunenummer for riktig AGA-sone — og holder igjen lønnsslipper med flere kommuner til manuell kontroll"
  - "Kvotesikker inkrementell henting fra RecMan API v2 (minInvoiceId, minPaycheckId, exported=0) uten bakgrunnspolling"
---

## Slik kobles RecMan til ReAI for bemanningsbyråer

Bemanningsbyråer som bruker **RecMan** til kandidatdatabase, vikarbooking, fakturering og timeregistrering kan overføre både utstedte kundefakturaer og lønnsgrunnlag rett til **ReAI** helt uten månedlig integrasjonsgebyr.

| Område | RecMan API v2 | Mål i ReAI | Sikkerhetsregler |
| --- | --- | --- | --- |
| **Kunder** | `company` (`vatNumber`, `number`) | `GET/POST /api/customers` | Matcher på 9-sifret norsk org.nr (Mod11), kundenummer eller navn |
| **Faktura & kreditnota** | `invoice`, `creditNote`, `invoicePdf`, `creditNotePdf` | `POST /api/orders` + `POST /api/invoices/import` | Bokføres med `accounting: "book"`, bevarer KID og original PDF, ingen utsending av EHF/purring |
| **AGA-sone / kommune** | `paycheck` → `work` → `project` → `company.visitAddress` | Kartverket Adresse-API (`kommunenummer`) | Lønnsslipper som spenner over flere kommuner holdes automatisk igjen til manuell AGA-kontroll |
| **Lønnsutkast** | `candidate` (`isEmployee=1`), `paycheck` (`exported=0`) | `POST/PATCH /api/employees`, `POST /api/salary-payments`, `/wage-specs` | Oppretter kun redigerbart utkast — sender aldri A-melding eller bankutbetaling |

## Slik kommer du i gang

1. Opprett en **lesetilgangsnøkkel (`SELECT`)** i RecMan (*Systeminnstillinger → Database → API*) med tilgang til *Companies*, *Projects*, *Work*, *Products*, *Invoices*, *Credit Notes*, *Paychecks* og *Candidates*.
2. Klikk **Åpne integrasjon** over og koble til ReAI-selskapet ditt.
3. Test nøkkelen, og skann enten **Fakturaer & kreditnotaer** eller **Lønnsslipper & AGA-soner** (bruk gjerne `minInvoiceId` / `minPaycheckId` for å holde deg langt under RecMans gratis dagskvote på 200 kall).
4. Kontroller MVA-koder, inntektskontoer, lønnsarter (`Timelønn`, `Kveldstillegg`, `Nattillegg`, `Helgetillegg`, `Helligdagstillegg`, `Bakvakt`) og arbeidsstedskommune før du overfører til ReAI.
