---
title: "Power BI og regnskap"
seoTitle: "Power BI og Excel mot regnskapsdata i ReAI"
description: "Lag Power Query-skript som henter posteringer, resultat, saldoer og fakturaer fra ReAI til Power BI eller Excel med din egen API-nøkkel."
summary: "Kopier ferdige Power Query-skript for posteringer, resultat, balanse og fakturaer fra ReAI til Power BI Desktop, Power BI-tjenesten eller Excel."
industry: operations
webAppUrl: /app/power-bi/
sourcePath: web/worker/apps/power-bi/
highlights:
  - "Power BI og Excel kaller ReAI direkte med din nøkkel, apps.reai.no ser den aldri"
  - "Posteringer, resultat per kontoklasse, saldoer og alle fakturaer i perioden"
  - "Fast datakilde, slik at planlagt oppdatering virker i Power BI-tjenesten"
---

## Dette henter skriptene

Siden lager ett Power Query-skript (M) per datasett. Hvert skript kaller ReAI sitt offentlige API fra Power BI eller Excel og gir en ferdig typet tabell.

| Spørring | Endepunkt i ReAI | Innhold |
| --- | --- | --- |
| `ReAI_Postings` | `GET /api/ledger/general` | Alle posteringslinjer i perioden med konto, bilag, mva-kode, beløp, prosjekt, kunde, leverandør og ansatt |
| `ReAI_ProfitAndLoss` | `GET /api/ledger/general` (konto `3000` til `8999`) | Bevegelse per resultatkonto i perioden, gruppert på kontoklasse (3 inntekter, 4 varekostnad, 5 lønn, 6 og 7 andre driftskostnader, 8 finans og skatt) |
| `ReAI_Balances` | `GET /api/ledger/general` (konto `1000` til `2999`) | Utgående saldo per balansekonto på sluttdatoen |
| `ReAI_Invoices` | `GET /api/invoices` | Fakturaer og kreditnotaer utstedt i perioden med beløp, mva, betalt og utestående |
| `ReAI_Companies` | `GET /api/me` | Selskapene nøkkelen har tilgang til, med tenant-ID |

Beløpene følger hovedboken: debet er positivt og kredit er negativt. Resultatspørringen har i tillegg `resultAmount`, der inntekter er positive og kostnader negative. Ingenting skrives til ReAI.

## Slik fungerer innloggingen

ReAI sitt API bruker bearer-token. Hver forespørsel sender `Authorization: Bearer <nøkkel>` og, for selskapsdata, `X-Tenant-Id: <tenant-ID>`. Skriptene leser nøkkelen fra en Power Query-parameter som heter `ReAIToken`. Nøkkelen står derfor aldri i selve skriptet og går aldri via apps.reai.no.

En bruker-API-nøkkel har de samme rettighetene som brukeren din i alle selskaper du har tilgang til, og den utløper ikke av seg selv. Lag en egen nøkkel til rapportering, hold rapportfilen privat og slett nøkkelen når rapporten ikke lenger brukes. Nøkkelen lagres i `.pbix`- eller `.xlsx`-filen.

## Oppsett

1. Gå til **Profil → Bruker-API-nøkler** i ReAI ([app.reai.no/user/profile](https://app.reai.no/user/profile#user-access-tokens)) og velg **Ny bruker-API-nøkkel**. Kopier nøkkelen.
2. Klikk **Åpne integrasjon**, velg selskap (eller skriv inn tenant-ID), periode og datasett, og velg **Generate Power Query scripts**.
3. I Power BI Desktop går du til **Hjem → Transformer data → Behandle parametere → Ny parameter**. I Excel går du til **Data → Hent data → Start Power Query-redigering → Behandle parametere**. Kall parameteren `ReAIToken`, velg typen Tekst og lim inn nøkkelen.
4. For hvert datasett velger du **Ny kilde → Tom spørring → Avansert redigering**, limer inn skriptet og gir spørringen navnet som vises.
5. Når Power BI eller Excel spør hvordan du vil koble til `https://app.reai.no`, velger du **Anonym**. Skriptet setter selv Authorization-headeren.
6. Etter publisering til Power BI-tjenesten åpner du innstillingene for den semantiske modellen, setter legitimasjonen for datakilden til **Anonym** med **Hopp over testtilkobling** og slår på planlagt oppdatering.

Vil du endre perioden senere, retter du `StartDate` og `EndDate` øverst i hvert skript, eller gjør dem om til Power Query-parametere.
