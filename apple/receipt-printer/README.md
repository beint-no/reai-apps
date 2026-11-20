# ReAI Receipt Printer for Mac

Use a Mac as the printer for ReAI POS sales. The app loads the receipt from ReAI, preserves its items, prices, VAT and QR, and can add your store message at the bottom.

1. Install a compatible thermal printer on the Mac in **System Settings → Printers & Scanners**. Configure the printer for an 80 mm roll.
2. Open **ReAI Receipt Printer → Connect to ReAI**. Sign in in the browser and choose the company whose receipts you want to print.
3. Complete the sale in ReAI POS. Keep Receipt Printer open to see new receipts. The app refreshes every ten seconds when the date range includes today. Browse earlier sales by date, exact receipt number or cash register ID.
4. Select the sale, enter an optional **Store message**, choose the printer and click **Print receipt…**. Confirm and check the paper or macOS printer queue. Use the Mac as the printer when giving the customer their receipt at checkout.

The app stores its company connection in Keychain. Receipt data and the store message stay in memory. **Change company…** lets you approve a different company. The app requires the fiscal receipt PDF endpoint in ReAI.

## Build and distribution

Apple Silicon and macOS 15 or newer are required. Build from the repository root with `tools/apple/build.py receipt-printer`.

Signed releases use the shared [Apple release tooling](../../tools/apple/README.md) and the `receipt-printer.xml` Sparkle feed. Before publishing, add the app-specific Sparkle public key to `Info.plist` and store its paired private key as `RECEIPT_PRINTER_SPARKLE_PRIVATE_KEY` in the `apple-release` environment. Development builds without that public key run without update checks. Distribute the signed and notarized DMG from the Apps catalog.
