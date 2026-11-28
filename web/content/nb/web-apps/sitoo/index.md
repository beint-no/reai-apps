---
title: "Sitoo kasse, Z-rapporter og regnskap"
seoTitle: "Sitoo Z-rapporter til ReAI | Gratis integrasjon med åpen kildekode"
description: "Hent dagens Z-rapporter fra Sitoo POS og lag et balansert bilag til kontroll i ReAI, med betalinger per betalingsmåte og salg per mva-sats."
summary: "Gjør Z-rapportene fra Sitoo POS om til ett balansert bilag til kontroll i ReAI per dag, med utgående mva-koder."
industry: operations
icon: icons/sitoo.svg
webAppUrl: /app/sitoo/
sourcePath: web/worker/apps/sitoo.js
highlights:
  - "Henter Z-rapporter fra Sitoo REST API med API-ID og passord"
  - "Fordeler salget på 25, 15, 12 og 0 % mva med mva-kodene i ReAI"
  - "Lager et bilag du godkjenner i ReAI; nøklene lagres aldri"
---

## Dette overføres til ReAI

For datoen du velger, henter appen alle Z-rapporter som ble lukket den dagen i Sitoo (`GET /v2/accounts/{account}/pos-z-reports`) og samler dem i ett bilag til kontroll i ReAI:

| Z-rapport fra Sitoo | Konto i ReAI | Mva-kode |
| --- | --- | --- |
| Kontant | `1900` | 0 |
| Kort, Vipps og andre betalingsmåter | `1580` | 0 |
| Gavekort | `2900` | 0 |
| Faktura | `1570` | 0 |
| Salg 25 % mva, inkl. mva | `3000` | 3 |
| Salg 15 % mva, inkl. mva | `3010` | 31 |
| Salg 12 % mva, inkl. mva | `3020` | 33 |
| Salg 0 % mva | `3100` | 5 |
| Øreavrunding | `7790` | 0 |

Returer føres mot de samme kontoene. ReAI deler hver salgslinje i inntekt og utgående mva ut fra mva-koden, slik at omsetningen kommer med i mva-meldingen. Bilaget merkes for kontroll og lages bare når betalinger og salg går i null. Samme dag kan ikke bokføres to ganger.

## Slik kommer du i gang

1. Gå til **Settings / Sitoo REST API** i Sitoo Backoffice. Du må være administrator, og API-tillegget må være aktivert på kontoen.
2. Generer et passord for API-brukeren. Kopier **API ID**, **passordet**, **base URL** og **kontonummeret** som vises der.
3. Hvis API-nøkkelen er begrenset til bestemte IP-adresser, må du tillate forespørsler fra ReAI-appene eller fjerne begrensningen for denne nøkkelen.
4. Åpne appen, klikk **Connect to ReAI** og velg selskap.
5. Fyll inn opplysningene fra Sitoo og datoen for Z-rapporten, klikk **Fetch from Sitoo API**, kontroller forhåndsvisningen og lag bilaget.

Bare kasser i NOK med norske mva-satser støttes. Kontroller bilaget mot Z-rapportene og legg dem ved i ReAI.
