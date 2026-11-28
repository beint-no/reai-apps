---
title: "Workfeed og regnskap"
seoTitle: "Timer fra Workfeed til ReAI Timelister"
description: "Hent gjennomførte vakter fra Workfeed og før timene inn i ReAI Timelister per ansatt som grunnlag for lønn og prosjektfakturering."
summary: "Les godkjente vakter fra Workfeed med din API-nøkkel og før timene inn i ReAI Timelister."
industry: operations
webAppUrl: /app/workfeed/
sourcePath: web/worker/apps/workfeed.js
highlights:
  - "Bruker det åpne API-et til Workfeed med din egen API-nøkkel"
  - "Vaktlengde minus registrert pause, kun godkjente vakter som standard"
  - "Ansatte matches mot ReAI på e-post eller navn"
---

## Dette overføres til ReAI

Hver vakt i Workfeed som har en ansatt, blir en timeføring i ReAI. Timene er vaktlengden minus registrert pause, og datoen er norsk kalenderdag for vaktstart. Kommentaren viser avdeling og vakt-ID fra Workfeed. Ansatte matches mot ReAI på e-post eller navn, og du kan knytte alle timene til ett prosjekt i ReAI.

Timeføringer er ikke bilag. De er grunnlag for lønn og prosjektfakturering i ReAI, der du godkjenner dem som vanlig.

## Oppsett

1. Gå til **Innstillinger → Integrasjoner → Workfeed API** i Workfeed, lag en nøkkel og gi den et navn. Det åpne API-et krever Pro+.
2. Klikk **Åpne integrasjon**, koble til selskapet ditt i ReAI og fyll inn nøkkelen, selskaps-ID i Workfeed og perioden.
3. La **Approved shifts only** være huket av for lønn, og hent vaktene.
4. Kontroller timene og før dem inn én og én eller alle matchede vakter samtidig.

API-nøkler i Workfeed kan også endre data i Workfeed. Appen leser bare vakter, ansatte og avdelinger, og bruker nøkkelen til én forespørsel uten å lagre den. Slett nøkkelen i Workfeed når du ikke lenger trenger den.
