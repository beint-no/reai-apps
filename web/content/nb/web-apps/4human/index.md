---
title: "4human HRM og regnskap"
seoTitle: "Ansatte fra 4human HRM til ReAI"
description: "Hent ansatte fra 4human HRM og opprett dem i ReAI Ansatte med kontaktinfo, startdato, stillingsprosent og kontonummer."
summary: "Les aktive arbeidsforhold fra API-et til 4human HRM og opprett de ansatte i ReAI én og én."
industry: operations
webAppUrl: /app/4human/
sourcePath: web/worker/apps/4human/
highlights:
  - "Bruker REST API-et til 4human HRM med Client ID og Secret Key fra 4human"
  - "Navn, e-post, telefon, startdato, stillingsprosent, adresse og kontonummer"
  - "Kontrollerer norske kontonumre med MOD11 og hopper over ansatte som finnes i ReAI"
---

## Dette overføres til ReAI

Appen leser aktive arbeidsforhold og tilhørende brukerprofiler i 4human HRM. Tidligere og ledige stillinger hoppes over. Profilene leses for 25 ansatte om gangen, sortert på navn, og **Next 25 employees** henter de neste. For hver ansatt velger du **Create in ReAI**, som oppretter den ansatte og et arbeidsforhold med startdato og stillingsprosent. E-post, telefon, adresse, fødselsnummer og et MOD11-kontrollert norsk kontonummer tas med når 4human har dem.

Når en ansatt opprettes i ReAI, lages det ingen bruker, ingen invitasjon, ingen a-melding og ingen lønnskjøring. Kontroller skattekort, lønn og arbeidsforhold i ReAI før første lønnskjøring. Ansatte som allerede finnes i ReAI med samme e-post eller navn vises, men opprettes ikke på nytt.

## Oppsett

1. Lag en systembruker i 4human: **Vår organisasjon → Onboard → Inviter bruker**, bruk en felles e-postadresse, velg **Lagre og send invitasjon** og godta invitasjonen.
2. Bestill tilgang til REST API hos 4human support (support@4humanhrm.no) med systembrukeren og godkjenning fra systemeier. 4human avtaler pris og vilkår og leverer **Client ID** og **Secret Key**.
3. Klikk **Åpne integrasjon**, koble til selskapet ditt i ReAI og fyll inn Client ID og Secret Key.
4. Kontroller listen og opprett de ansatte du vil ha i ReAI.

Client ID og Secret Key brukes til én forespørsel og lagres aldri.
