---
title: Kvitteringsskriver for ReAI POS
seoTitle: "ReAI POS Print Bridge: Kvitteringsskriver og kassaskuff for ReAI POS"
description: Skriv ut kvitteringer fra ReAI POS på Epson TM- og Star-skrivere med ESC/POS og åpne kassaskuffen fra Mac eller Windows, uten utskriftsdialog i nettleseren.
summary: Skriver ut nye kvitteringer fra ReAI POS på en ESC/POS-kvitteringsskriver og åpner kassaskuffen ved kontantbetaling.
industry: payments
icon: icons/pos-print-bridge.svg
appId: pos-print-bridge
sourcePath: apple/pos-print-bridge
highlights:
  - "Kvitteringer fra Salg på app.reai.no og ReAI POS-appene for iOS og Android"
  - "Epson TM og Star i ESC/POS-modus, nettverk (port 9100) eller USB, 58 eller 80 mm papir"
  - "Kassaskuffen åpnes ved kontantbetaling; hver original skrives ut én gang, kopier lages i ReAI"
windowsAppId: pos-print-bridge-windows
windowsSourcePath: windows/pos-print-bridge
---

## Kvitteringer ved disken uten utskriftsdialog

For butikker og kafeer som selger med ReAI POS. Appen ligger i menylinjen på Mac eller i varslingsområdet på Windows, henter nye salgskvitteringer for de valgte kassapunktene fra ReAI med noen sekunders mellomrom og skriver ut hver kvittering én gang. Priser, MVA og totaler skrives ut slik de er registrert i ReAI, med samme innhold og rekkefølge som kvitteringen i PDF fra ReAI.

## Trygt etter omstart

Hver kvittering lagres i en lokal logg før utskrift. En omstart skriver aldri ut samme kvittering to ganger, og kvitteringer fra mens maskinen var av skrives ut når den starter igjen. Hvis skriveren kan ha mottatt deler av en kvittering, sender appen den aldri på nytt; lag en kopi i ReAI hvis ingen kvittering kom ut. Kvitteringer fra før du velger kassapunkt skrives aldri ut.
