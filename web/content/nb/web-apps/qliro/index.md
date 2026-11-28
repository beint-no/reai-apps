---
title: "Integrasjon mellom Qliro Checkout og regnskap"
seoTitle: "Avstemming av Qliro oppgjør mot bank i ReAI"
description: "Avstem oppgjørsbunter fra Qliro Checkout mot banktransaksjoner i ReAI og last ned en CSV for avstemmingen. Gratis og åpen kildekode."
summary: "Hent oppgjørsbunter fra Qliro via Admin API og match hver bankoverføring mot en uavstemt banktransaksjon i ReAI."
industry: payments
webAppUrl: /app/qliro/
sourcePath: web/worker/apps/qliro.js
highlights:
  - "Leser oppgjørsbunter fra Qliro med API secret for Qliro Checkout"
  - "Viser beløp, gebyrer og betalingsleverandør for hver overføring"
  - "Matcher buntene mot uavstemte banktransaksjoner i ReAI innenfor 8 dager"
---

## Dette overføres til ReAI

Qliro samler oppgjorte transaksjoner i bunter, én per bankoverføring og betalingsleverandør (for eksempel Qliro, Nets eller Trustly). Integrasjonen viser buntene som ble overført i valgt måned med totalbeløp, gebyrer og bunt-ID. Hver bunt matches mot uavstemte transaksjoner på bankkontoen du velger i ReAI: samme beløp innenfor 8 dager, og bunt-ID når den står i bankteksten.

Ingenting bokføres. Avstemmingstabellen og CSV gir deg grunnlaget for å føre Qliro utbetalinger og gebyrer i ReAI, vanligvis mellom bankkontoen (`1920`) og mellomkontoen du bruker for Qliro.

## Oppsett

1. Finn API secret for produksjon som Qliro ga deg for butikken med Qliro Checkout. Spør butikksupporten til Qliro hvis du ikke har den.
2. Klikk **Åpne integrasjon**, koble til ReAI, velg bankkonto og måned, og lim inn API secret.

API secret brukes bare til å signere forespørselen og sendes eller lagres aldri.
