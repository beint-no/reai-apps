# Windows Document Scanner

Native .NET / WinUI 3 version of the Mac Document Scanner, Windows 11 25H2+, x64 and ARM64. Follow windows/AGENTS.md and keep upload behavior aligned with apple/document-scanner/AGENTS.md; ReAI owns analysis, registration and permissions.

Core owns the public API client, staging, duplicate detection, the upload queue, watched folders, the PDF writer and the updater; it builds and can be exercised on macOS. The app project owns the WinUI windows, Credential Locker, the notification area icon, the Ctrl+Shift+B hot key, clipboard pickup, Windows imaging and scanning. Read /openapi/public before changing requests. Device authorization uses client `document-scanner-windows`.

Uploads use only `POST /api/documents`, `/api/invoice-reception-documents`, `/api/income-reception-documents` and `/api/receipt-reception-documents`, one multipart `files` part per request, max 20 MB, with `X-Tenant-Id` and `Accept-Language: en`. Uploading never registers or pays anything.

Save the transfer as Uploading BEFORE sending. An upload without a definite answer becomes "Check ReAI" (also after a restart) and is retried only after explicit confirmation; a 4xx answer other than 408/429 means ReAI did not create it ("Not uploaded") and may be retried directly. Duplicates are detected by SHA-256 of the original bytes per company and destination. Never replace an unreadable `state.json`: uploads pause instead.

Notification area icons cannot accept drops on Windows; the icon opens the always-on-top quick drop panel. Region capture opens `ms-screenclip:` and uploads the next clipboard image within two minutes. Scanning uses Windows.Devices.Scanners only (no direct WIA or TWAIN); pages are saved as JPEG and combined by `PdfWriter` without re-encoding.

The app updates itself in place like Shipping (`Core/Updater.cs`): it reads `updates/document-scanner-windows.json` from Pages, downloads the release ZIP for its architecture from this repository's releases only, verifies the SHA-256, stages it under `%LOCALAPPDATA%\ReAI\DocumentScanner\update`, and installs after the app quits. Never update while uploading. Closing the window keeps the app running in the notification area; Quit is in the icon's menu. Build both architectures in CI; temporary tests live outside the repository.
