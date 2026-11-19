# ReAI Receipt Printer

Independent macOS client for cash register receipt lookup and store messages. Use browser device authorization with client ID `receipt-printer`, Keychain service `no.reai.receiptprinter` and the approved company ID for receipt GET requests. Preserve historical receipt amounts and currency. A cash point distinguishes repeated receipt numbers. Search dates are Oslo business dates.

Use the same thermal-width PDF for preview and explicit system printing. The printed message is a separate enclosure. It contains a receipt reference and tells the reader to keep the original receipt. This app has no fiscal issuance, copy or sale-write workflow. Never retry a print automatically. Receipt data and message draft remain in memory.

Build from the repository root with `tools/apple/build.py receipt-printer`. Inspect the native UI. Use the shared signed and notarized release pipeline. Provision a dedicated Sparkle key before the first release and test the signed feed.
