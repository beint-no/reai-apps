# ReAI POS Print Bridge

Prints ReAI POS receipts on an ESC/POS thermal receipt printer and opens the cash drawer, without browser print dialogs. It works for sales from Salg in app.reai.no and from the ReAI POS apps on iOS and Android: the Mac reads new fiscal receipts from ReAI and prints each one once.

Menu bar app for Apple Silicon Macs with macOS 15 or later. It works like [POS Print Bridge for Windows](../../windows/pos-print-bridge).

## Install and connect

1. Download the signed, Apple-notarized DMG from [ReAI Apps](https://beint-no.github.io/reai-apps/#pos-print-bridge), open it and drag **ReAI POS Print Bridge** into **Applications**.
2. Open the app. The printer icon appears in the menu bar and the settings window opens.
3. Click **Connect to ReAI**, compare the code in your browser, choose one company and approve. Your user needs kassasystem read and company read permission.
4. Under **Cash points**, tick the cash points this Mac prints for, or **All cash points**. **Find cash points** lists cash points with receipts in the last 30 days; you can also add a cash point ID shown on a ReAI receipt.
5. Under **Receipt printer**, choose the printer and paper width, then click **Test print**.
6. Turn on **Open at login** so printing starts with the Mac.

Receipts from before you choose a cash point are not printed. Let one computer print each cash point, otherwise each receipt prints on every connected computer.

## Printers

- **Network printer (port 9100):** enter the printer's IP address or host name. Epson TM-T20/T88/m30 and Star printers with Ethernet or Wi-Fi accept raw ESC/POS on TCP port 9100. Give the printer a fixed IP address in your router.
- **Installed printer (raw):** a USB printer added under **System Settings → Printers & Scanners**. The app sends raw ESC/POS with `lp -o raw`, bypassing the driver. Star printers must be set to ESC/POS mode (Star Line mode is not supported).
- **Paper width:** 80 mm prints 48 characters per line, 58 mm prints 32.
- **Characters:** text is sent in code page PC865 (Nordic, `ESC t 5`), which contains Æ, Ø and Å on every Epson TM model. Characters outside PC865 are replaced by the closest letter or `?`.
- **Cash drawer:** connect the drawer to the printer's RJ11/RJ12 drawer port. With **Open cash drawer for cash payments** on, receipts with a cash payment or cash refund open the drawer (`ESC p`, pin 2). **Open drawer** opens it manually. Copies never open the drawer.
- **Receipt QR code:** prints the same identifier as ReAI's receipt PDF (`reai:receipt:<company>:<cash point>:<Oslo date>:<receipt number>`) with `GS ( k`. Turn it off if your printer cannot print QR codes.

## What is printed

The receipt follows the content and order of ReAI's fiscal receipt PDF: the statutory heading (**Salgskvittering**, **Returkvittering** and so on), company name, address, organization number with **MVA** when VAT registered, **Foretaksregisteret** for AS, ASA and NUF, receipt number, date and time (Oslo), lines with quantity, VAT rate and amount, discounts, subtotal excluding VAT, VAT, total, payment methods and transaction IDs, VAT per rate, cash point ID and the receipt QR code.

Everything comes from ReAI's public API. Prices, VAT and totals are printed as recorded in the receipt snapshot; the app never recalculates them. A receipt the app cannot lay out from ReAI's data, for example with a VAT code that has no rate, is held as **Print it from ReAI** and is never printed automatically.

## Copies and reprints

**Print copy** prints one copy of a receipt marked **KOPI** in double-size text, as kassasystemforskriften § 2-8-6 requires. Only one copy can be printed per receipt (§ 2-6). The copy is not yet recorded in ReAI's electronic journal; ReAI's public API has no endpoint for it.

## Recovery

- Each receipt is saved in a local ledger before printing. Restarting never prints a receipt twice, and receipts that arrived while the Mac was off print when it starts again.
- If the printer cannot be reached, nothing was sent: the receipt waits and is retried with increasing delays up to one minute.
- If the connection breaks while sending, or the app stops mid-print, the receipt is marked **Check the printer** and is never printed again automatically. Use **Print** only if no receipt came out.
- Receipts older than 24 hours when the printer becomes available are not printed automatically; print them manually if still needed.
- **Sent to printer** means the printer or the macOS queue accepted the job. Check the printer if it is out of paper.

The app checks ReAI every 3 seconds, backing off to one minute on errors. **Pause printing** stops checking; receipts made while paused print when you resume.

## Privacy and removal

The access key stays in Keychain (`no.reai.posprintbridge`) and is bound to the approved company. Requests go only to `https://app.reai.no`, with redirects blocked. The bridge only reads from ReAI. Settings and the receipt ledger (receipt IDs, numbers, totals and print states, kept for 30 days) are in `~/Library/Application Support/ReAI POS Print Bridge/bridge.json`. If that file cannot be read, printing pauses rather than starting over.

To remove: **Disconnect**, quit from the menu bar icon, delete the app and optionally the Application Support folder. Revoke access in your [ReAI profile](https://app.reai.no/user/profile#user-access-tokens). To update, quit and replace the app in Applications.

## API

`/api/me`, `/api/company-settings`, `/api/vat-codes`, `/api/kassasystem/sales` and `/api/kassasystem/sales/{id}`. Authentication uses the device flow with client `pos-print-bridge`. See the [public API](https://app.reai.no/openapi/public/ui).
