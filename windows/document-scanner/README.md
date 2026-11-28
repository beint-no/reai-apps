# ReAI Document Scanner for Windows

Scan documents, capture receipts and upload files from a Windows PC to ReAI. It works like [Document Scanner for Mac](../../apple/document-scanner).

Native WinUI 3, Windows 11 25H2+, x64 or ARM64.

## Download

[Download for Windows](https://beint-no.github.io/reai-apps/#document-scanner): x64 for Intel/AMD PCs, ARM64 for ARM-based PCs. Check **Settings → System → About → System type** if unsure.

1. Download the ZIP for your processor from the app’s GitHub release.
2. Right-click it → **Extract All**. Keep the entire extracted folder together.
3. Open **ReAI.DocumentScanner.exe** from that folder.

The app is self-contained: no .NET installation, developer tools or administrator access is needed.

**Unsigned download.** Windows may show “Unknown publisher” or block it. If SmartScreen offers **More info → Run anyway**, you can choose it after confirming the download is from `beint-no/reai-apps` and you trust it. Smart App Control, S mode or workplace policy can block it with no per-app override. Keep Windows security protections enabled; this download cannot run on every locked-down PC.

The release includes `SHA256SUMS`. To check a download, run `Get-FileHash .\ReAI-Document-Scanner-Windows-x64.zip -Algorithm SHA256` in PowerShell (use the ARM64 filename when applicable) and compare with the matching checksum. Checksums detect changed downloads; they are not a trusted publisher signature.

To update, click **Check for updates** in the app: it downloads the new version, verifies it and restarts into it in the same folder. While running, the app also checks once a day on weekdays when idle, downloads a new version in the background and installs it when you quit; **Restart to update** installs it immediately. Updates come from this repository's GitHub releases and replace only the app's own files; if the folder cannot be written, download the new version here instead.

[Windows security behavior](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions)

## Connect

Click **Connect to ReAI**, compare the code in your browser, choose a company and approve. Your user needs permission to upload to the destinations you use.

## Add documents

- **Destination.** Choose Documents, Supplier invoices, Income reception or Receipt reception.
- **Drop or choose files.** Drag files into the window or click **Choose files…**. Originals stay in place; the app keeps a local copy and a history of every upload.
- **Capture receipt.** Press **Ctrl+Shift+B** in any app. The Snipping Tool opens; select the receipt and the snip uploads to Receipt reception as a PNG. A Windows notification confirms the result. If another app already uses Ctrl+Shift+B, use **Capture receipt** in the window or in the notification area menu.
- **Scan document.** **Scan document…** lists scanners that Windows recognizes (Settings → Bluetooth & devices → Printers & scanners). Scan page by page from the flatbed, or all pages from the document feeder; the pages upload as one PDF.
- **Notification area.** Closing the window keeps the app running. Click the icon for the quick drop panel: drop files there to upload them to its destination (Receipt reception unless you change it) and see the latest uploads. Right-click the icon for **Capture receipt**, **Pause uploads** and **Quit**. Windows does not let notification area icons accept drops directly.
- **Watched folders.** Click **Add watched folder…** to upload new or changed files in a folder to the current destination while the app is running. Existing files are skipped when the folder is added. Subfolders are not watched.

ReAI accepts PDF, PNG, JPEG, AVIF, BMP and GIF, up to 20 MB per file. HEIC, TIFF and WebP images are converted to JPEG with Windows' image codecs (HEIC needs the HEIF Image Extensions from Microsoft). Other file types are skipped in watched folders and refused when added by hand.

## Upload safety

- Identical file contents already uploaded for the same company and destination are skipped.
- If an upload is interrupted or ReAI does not answer, it is marked **Check ReAI**. Check ReAI before retrying: the server may already have received it. **Retry…** asks for confirmation.
- If ReAI rejects a file (for example an unsupported type or missing permission), it is marked **Not uploaded** and **Retry** sends it again.
- Uploads waiting from the last session start paused; click **Resume uploads**.
- To change company, disconnect and connect again. Watched folders stay with the account and company they were added for.

## Access and privacy

The access key stays in Windows Credential Locker and is bound to the approved company. Requests go only to `https://app.reai.no`, with redirects blocked. There is no analytics or third-party upload service.

`%LOCALAPPDATA%\ReAI\DocumentScanner` holds `state.json` (upload history, watched folders and destination choices; no access key) and `copies\` (local copies of uploaded files). Keep it to preserve duplicate protection. If `state.json` cannot be read, uploads pause instead of starting over. Captures and scans are written to a temporary folder and removed after they are copied.

Disconnect removes the local key; revoke server access in your [ReAI profile](https://app.reai.no/user/profile#user-access-tokens). To uninstall, quit the app from the notification area menu, delete the extracted folder and, if you no longer need the history and copies, `%LOCALAPPDATA%\ReAI\DocumentScanner`.

## Development

The SDK is pinned in [global.json](../global.json); this app’s [project](ReAI.DocumentScanner.csproj) and lockfile record its Windows dependencies.

On macOS, build the app-local logic from `windows/`: `dotnet build document-scanner/Core`. WinUI, the notification area, capture and scanning require Windows. CI builds both architectures and checks native startup.

```powershell
./tools/windows/build.ps1 -App document-scanner-windows -Architecture x64
```

API: `/api/me`, `/api/documents`, `/api/invoice-reception-documents`, `/api/income-reception-documents` and `/api/receipt-reception-documents`. Authentication uses the registration-free device flow with `document-scanner-windows`.
