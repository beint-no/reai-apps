---
title: "Bytt fra Finago Office (24SevenOffice) til ReAI"
seoTitle: "Bytt fra Finago Office (24SevenOffice) til ReAI: kunder, leverandører og produkter"
description: "Hent kunder, leverandører og produkter fra Finago Office API og opprett dem i ReAI med nummer og organisasjonsnummer."
summary: "Flytt kunder, leverandører og produkter fra Finago Office til ReAI."
industry: operations
webAppUrl: /app/24sevenoffice-migrate/
sourcePath: web/worker/apps/24sevenoffice-migrate.js
highlights:
  - "Leser kunder, leverandører og produkter fra Finago Office API"
  - "Tar med kundenummer, leverandørnummer, organisasjonsnummer, e-post og pris"
  - "Hopper over kontakter og produkter som allerede finnes i ReAI"
---

## Dette kommer over i ReAI

Integrasjonen henter kunder, leverandører og produkter fra Finago Office og viser alt før noe sendes til ReAI. Du importerer hver rad med ett klikk. Finnes organisasjonsnummeret eller varenummeret allerede i ReAI, opprettes ingen ny post.

| Fra Finago Office | I ReAI |
| --- | --- |
| Kunde | Kunde med samme nummer, organisasjonsnummer og e-post |
| Leverandør | Leverandør med samme nummer, organisasjonsnummer og e-post |
| Produkt | Produkt med varenummer som SKU og pris eksklusive MVA |

Produktene får standard MVA-kode og salgskonto i ReAI, så kontroller dem etter importen. Inngående balanse fører du fra SAF-T-filen i [SAF-T-verktøyet](/app/saft/).

## Slik kommer du i gang

1. Åpne **Utvikler** nederst i menyen i Finago Office. Mangler menyvalget, ber du Finago Office API om å aktivere utviklerpanelet.
2. Opprett en applikasjon, gi den lesetilgang til kunder og produkter, og kopier **Application ID / Client ID** og **Client Secret**.
3. Gå til **Administrasjon → Integrasjoner**, klikk **Connect Application**, lim inn Application ID og godta tilgangene. Kopier **Organization ID** fra integrasjonen.
4. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
5. Fyll inn client ID, client secret og organization ID og hent dataene. Kontroller listen og klikk **Import to ReAI** på radene du vil flytte.

Klienthemmeligheten brukes bare til denne ene forespørselen og lagres aldri.
