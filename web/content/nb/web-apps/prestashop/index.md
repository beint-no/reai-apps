---
title: "Integrasjon mellom PrestaShop og regnskap"
seoTitle: "Integrasjon mellom PrestaShop og ReAI: produkter og ordrer"
description: "Opprett produkter fra PrestaShop i ReAI og gjør gyldige nettbutikkordrer om til ordreutkast, via det innebygde Webservice i PrestaShop. Gratis og åpen kildekode."
summary: "Hent produkter og gyldige ordrer fra PrestaShop Webservice og overfør dem til ReAI."
industry: ecommerce-logistics
webAppUrl: /app/prestashop/
sourcePath: web/worker/apps/prestashop/
highlights:
  - "Bruker det innebygde Webservice i PrestaShop, uten ekstra modul"
  - "Sammenligner referansen på produktet med varenumrene i ReAI"
  - "Oppretter ordreutkast med fast ekstern referanse per ordre, så samme ordre ikke kommer inn to ganger"
---

## Dette kommer over i ReAI

Integrasjonen leser produktene og de nyeste gyldige ordrene i PrestaShop, sammen med kunden på hver ordre. Produkter med en referanse som ikke finnes i ReAI, kan du opprette med pris eksklusive MVA. En ordre kan bli et ordreutkast når kunden finnes i ReAI med samme e-post eller navn.

| Fra PrestaShop | I ReAI |
| --- | --- |
| Produkt med referanse og pris | Produkt med varenummer og salgspris |
| Gyldig ordre | Ordreutkast med én linje for ordresummen eksklusive MVA og ekstern referanse `prestashop-<id>` |

Kontroller MVA-kode og valuta på ordreutkastet før du fakturerer.

## Slik kommer du i gang

1. I administrasjonen i PrestaShop går du til **Advanced Parameters → Webservice** og slår på Webservice.
2. Legg til en nøkkel med `GET`-tilgang til `products`, `orders` og `customers`, og kopier den.
3. Klikk **Åpne integrasjon**, koble til ReAI og velg selskap.
4. Legg inn adressen til nettbutikken og nøkkelen, og klikk **Scan PrestaShop**.
5. Opprett nye produkter og klikk **Stage order** på ordrene du vil fakturere.

Nøkkelen brukes bare til denne skanningen og lagres aldri.
