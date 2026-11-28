---
title: "Integrasjon mellom Husleie.no og regnskap"
seoTitle: "Integrasjon mellom Husleie.no og regnskap for ReAI"
description: "Last opp rapporten over leieforhold fra Husleie.no og klargjør månedlig leiefakturering i ReAI med full kontroll før aktivering."
summary: "Overfør aktive leieforhold fra Husleie.no til faste abonnementer i ReAI med automatisk fakturering avslått."
industry: real-estate
webAppUrl: /app/husleie/
sourcePath: web/worker/apps/husleie.js
highlights:
  - "Leser CSV fra rapporten Leieforhold i MinHusleie"
  - "Finner leietakeren i ReAI på e-post eller navn"
  - "Oppretter abonnementer med automatisk fakturering avslått til du godkjenner dem"
---

## Fra Husleie.no til leiefakturering i ReAI

Rapporten **Leieforhold** i MinHusleie viser leietaker, leieobjekt, husleie og kontraktsperiode for alle leieforhold. Integrasjonen leser CSV fra denne rapporten, hopper over avsluttede leieforhold og lager et månedlig abonnement i ReAI for hver leietaker som finnes i kunderegisteret. Leieforhold som allerede løper, starter faktureringen den første i neste måned.

Husleie.no har også et API, men dokumentasjon og tilgang får du bare fra kundeservice hos Husleie.no. Derfor bruker integrasjonen eksporten.

## Slik setter du det opp

1. Åpne **Rapporter → Leieforhold** i MinHusleie og last ned listen som CSV under tabellen. Rapporten krever at du er registrert som profesjonell utleier.
2. Klikk **Åpne integrasjon**, koble til ReAI og velg MVA-koden for husleien. Utleie av bolig er unntatt fra MVA.
3. Last opp filen, kontroller leietaker, beløp og startdato, og klikk **Stage subscription**.
4. Slå på automatisk fakturering i ReAI når vilkårene stemmer.
