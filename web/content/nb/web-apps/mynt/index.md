---
title: "Integrasjon mellom Mynt og regnskap"
seoTitle: "Mynt utgiftseksport til ReAI: kortkjøp som kontrollbilag"
description: "Gjør en utgiftseksport fra Mynt om til ett balansert kontrollbilag i ReAI med kostnadskontoer, inngående mva og egen konto for Mynt-kortet. Gratis og åpen kildekode."
summary: "Les inn kortutgifter fra Mynt sin CSV-eksport som ett balansert kontrollbilag i ReAI."
industry: operations
icon: icons/mynt.svg
webAppUrl: /app/mynt/
sourcePath: web/worker/apps/mynt.js
highlights:
  - "Leser kolonnene Transaction date, Amount, VAT rate, Description og Account fra Mynt"
  - "Fører inngående mva med 25, 15 og 12 prosent og beholder refusjoner som kredit"
  - "Ett kontrollbilag per eksport med sperre mot dobbeltføring"
---

## Dette overføres til ReAI

Mynt gir ansatte bedriftskort og samler kvitteringer, konto og mva for hvert kjøp. Mynt tilbyr ikke API-nøkkel til kortkunder, så integrasjonen leser utgiftseksporten Mynt lager for regnskapssystemer uten direkte integrasjon.

Hver linje blir en rad i ett manuelt bilag som merkes for kontroll:

| Postering | Konto |
| --- | --- |
| Kjøp (debet) | Kolonnen **Account** fra Mynt, eller `6800` hvis den er tom |
| Inngående mva | Mva-kode `1`, `11` eller `13` i ReAI ut fra **VAT rate** i Mynt |
| Mynt-kortet (kredit) | Egen kortkonto, standard `1925` |

Mynt anbefaler en egen `19xx`-konto for kortet. Linjer merket **Reverse VAT** føres med mva-kode `0`, slik at du kan velge riktig kode for omvendt avgiftsplikt i kontrollen.

## Slik kommer du i gang

1. Åpne **Accounting & Export** i Mynt, velg **Ready for Export**, marker utgiftene og klikk **Create report**.
2. Åpne rapporten under **Reports** og last den ned som CSV. Nedlastingen merker utgiftene som eksportert i Mynt.
3. Klikk **Åpne integrasjon**, koble til ReAI, fyll inn kontoen for Mynt-kortet og last opp filen.
4. Kontroller kontoer og mva-koder, lag kontrollbilaget og legg ved kvitteringene fra Mynt i ReAI.
