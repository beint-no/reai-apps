---
title: "nShift Delivery og regnskap"
seoTitle: "Viderefakturering av frakt fra nShift Delivery i ReAI"
description: "Hent lagrede fraktpriser fra nShift Delivery og lag ordreutkast i ReAI for viderefakturering av frakt per sending."
summary: "Les prishistorikk fra nShift Delivery med din egen API-nøkkel og lag ordreutkast i ReAI per sending."
industry: ecommerce-logistics
webAppUrl: /app/nshift/
sourcePath: web/worker/apps/nshift/
highlights:
  - "Bruker REST API-et til nShift Delivery med din egen API-nøkkel"
  - "Fraktpris per sending med transportør, tjeneste og antall kolli"
  - "Lagrer ingenting: du tar vare på fetchId til neste gang"
---

## Dette overføres til ReAI

nShift Delivery lagrer en fraktpris for hver utskrevne sending, basert på fraktavtalen din. Appen leser disse prisene og lar deg legge inn hver sending som ordreutkast i ReAI med én linje for fraktbeløpet uten mva. Når lisensen din har Shipment History, hentes også mottakernavn som matches mot kunder i ReAI. Ellers velger du en standardkunde.

Ingenting faktureres eller bokføres automatisk. Ordrene er utkast til du kontrollerer dem i ReAI, med vanlig salgskonto og mva-kode for frakt. nShift oppgir ikke valuta for prisene, så ordrene lages i NOK.

## Slik fungerer prisstrømmen

Prishistorikken i nShift er en strøm. Hver henting gir prisene som er lagret etter `fetchId` du sender, og en ny `fetchId` til neste gang. Start med `-1`, og ta vare på verdien appen viser etter hver henting. nShift ber om at nye hentinger ikke skjer oftere enn omtrent hvert femte minutt.

## Oppsett

1. Gå til **Maintenance → API keys** i nShift Delivery og klikk **New API key**. Sett status til aktiv og lagre. Kopier **Id** og **Secret Id**.
2. Sjekk under **Help → Session** at kontoen har lisensen **REST API price enquiry**. Med **REST API Shipment History** får du også mottakernavn.
3. Klikk **Åpne integrasjon**, koble til selskapet ditt i ReAI og fyll inn Id, Secret Id og siste `fetchId`.
4. Kontroller fraktlinjene og klikk **Stage order** på sendingene du vil viderefakturere.
