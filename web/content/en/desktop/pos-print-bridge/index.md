---
title: "POS Print Bridge for Mac & Windows"
seoTitle: "ReAI POS Print Bridge: Receipt Printer and Cash Drawer for ReAI POS"
description: Print ReAI POS receipts on Epson TM and Star ESC/POS receipt printers and open the cash drawer from a Mac or Windows PC, with no browser print dialog.
summary: Prints new ReAI POS receipts on an ESC/POS receipt printer and opens the cash drawer for cash payments.
industry: payments
icon: icons/pos-print-bridge.svg
appId: pos-print-bridge
sourcePath: apple/pos-print-bridge
highlights:
  - "Receipts from Salg on app.reai.no and the ReAI POS apps for iOS and Android"
  - "Epson TM and Star in ESC/POS mode, network (port 9100) or USB, 58 or 80 mm paper"
  - "Cash drawer opens for cash payments; each original prints once, copies are made in ReAI"
windowsAppId: pos-print-bridge-windows
windowsSourcePath: windows/pos-print-bridge
---

## Receipts at the counter without a print dialog

For shops and cafés that sell with ReAI POS. The bridge runs in the Mac menu bar or the Windows notification area, reads new fiscal receipts for the chosen cash points from ReAI every few seconds and prints each one once. Prices, VAT and totals are printed as recorded in ReAI, in the same content and order as ReAI's receipt PDF.

## Safe after restarts

Every receipt is saved in a local ledger before printing. A restart never prints a receipt twice, and receipts made while the computer was off print when it starts again. If the printer may have received part of a receipt, the bridge never sends it again; make a copy in ReAI if no receipt came out. Receipts from before you choose a cash point are never printed.
