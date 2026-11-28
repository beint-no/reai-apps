---
title: "Integrasjon mellom 24Nettbutikk og regnskap"
seoTitle: "24Nettbutikk og ReAI: produkter og betalte ordrer"
description: "Hent produkter og betalte ordrer fra 24Nettbutikk-API-et og overfør dem til ReAI med riktige MVA-satser."
summary: "Opprett manglende produkter i ReAI og legg betalte ordrer fra 24Nettbutikk inn som ordrer i ReAI."
industry: ecommerce-logistics
icon: icons/24nettbutikk.svg
webAppUrl: /app/24nettbutikk/
sourcePath: web/worker/apps/24nettbutikk.js
highlights:
  - "Henter produkter, betalte ordrer og kunder fra 24Nettbutikk-API-et"
  - "Bruker MVA-satsen på hver ordrelinje fra nettbutikken"
  - "Stopper duplikater på varenummer og ordrenummer"
---

## Produkter og ordrer fra 24Nettbutikk

Integrasjonen henter produktene og de betalte ordrene for én måned fra 24Nettbutikk. Produkter som mangler i ReAI kan opprettes med ett klikk. Betalte ordrer legges inn som ordrer i ReAI med samme linjer og MVA-satser som i nettbutikken, og ordrenummeret lagres som ekstern referanse slik at samme ordre ikke kan legges inn to ganger.

Kunden i ReAI finnes ut fra organisasjonsnummer eller e-postadresse. Ordrer som er betalt delvis med gavekort må føres for hånd.

Bruk gjerne integrasjonen sammen med avstemming for [Vipps](/nb/web-apps/vipps/), [Klarna](/nb/web-apps/klarna/) og [Nets Easy](/nb/web-apps/nets/).

## Slik kobler du 24Nettbutikk til ReAI

1. Logg inn i 24Nettbutikk, klikk på navnet ditt og velg **API Nøkler**.
2. Klikk **Generer tilfeldig kode** og kopier nøkkelen. Den vises bare én gang.
3. Klikk **Åpne integrasjon**, koble til ReAI og fyll inn adressen til nettbutikken, API-nøkkelen og måneden.
4. Kontroller produktene og ordrene, og overfør dem til ReAI.
