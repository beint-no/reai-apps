---
title: "Pindena påmeldinger og regnskap"
seoTitle: "Pindena til ReAI | Gratis integrasjon for kurs og arrangementer"
description: "Hent deltagerne på en aktivitet i Pindena og lag et balansert bilag til kontroll i ReAI for påmeldinger som er betalt med kort eller Vipps."
summary: "Bokfør forhåndsbetalte påmeldinger fra Pindena per aktivitet som et bilag til kontroll i ReAI, med mva-behandlingen du velger."
industry: operations
webAppUrl: /app/pindena/
sourcePath: web/worker/apps/pindena.js
highlights:
  - "Henter aktiviteten og deltagerne fra Pindena API"
  - "Fører forhåndsbetalte påmeldinger mot 1580 for avstemming mot utbetalingen"
  - "Lager et bilag du godkjenner i ReAI; nøklene lagres aldri"
---

## Dette overføres til ReAI

Appen henter én aktivitet og deltagerne med status påmeldt eller bekreftet. Deltagere som står som **Betalt** i Pindena (betalt med kort eller Vipps ved påmelding) summeres ut fra totalprisen og føres som ett bilag til kontroll:

| Pindena | Konto i ReAI | Mva-kode |
| --- | --- | --- |
| Forhåndsbetalte påmeldinger | `1580` | 0 |
| Kursavgift utenfor mva-loven | `3200` | 6 |
| Påmeldinger med 25 % mva, inkl. mva | `3000` | 3 |
| Påmeldinger med 15 % mva, inkl. mva | `3010` | 31 |
| Påmeldinger med 12 % mva, inkl. mva | `3020` | 33 |

Du velger mva-behandling for aktiviteten. Fakturerte, forfalte og ubetalte påmeldinger vises, men bokføres ikke, slik at du kan fakturere de deltagerne fra ReAI. Krediterte påmeldinger tas ikke med. Avstem `1580` mot utbetalingen fra betalingsleverandøren. Bilaget merkes for kontroll, og samme aktivitet kan ikke bokføres to ganger.

## Slik kommer du i gang

1. Be Pindena om tilgang til API-et. Pindena gir deg **brukernavn** og **passord** for Basic Auth og tar betalt for bruk av API-et.
2. Noter adressen deres i Pindena, for eksempel `https://dittfirma.pameldingssystem.no`, og aktivitets-ID fra aktivitetslisten.
3. Åpne appen, klikk **Connect to ReAI** og velg selskap.
4. Fyll inn adresse, brukernavn, passord, aktivitets-ID, bilagsdato og mva-behandling, klikk **Fetch from Pindena API**, kontroller forhåndsvisningen og lag bilaget.

Kontroller bilaget mot betalingsrapporten i Pindena (**Rapporter → Betaling**) og legg den ved i ReAI.
