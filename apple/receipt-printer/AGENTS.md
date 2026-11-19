# ReAI Receipt Printer

Independent macOS client for cash register receipt lookup and journaled copies. Use browser device authorization with client ID `receipt-printer`, Keychain service `no.reai.receiptprinter` and the approved company ID for receipt GET requests. Preserve historical receipt amounts and currency. A cash point distinguishes repeated receipt numbers. Search dates are Oslo business dates.

Use the ReAI receipt-copy API after explicit confirmation. Submit the returned 80 mm PDF to the chosen installed queue, one copy with no scaling. Keep fiscal formatting, issuance and the original QR on the server. Never retry an uncertain API or printer outcome automatically. Receipt data and message draft remain in memory.

Build from the repository root with `tools/apple/build.py receipt-printer`. Inspect the native UI. Use the shared signed and notarized release pipeline. Provision a dedicated Sparkle key before the first release and test the signed feed.
