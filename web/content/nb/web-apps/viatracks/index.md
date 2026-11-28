---
title: "Integrasjon mellom ViaTracks kjørebok og regnskap"
seoTitle: "ViaTracks kjørebok til ReAI: yrkesturer og bompenger"
description: "Hent yrkesturer og bompenger fra ViaTracks API og registrer dem i ReAI Kjørebok, koblet til ansatt og kjøretøy. Gratis og åpen kildekode."
summary: "Hent yrkesturer med bompenger fra ViaTracks og registrer dem i ReAI Kjørebok etter kontroll."
industry: operations
webAppUrl: /app/viatracks/
sourcePath: web/worker/apps/viatracks/
highlights:
  - "Leser turer og utgifter fra ViaTracks API med nøkkel fra Devinco"
  - "Utelater private turer og kobler sjåfør og bil til ansatt og kjøretøy i ReAI"
  - "Hopper over turer som allerede ligger i kjøreboken"
---

## Dette overføres til ReAI

ViaTracks logger turene med GPS i bilen. Integrasjonen henter turene for en periode og viser dem for kontroll. Private turer, turer som pågår og turer ViaTracks har avvist tas ikke med. Er en del av turen merket privat skattbar, trekkes den fra.

Hver tur blir en tur i ReAI Kjørebok med dato, strekning, formål, kilometer og bompenger. For kjøretøy med kjøregodtgjørelse bokfører ReAI godtgjørelsen med statens sats for turdatoen. Kjøretøy som bare skal dokumenteres, får turen i kjøreboken uten bilag.

| Fra ViaTracks | I ReAI |
| --- | --- |
| Dato, start og slutt, formål, distanse | Tur i kjøreboken |
| Utgifter av typen bompenger | Bompenger på turen |
| Brukerens e-post eller navn | Ansatt med samme e-post eller navn |
| Registreringsnummer | Kjøretøy med samme registreringsnummer |

Parkering, ferje og andre utgifter vises i forhåndsvisningen, men sendes ikke.

## Slik kommer du i gang

1. Lag eller velg en bruker i ViaTracks som har tilgang til bilene som skal overføres.
2. Send e-post til support@devinco.com og be om API-nøkkel til brukeren. Devinco sender **subjectId** og **API key**. Integrasjonen krever at **Integration Enabled** er slått på for kunden eller avdelingen, noe Devinco tar betalt for per enhet.
3. Registrer bilene i ReAI Kjørebok med samme registreringsnummer som i ViaTracks.
4. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap. Fyll inn subjectId og API key, velg periode og hent turene.
5. Kontroller turene, kryss av for bekreftelse og registrer dem. Hvert klikk registrerer en porsjon, og turer med samme dato, strekning og kilometer som allerede ligger i kjøreboken, hoppes over.

Nøkkelen brukes bare til disse forespørslene og lagres aldri. Ikke betal ut den samme kjøregodtgjørelsen gjennom ViaTracks eller lønn i tillegg.
