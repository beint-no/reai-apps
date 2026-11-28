Native macOS Document Scanner (formerly Finder Vault). Swift 6.4, SwiftUI, macOS 15+, arm64, no third-party dependencies.
Keep networking and file processing off the main actor. The public ReAI API owns permissions and accounting behavior. Every request binds to an explicit company and sends `Accept-Language: en`.
From the repository root, build/package with `tools/apple/build.py document-scanner`. Follow tools/apple/README.md for signed releases.
Connections use browser approval with one selected company (client `document-scanner`); no manual token entry or client registration.
Uploads use only `POST /api/documents`, `/api/invoice-reception-documents`, `/api/income-reception-documents` and `/api/receipt-reception-documents` with one multipart `files` part per request (max 20 MB). Uploading never registers or pays anything.
Keep source files intact. Duplicate detection hashes the original bytes per company and destination. An upload without a definite answer becomes "Check ReAI" and is retried only after explicit confirmation; a 4xx answer (except 408/429) means ReAI did not create it and may be retried directly. Do not silently duplicate documents.
Capture (`screencapture -i`, Carbon hot key), Continuity Camera (`NSMenuItem.importFromDeviceIdentifier`) and Image Capture scanners all produce a temporary file that goes through the same staging path. Multi-page scans are combined with PDFKit.
`Migration.swift` moves Finder Vault's state once (Application Support JSON, `~/ReAI Vault`, Keychain item). It renames Finder Vault's JSON files to `*.migrated` so the old app cannot upload the same folders again; never delete them or the old Keychain item. Watched-folder bookmarks made by Finder Vault fall back to the saved path and are renewed.
Released versions use `document-scanner/v*` tags. Finder Vault releases keep their `finder-vault/v*` tags.
This module is independent of Gradle and main application deployment.
