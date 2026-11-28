---
title: "Integrasjon mellom Mapon kjørebok og regnskap"
seoTitle: "Mapon og Tracksys Pro til ReAI: yrkesturer i kjøreboken"
description: "Hent yrkesturer fra Mapon API, også brukt av Tracksys Pro, og registrer dem i ReAI Kjørebok koblet til ansatt og kjøretøy. Gratis og åpen kildekode."
summary: "Hent yrkesturer fra Mapon eller Tracksys Pro og registrer dem i ReAI Kjørebok etter kontroll."
industry: operations
webAppUrl: /app/mapon/
sourcePath: web/worker/apps/mapon/
highlights:
  - "Leser yrkesturer fra Mapon API med en nøkkel du lager selv"
  - "Kobler sjåfør og bil til ansatt og kjøretøy i ReAI"
  - "Hopper over turer som allerede ligger i kjøreboken"
---

## Dette overføres til ReAI

Integrasjonen henter turene som er merket som yrkesturer i Mapon for en periode, og viser dem for kontroll. Private turer og stopp tas ikke med. Tracksys Pro bruker samme plattform, så det fungerer også for kunder av Tracksys.

Hver tur blir en tur i ReAI Kjørebok med dato, strekning, forklaring og kilometer. For kjøretøy med kjøregodtgjørelse bokfører ReAI godtgjørelsen med statens sats for turdatoen.

| Fra Mapon | I ReAI |
| --- | --- |
| Starttid, start og slutt, distanse | Tur i kjøreboken |
| Forklaring eller kunde på turen | Formål |
| Sjåførens e-post eller navn | Ansatt med samme e-post eller navn |
| Bilnummer | Kjøretøy med samme registreringsnummer |

Mapon har ikke bompenger, så legg dem inn i ReAI ved behov.

## Slik kommer du i gang

1. Logg inn i Mapon som administrator og gå til **Settings → API keys → Create API key**. Velg bilene nøkkelen skal se, lagre og kopier nøkkelen. Mangler menyen hos Tracksys, kontakt Tracksys.
2. Registrer bilene i ReAI Kjørebok med samme registreringsnummer som i Mapon.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap. Lim inn nøkkelen, velg en periode på inntil to måneder og hent turene.
4. Kontroller turene, kryss av for bekreftelse og registrer dem. Hvert klikk registrerer en porsjon, og turer med samme dato, strekning og kilometer som allerede ligger i kjøreboken, hoppes over.

Nøkkelen brukes bare til disse forespørslene og lagres aldri. Ikke betal ut den samme kjøregodtgjørelsen gjennom lønn i tillegg.
