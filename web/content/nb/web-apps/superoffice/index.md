---
title: "Integrasjon mellom SuperOffice og regnskap"
seoTitle: "Integrasjon mellom SuperOffice CRM og ReAI: solgte salg til fakturering"
description: "Hent solgte salg fra SuperOffice CRM og legg dem inn som ordrer i ReAI med firmaet og organisasjonsnummeret som kunde. Gratis og åpen kildekode."
summary: "Hent salg med status Solgt fra SuperOffice og legg dem inn som ordrer i ReAI."
industry: operations
webAppUrl: /app/superoffice/
sourcePath: web/worker/apps/superoffice.js
highlights:
  - "Leser solgte salg fra SuperOffice REST API"
  - "Finner kunden på organisasjonsnummer eller navn, ellers opprettes en bedriftskunde"
  - "Hopper over salg som allerede er lagt inn"
---

## Dette kommer over i ReAI

Integrasjonen henter salg med status *Solgt* og salgsdato i valgt periode, med firmanavn og organisasjonsnummer. Når du klikker **Stage in ReAI**, blir salget en ordre i ReAI med én linje for salgsbeløpet og standard MVA-kode. Du kontrollerer ordren før fakturering.

| Fra SuperOffice | I ReAI |
| --- | --- |
| Overskrift og beløp | Ordrelinje |
| Firma og organisasjonsnummer | Kunde som finnes på organisasjonsnummer eller navn, ellers en ny bedriftskunde |
| Salgs-ID | Ekstern referanse, slik at salget ikke legges inn to ganger |

## Slik kommer du i gang

SuperOffice CRM Online gir bare API-tilgang med tilgangstoken fra en app som er registrert hos SuperOffice. Integrasjonen krever derfor at dere har en slik app.

1. Registrer en egendefinert app (*Custom Application*) i SuperOffice-utviklerportalen. SuperOffice-abonnementet må ha lisensen Development Tools eller CRM Suite Core.
2. Logg inn via appen og kopier tilgangstokenet og web API-adressen, for eksempel `https://online2.superoffice.com/Cust12345/api`. Tokenet varer i en time.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Fyll inn adressen, tokenet og perioden, og hent salgene.
5. Kontroller beløpene og legg inn ordrene du vil fakturere.

Tokenet brukes bare til denne forespørselen og lagres aldri.
