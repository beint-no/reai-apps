# ReAI POS Print Bridge for Windows

Prints ReAI POS receipts on an ESC/POS thermal receipt printer and opens the cash drawer, without browser print dialogs. It works for sales from Salg in app.reai.no and from the ReAI POS apps on iOS and Android: the PC reads new fiscal receipts from ReAI and prints each one once. It works like [POS Print Bridge for Mac](../../apple/pos-print-bridge).

Native WinUI 3 with a notification-area icon, Windows 11 25H2+, x64 or ARM64.

## Download

[Download for Windows](https://beint-no.github.io/reai-apps/#pos-print-bridge): x64 for Intel/AMD PCs, ARM64 for ARM-based PCs. Check **Settings → System → About → System type** if unsure.

1. Download the ZIP for your processor from the app's GitHub release.
2. Right-click it → **Extract All**. Keep the entire extracted folder together, for example in `%LOCALAPPDATA%\Programs\ReAI POS Print Bridge`.
3. Open **ReAI.POSPrintBridge.exe** from that folder.

The app is self-contained: no .NET installation, developer tools or administrator access is needed.

**Unsigned download.** Windows may show "Unknown publisher" or block it. If SmartScreen offers **More info → Run anyway**, you can choose it after confirming the download is from `beint-no/reai-apps` and you trust it. Smart App Control, S mode or workplace policy can block it with no per-app override. Keep Windows security protections enabled; this download cannot run on every locked-down PC.

The release includes `SHA256SUMS`. To check a download, run `Get-FileHash .\ReAI-POS-Print-Bridge-Windows-x64.zip -Algorithm SHA256` in PowerShell (use the ARM64 filename when applicable) and compare with the matching checksum. Checksums detect changed downloads; they are not a trusted publisher signature.

To update, quit from the tray icon and extract the new version over the old folder. Your connection, settings and receipt ledger stay in your Windows user profile. [Windows security behavior](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions)

## Connect and print

1. Click **Connect to ReAI**, compare the code in your browser, choose one company and approve. Your user needs kassasystem read and company read permission.
2. Under **Cash points**, tick the cash points this PC prints for, or **All cash points**. **Find cash points** lists cash points with receipts in the last 30 days; you can also add a cash point ID shown on a ReAI receipt.
3. Under **Receipt printer**, choose the printer and paper width, then click **Test print**.
4. Tick **Open at sign-in** so printing starts in the tray when you sign in.

Closing the window keeps printing in the notification area. Click the tray icon to open the window; right-click it for **Test print**, **Open drawer** and **Quit**. Starting the app again shows the running window instead of a second copy.

Receipts from before you choose a cash point are not printed. Let one computer print each cash point, otherwise each receipt prints on every connected computer.

## Printers

- **Network printer (port 9100):** enter the printer's IP address or host name. Epson TM and Star printers with Ethernet or Wi-Fi accept raw ESC/POS on TCP port 9100. Give the printer a fixed IP address in your router.
- **Installed printer (raw):** a USB printer added under **Settings → Bluetooth & devices → Printers & scanners**, for example with the Epson APD or Star driver, or **Generic / Text Only**. The app writes raw ESC/POS through the Windows spooler with the RAW datatype, bypassing the driver's rendering. Star printers must be set to ESC/POS mode.
- **Paper width:** 80 mm prints 48 characters per line, 58 mm prints 32.
- **Characters:** text is sent in code page PC865 (Nordic, `ESC t 5`), which contains Æ, Ø and Å on every Epson TM model. Characters outside PC865 are replaced by the closest letter or `?`.
- **Cash drawer:** connect the drawer to the printer's RJ11/RJ12 drawer port. With **Open cash drawer for cash payments** on, receipts with a cash payment or cash refund open the drawer (`ESC p`, pin 2). **Open drawer** opens it manually. Copies never open the drawer.
- **Receipt QR code:** prints the same identifier as ReAI's receipt PDF with `GS ( k`. Turn it off if your printer cannot print QR codes.

## What is printed

The receipt follows the content and order of ReAI's fiscal receipt PDF: the statutory heading (**Salgskvittering**, **Returkvittering** and so on), company name, address, organization number with **MVA** when VAT registered, **Foretaksregisteret** for AS, ASA and NUF, receipt number, date and time (Oslo), lines with quantity, VAT rate and amount, discounts, subtotal excluding VAT, VAT, total, payment methods and transaction IDs, VAT per rate, cash point ID and the receipt QR code. Prices, VAT and totals are printed as recorded in ReAI; the app never recalculates them. A receipt the app cannot lay out from ReAI's data is held as **Print it from ReAI** and never printed automatically.

**Print copy** prints one copy marked **KOPI** in double-size text (kassasystemforskriften § 2-8-6). Only one copy can be printed per receipt. The copy is not yet recorded in ReAI's electronic journal; ReAI's public API has no endpoint for it.

## Recovery and privacy

- Each receipt is saved in a local ledger before printing. Restarting never prints a receipt twice, and receipts that arrived while the PC was off print when it starts again.
- If the printer cannot be reached, nothing was sent: the receipt waits and is retried with increasing delays up to one minute.
- If the connection breaks while sending, or the app stops mid-print, the receipt is marked **Check the printer** and never printed again automatically. Use **Print** only if no receipt came out.
- Receipts older than 24 hours when the printer becomes available are not printed automatically.
- **Sent to printer** means the printer or the Windows spooler accepted the job. Check the printer if it is out of paper.

The access key stays in Windows Credential Locker and is bound to the approved company. Requests go only to `https://app.reai.no`, with redirects blocked; the bridge only reads from ReAI. `%LOCALAPPDATA%\ReAI\POS Print Bridge\bridge.json` holds your settings and the receipt ledger (receipt IDs, numbers, totals and print states, kept for 30 days); no access key. If it cannot be read, printing pauses rather than starting over.

To uninstall, untick **Open at sign-in**, **Disconnect**, quit from the tray icon and delete the extracted folder and optionally the data folder. Revoke access in your [ReAI profile](https://app.reai.no/user/profile#user-access-tokens).

## Development

The SDK is pinned in [global.json](../global.json); this app's [project](ReAI.POSPrintBridge.csproj) and lockfile record its Windows dependencies.

On macOS, build the receipt renderer, ESC/POS encoder, API client and polling model from `windows/`: `dotnet build pos-print-bridge/Core`. WinUI, the tray icon and the spooler require Windows. CI builds both architectures and checks native startup.

```powershell
./tools/windows/build.ps1 -App pos-print-bridge-windows -Architecture x64
```

API: `/api/me`, `/api/company-settings`, `/api/vat-codes`, `/api/kassasystem/sales` and `/api/kassasystem/sales/{id}`. Authentication uses the device flow with client `pos-print-bridge-windows`.
