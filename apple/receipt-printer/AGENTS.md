# ReAI Receipt Printer

Independent macOS client for viewing completed POS sales and printing their ReAI receipt PDFs. Use browser device authorization with client ID `receipt-printer`, Keychain service matching the bundle identifier (`no.reai.receiptprinter` in production) and the approved company ID. A cash point distinguishes repeated receipt numbers. Search dates are Oslo business dates. Refresh the current date range while the window is open without clearing the selected sale.

Use the fiscal receipt PDF API and preserve its line items, amounts, VAT and QR. Append the optional store message below the existing content. Submit one job when the cashier confirms printing. This is an alternate printer for checkout. ReAI remains responsible for the sale and its receipt.

Build from the repository root with `tools/apple/build.py receipt-printer`. Inspect the native UI. Use the shared signed and notarized release pipeline. Provision a dedicated Sparkle key before the first release and test the signed feed.
