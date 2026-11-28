---
title: "Integrasjon mellom Mystore og regnskap"
seoTitle: "Integrasjon mellom Mystore og ReAI: produkter og ordrer"
description: "Opprett produkter fra Mystore i ReAI etter varenummer og overfør ordrer med riktig MVA-kode. Gratis og åpen kildekode."
summary: "Hent produkter og de siste ordrene fra Mystore API og overfør dem til ReAI."
industry: ecommerce-logistics
webAppUrl: /app/mystore/
sourcePath: web/worker/apps/mystore/
highlights:
  - "Leser produkter og ordrer fra Mystore API med en personlig tilgangsnøkkel"
  - "Oppretter produkter som mangler i ReAI, sammenlignet på varenummer"
  - "Lager en ordre i ReAI per Mystore-ordre med sperre mot dobbel føring"
---

## Dette kommer over i ReAI

Integrasjonen henter produktene med varenummer og de siste ordrene fra Mystore API. Du velger selv hva som skal opprettes i ReAI.

| Fra Mystore | I ReAI |
| --- | --- |
| Produkt med varenummer | Produkt med samme varenummer og pris eks. MVA |
| Ordrelinjer | Ordrelinjer med pris eks. MVA og utgående MVA-kode for satsen i Mystore |
| Frakt, gebyrer og rabatter | Egne ordrelinjer med MVA-satsen fra Mystore |

Ordren knyttes til kunden i ReAI med samme e-post eller navn. En ordre tilbys bare når linjene summerer seg til ordretotalen i Mystore, og hver ordre kan bare overføres én gang.

## Slik kommer du i gang

1. Logg inn på [auth.mystore.no](https://auth.mystore.no/login) med butikknavn og administratorbrukeren din.
2. Åpne **Personal Access Tokens**, velg **Create New Token** og gi tokenet tilgangene `products:read` og `orders:read`. Kopier tokenet, det vises bare én gang.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Fyll inn butikknavn og token og skann butikken. Opprett produktene som mangler, og overfør ordrene du vil fakturere fra ReAI.

Tokenet brukes bare til skanningen og lagres aldri.
