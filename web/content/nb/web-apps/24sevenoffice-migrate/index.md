---
title: "Bytt fra Finago Office (24SevenOffice) til ReAI"
seoTitle: "Bytt fra Finago Office (24SevenOffice) til ReAI: kunder, leverandører og produkter"
description: "Hent kunder, leverandører og produkter fra Finago Office API og opprett dem i ReAI med nummer og organisasjonsnummer."
summary: "Flytt kunder, leverandører og produkter fra Finago Office til ReAI."
industry: operations
webAppUrl: /app/24sevenoffice-migrate/
sourcePath: web/worker/apps/24sevenoffice-migrate/
highlights:
  - "Leser kunder, leverandører og produkter fra Finago Office API"
  - "Tar med kundenummer, leverandørnummer, organisasjonsnummer, e-post og pris"
  - "Hopper over kontakter og produkter som allerede finnes i ReAI"
---

## Dette kommer over i ReAI

Integrasjonen henter kunder, leverandører og produkter fra Finago Office og viser alt før noe sendes til ReAI. Du importerer hver rad med ett klikk. Finnes organisasjonsnummeret, kundenummeret eller varenummeret allerede i ReAI, opprettes ingen ny post.

| Fra Finago Office | I ReAI |
| --- | --- |
| Kunde | Kunde med samme nummer, organisasjonsnummer, e-post, telefon og postadresse |
| Leverandør | Leverandør med samme nummer, organisasjonsnummer og e-post |
| Produkt | Produkt med varenummer som SKU, pris eksklusive MVA, innkjøpspris og EAN |

Produktene får standard MVA-kode og salgskonto i ReAI, så kontroller dem etter importen. Inngående balanse fører du fra SAF-T-filen i [SAF-T-verktøyet](/app/saft/).

## Slik kommer du i gang

1. Be Finago om API-tilgang med skjemaet som er lenket i [API-veiledningen for Finago Office](https://rest-api.developer.24sevenoffice.com/doc/v1/). Finago aktiverer da **Utvikler** nederst i menyen i Finago Office.
2. Åpne **Utvikler**, opprett en applikasjon, gi den lesetilgang til kunder og produkter, og kopier **Application ID / Client ID** og **Client Secret**.
3. Gå til **Administrasjon → Integrasjoner**, klikk **Connect Application**, lim inn Application ID og godta tilgangene.
4. Finn organization ID: det er klient-ID-en i Finago, tallet foran `@voucher.24sevenoffice.com` under **Administration → Settings → Retrieval** (engelske menynavn i dokumentasjonen fra Finago).
5. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
6. Fyll inn client ID, client secret og organization ID og hent dataene. Kontroller listen og klikk **Import to ReAI** på radene du vil flytte.

Klienthemmeligheten brukes bare til denne ene forespørselen og lagres aldri.
