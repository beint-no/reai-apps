---
title: "Bytt fra PowerOffice Go til ReAI"
seoTitle: "Bytt fra PowerOffice Go til ReAI: kunder, leverandører og produkter"
description: "Hent kunder, leverandører og produkter fra PowerOffice Go API og opprett dem i ReAI med nummer og organisasjonsnummer."
summary: "Flytt kunder, leverandører og produkter fra PowerOffice Go til ReAI."
industry: operations
webAppUrl: /app/poweroffice-migrate/
sourcePath: web/worker/apps/poweroffice-migrate/
highlights:
  - "Leser kunder, leverandører og produkter fra PowerOffice Go API"
  - "Tar med kundenummer, leverandørnummer, organisasjonsnummer, e-post og pris"
  - "Hopper over kontakter og produkter som allerede finnes i ReAI"
---

## Dette kommer over i ReAI

Integrasjonen henter aktive kunder, leverandører og produkter fra PowerOffice Go og viser alt før noe sendes til ReAI. Du importerer hver rad med ett klikk. Finnes organisasjonsnummeret eller varenummeret allerede i ReAI, opprettes ingen ny post.

| Fra PowerOffice Go | I ReAI |
| --- | --- |
| Kunde | Kunde med samme nummer, organisasjonsnummer og e-post |
| Leverandør | Leverandør med samme nummer, organisasjonsnummer og e-post |
| Produkt | Produkt med varenummer som SKU og pris eksklusive MVA |

Produktene får standard MVA-kode og salgskonto i ReAI, så kontroller dem etter importen. Inngående balanse fører du fra SAF-T-filen i [SAF-T-verktøyet](/app/saft/).

## Slik kommer du i gang

1. Registrer en egen integrasjon hos PowerOffice ved å skrive til go-api@poweroffice.no. Du får en applikasjonsnøkkel, og abonnementsnøkkelen finner du under **Profile** i PowerOffice Developer Portal.
2. Aktiver integrasjonen i PowerOffice Go. Da får du en klientnøkkel for selskapet.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Fyll inn abonnementsnøkkel, applikasjonsnøkkel og klientnøkkel og hent dataene.
5. Kontroller listen og klikk **Import to ReAI** på radene du vil flytte.

Nøklene brukes bare til denne ene forespørselen og lagres aldri.
