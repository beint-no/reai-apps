---
title: "Integrasjon mellom Lime CRM og regnskap"
seoTitle: "Integrasjon mellom Lime CRM og ReAI: vunne salg til ordre"
description: "Hent vunne salgsmuligheter fra Lime CRM, opprett manglende kunder i ReAI og legg hvert vunnet salg inn som ordre. Gratis og åpen kildekode."
summary: "Hent vunne salgsmuligheter og tilhørende selskaper fra Lime CRM og lag kunder og ordre i ReAI."
industry: operations
webAppUrl: /app/lime/
sourcePath: web/worker/apps/lime/
highlights:
  - "Leser vunne salgsmuligheter med Lime CRM sitt Limeobject API og en API-nøkkel"
  - "Finner kunden i ReAI på organisasjonsnummer eller navn, og oppretter den hvis den mangler"
  - "Lager én ordre per salgsmulighet, med sperre mot dobbel føring"
---

## Dette kommer over i ReAI

Integrasjonen henter salgsmuligheter med status **Avtale** (`agreement`) og ordredato fra og med valgt dato, sammen med selskapet hver av dem tilhører. Du ser listen før noe sendes til ReAI.

| Fra Lime CRM | I ReAI |
| --- | --- |
| Selskap med navn og organisasjonsnummer | Kunde, opprettet bare når du klikker **Create** |
| Vunnet salgsmulighet med verdi | Ordre med én linje, ekstern referanse `lime-<id>` |

Ordrelinjen bruker verdien fra Lime CRM som pris eksklusive MVA og standard MVA-kode for kunden. Kontroller ordren i ReAI før du fakturerer.

## Slik kommer du i gang

1. Be en administrator opprette en API-bruker i Lime CRM Server Administration (LISA) under **Databases → Security → Users** med brukertype **API**, og trykk **Create API key**. Gi brukeren lesetilgang til selskaper og salgsmuligheter.
2. Finn adressen til Lime CRM-applikasjonen, for eksempel `https://firma.lime-crm.com/lime-crm`. Den interaktive API-dokumentasjonen ligger på samme adresse med `/api/v1/docs/` til slutt.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Lim inn adressen og API-nøkkelen, velg dato og klikk **Scan Lime CRM**.
5. Opprett manglende kunder og legg inn ordrene du vil fakturere.

Feltnavnene følger standardoppsettet i Lime CRM. Har dere en tilpasset datamodell, må feltene `name`, `registrationno`, `company`, `value`, `dealstatus` og `closeddate` finnes. API-nøkkelen brukes bare til denne ene forespørselen og lagres aldri.
