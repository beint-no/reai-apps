---
title: "Integrasjon mellom Autogear kjørebok og regnskap"
seoTitle: "Autogear kjørebok til ReAI: yrkesreiser og bompenger"
description: "Hent godkjente yrkesreiser og bompenger fra Autogear API og registrer dem i ReAI Kjørebok med kjøregodtgjørelse. Gratis og åpen kildekode."
summary: "Hent godkjente turer med bompenger fra Autogear og registrer dem i ReAI Kjørebok etter kontroll."
industry: operations
webAppUrl: /app/autogear/
sourcePath: web/worker/apps/autogear/
highlights:
  - "Leser turer fra Autogear REST API med egen Client ID og Client Secret"
  - "Utelater private turer og arbeidsreiser, og kobler sjåfør til ansatt i ReAI via e-post"
  - "Registrerer hver kontrollerte tur med POST /api/driving-log/trips"
---

## Dette overføres til ReAI

Autogear registrerer alle turer og bompasseringer med GPS-enhet eller app. Integrasjonen henter turene for en periode, som standard bare turer sjåføren har godkjent i Autogear, og viser dem for kontroll. Private turer og arbeidsreiser tas ikke med.

Hver tur du registrerer blir en tur i ReAI Kjørebok med dato, strekning, formål, kilometer og bompenger. For kjøretøy med kjøregodtgjørelse bokfører ReAI bilaget med statens sats for turdatoen, og godtgjørelsen utbetales via import av utlegg til lønn med rapportering i a-meldingen.

| Data | I ReAI |
| --- | --- |
| Dato, start- og sluttadresse, formål, km | Tur i kjøreboken |
| Bompasseringer (`totalTollStationCost`) | Bompenger på turen |
| Sjåførens e-post | Kobles til ansatt i ReAI med samme e-post |

## Slik kommer du i gang

1. Kontoeier eller administrator logger inn i Autogear og ber om API-tilgang under **API-klienter**. Autogear åpner tilgangen for kontoen, vanligvis innen to virkedager.
2. Kontoeier eller administrator lager deretter API-nøkkelen under **API-klienter** og godtar vilkårene for API. Noter **Client ID** og **Client Secret**.
3. Opprett en egen integrasjonsbruker i Autogear med tilgang til kjøretøyene som skal overføres.
4. Klikk **Åpne integrasjon**, koble til ReAI, fyll inn integrasjonsbruker, passord, Client ID og Client Secret, velg periode og hent turene.
5. Kontroller turene og klikk **Record trip** på hver tur som skal inn i ReAI. En tur som allerede ligger i kjøreboken med samme dato, strekning og kilometer, registreres ikke på nytt. Påloggingen brukes bare i denne forespørselen og lagres aldri.

Ikke send de samme turene fra Autogear til et annet lønns- eller reiseregningssystem i tillegg, ellers blir godtgjørelsen utbetalt to ganger.
