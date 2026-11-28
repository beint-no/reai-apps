---
title: "Integrasjon mellom Upsales og regnskap"
seoTitle: "Vunne ordrer fra Upsales til ReAI | Gratis integrasjon"
description: "Hent vunne ordrer fra Upsales via API og legg dem inn som ordreutkast i ReAI med ordrelinjene, med kunder opprettet fra selskapene i Upsales. Gratis og åpen kildekode."
summary: "Legg vunne ordrer fra Upsales inn som ordrer i ReAI og opprett kundene som mangler."
industry: operations
webAppUrl: /app/upsales/
sourcePath: web/worker/apps/upsales/
highlights:
  - "Leser vunne ordrer i en periode via Upsales API"
  - "Beholder ordrelinjene når de summerer seg til ordreverdien"
  - "Legger inn hver ordre bare én gang, med sjekk mot duplikater i ReAI"
---

## Dette kommer over i ReAI

Integrasjonen leser vunne ordrer i Upsales med ordredato i perioden du velger, sammen med selskapene de hører til. Selskapene sammenlignes med kundene i ReAI på organisasjonsnummer eller navn, og du oppretter de som mangler med ett klikk. Deretter kan hver ordre legges inn som ordreutkast i ReAI.

| Fra Upsales | I ReAI |
| --- | --- |
| Selskap med navn, organisasjonsnummer og adresse | Kunde |
| Vunnet ordre med valuta og ordrelinjer | Ordreutkast med de samme linjene |
| Ordrens id | Ekstern referanse som hindrer duplikater |

Prisene brukes uten MVA, og ReAI bruker kundens standard MVA-kode. Hvis linjene ikke summerer seg til ordreverdien, får ordren én linje med ordreverdien. Kontroller ordren før du fakturerer.

## Slik kommer du i gang

1. I Upsales aktiverer en administrator API under **Settings → Account → Billing portal → Products** hvis det ikke er aktivt.
2. Gå til **Settings → Account → Security → API keys**, opprett en ny nøkkel og kopier den.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Lim inn nøkkelen, velg periode og hent.
5. Opprett kundene som mangler, hent på nytt og klikk **Stage order** for hver ordre.

Nøkkelen brukes bare til disse forespørslene og lagres aldri.
