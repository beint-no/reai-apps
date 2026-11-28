# ReAI Document Scanner

Scan documents, capture receipts and upload files from your Mac to ReAI. Replaces ReAI Finder Vault.

## Install

Requires **Apple Silicon (M1 or newer)** and **macOS 15+**.

1. [Download Document Scanner](https://beint-no.github.io/reai-apps/#document-scanner).
2. Open **ReAI-Document-Scanner-Apple-Silicon.dmg** and drag **ReAI Document Scanner.app** into Applications.
3. Open the app and click **Connect to ReAI**. Sign in in your browser, compare the code, choose a company, and approve.
4. Choose a destination and add a file, scan a document or capture a receipt.

Published downloads are Developer ID signed and Apple-notarized. No build tools, GitHub account, or security-setting changes are needed.
To update, quit the app and replace it in Applications. Turn on **Open at login** in Settings to keep it running in the menu bar.

## Moving from Finder Vault

1. Quit ReAI Finder Vault.
2. Install and open Document Scanner. It moves Finder Vault's upload history, watched folders, company inbox folders and local copies, once. `~/ReAI Vault` becomes `~/ReAI Document Scanner`.
3. macOS may ask whether Document Scanner may use the `no.reai.findervault` Keychain item. Allow it to keep your connection, or click **Connect to ReAI** to connect again.
4. Delete ReAI Finder Vault from Applications. If you connected again, also remove its old key in your [ReAI profile](https://app.reai.no/user/profile#user-access-tokens).

If Finder Vault is still running, Document Scanner waits: quit Finder Vault and click **Move Finder Vault setup**. Finder Vault's history files stay in `~/Library/Application Support/ReAI Finder Vault` with a `.migrated` suffix, so the old app no longer watches the same folders. A watched folder that cannot be found any more shows **Unavailable**; remove it and choose it again. Older Finder Vault releases stay on GitHub.

## Add documents

- **Destination.** Choose Documents, Supplier invoices, Income reception, or Receipt reception. Your ReAI account needs permission to upload there.
- **Drop or choose files.** Drag files into the window or use **Choose files…**. Originals stay in place; the app keeps a local copy and transfer history.
- **Menu bar.** Drop files on the menu bar icon to upload them to the menu bar destination (Receipt reception unless you change it). Click the icon for recent uploads, capture and iPhone import.
- **Capture receipt.** Press **⇧⌘B** in any app, select the receipt on screen, and it uploads to Receipt reception as a PNG. A notification confirms the result. Change or turn off the shortcut in **Settings → General**. The first capture asks for Screen Recording permission in System Settings → Privacy & Security.
- **iPhone or iPad.** **Import from iPhone…** offers Continuity Camera: **Take Photo** or **Scan Documents** on a nearby iPhone or iPad signed in to the same Apple Account. Scanned pages arrive as one PDF.
- **Scanner.** **Scan with scanner…** uses USB and network scanners known to macOS (Image Capture). Scan page by page from the flatbed or all pages from the document feeder; the pages are uploaded as one PDF.
- **Company inboxes.** Enable **Watch company inboxes** to upload files added to the app's company folders. Use **Open in Finder** to find them.
- **Watched folders.** Add a watched folder to upload new or changed files while the app is running. Existing files are skipped when the folder is first added. Subfolders are not watched.

ReAI accepts PDF, PNG, JPEG, AVIF, BMP and GIF, up to 20 MB per file. HEIC, TIFF and WebP images are converted to JPEG in the local copy; the original is not changed. Other file types are skipped in watched folders and refused when added by hand.

## Upload safety

- Identical file contents already staged for the same company and destination are skipped.
- If an upload is interrupted or ReAI does not answer, it is marked **Check ReAI**. Check ReAI before retrying: the server may already have received it. Retrying asks for confirmation.
- If ReAI rejects a file (for example an unsupported type or missing permission), it is marked **Not uploaded** and can be retried directly.
- To change company, disconnect and connect again. Existing folder mappings remain associated with their original account and company.

### Receipt uploads

Document Scanner sends each file to `POST /api/receipt-reception-documents` as multipart `files`, with the connected company's `X-Tenant-Id`. ReAI analyzes it and returns the reception document ID; uploading does not register or pay the receipt. Open Receipt reception in ReAI to review it. The other destinations use `/api/documents`, `/api/invoice-reception-documents` and `/api/income-reception-documents` the same way. The app sends one file per request.

## Access and privacy

The app connects directly to `https://app.reai.no`. Your password stays in the browser; the access key is stored in macOS Keychain.
The key is restricted to the company chosen during approval, using your existing permissions, until revoked.
**Disconnect** removes the local key. Revoke server access in your [ReAI profile](https://app.reai.no/user/profile#user-access-tokens).
Captures and scans are written to a temporary folder, copied into the local copies and then removed. There is no analytics or third-party upload service.

Local data: `~/ReAI Document Scanner` (company inbox folders and local copies) and `~/Library/Application Support/ReAI Document Scanner` (transfer history and watched folders). To remove the app, quit it from the menu bar, delete it from Applications and delete these folders if you no longer need the copies.

## Development

Swift 6.4, SwiftUI, no third-party dependencies. From the repository root:

```sh
tools/apple/build.py document-scanner
```

Set `SWIFT_BIN` if needed. Development builds appear in `dist/document-scanner/`.
See [release instructions](../../tools/apple/README.md) and the [public API contract](https://app.reai.no/openapi/public).

[MIT license](../../LICENSE) · [Report an issue](https://github.com/beint-no/reai-apps/issues)
