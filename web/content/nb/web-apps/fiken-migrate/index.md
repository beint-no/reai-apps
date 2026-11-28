---
title: "Bytt fra Fiken til ReAI"
seoTitle: "Bytt fra Fiken til ReAI: kunder og leverandører fra SAF-T"
description: "Last opp SAF-T-filen fra Fiken og flytt kunder og leverandører til ReAI med kundenummer, leverandørnummer og organisasjonsnummer."
summary: "Flytt kunder og leverandører fra Fiken til ReAI med SAF-T-filen."
industry: operations
webAppUrl: /app/fiken-migrate/
sourcePath: web/worker/apps/fiken-migrate.js
highlights:
  - "Leser kunder og leverandører fra SAF-T Regnskap, standardformatet fra Skatteetaten"
  - "Tar med kundenummer, leverandørnummer, organisasjonsnummer og e-post"
  - "Hopper over kontakter som allerede finnes i ReAI med samme organisasjonsnummer"
---

## Dette kommer over i ReAI

Integrasjonen leser kunde- og leverandørregisteret i SAF-T-filen og viser alle kontaktene før noe sendes til ReAI. Du importerer hver kontakt med ett klikk. Finnes organisasjonsnummeret allerede i ReAI, opprettes ingen ny kontakt.

| Fra SAF-T | I ReAI |
| --- | --- |
| Kunde med kundenummer | Kunde med samme nummer |
| Leverandør med leverandørnummer | Leverandør med samme nummer |
| Organisasjonsnummer og e-post | Organisasjonsnummer og e-post på kontakten |

Inngående balanse fra samme fil fører du i [SAF-T-verktøyet](/app/saft/). Produkter finnes ikke i SAF-T-filen og må legges inn i ReAI eller importeres fra en produktliste.

## Slik kommer du i gang

1. Ta ut SAF-T-filen (SAF-T Regnskap) for siste regnskapsår fra Fiken. Søk etter SAF-T i hjelpesenteret til Fiken hvis du ikke finner eksporten. Pakk ut filen hvis du får en ZIP-fil.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
3. Last opp XML-filen og kontroller listen over kunder og leverandører.
4. Klikk **Import to ReAI** på kontaktene du vil flytte.

Filen leses bare for denne forespørselen og lagres ikke.
