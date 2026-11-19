# ReAI Receipt Printer for Mac

Look up a completed POS sale and print a custom store message on a thermal roll, such as seasonal returns information. The printout refers to the sale and accompanies the original POS receipt.

1. Install a compatible Star or other thermal printer on the Mac in **System Settings → Printers & Scanners**. Confirm the manufacturer supports your printer model and macOS version.
2. Open ReAI Receipt Printer and choose **Connect to ReAI**. Approve the correct company in the browser with a user who can read its cash register sales.
3. Choose the business date. Optionally enter an exact receipt number and register ID. Select the receipt to see its stored line items and prices.
4. Enter the store message, choose the width of the roll, and check the preview.
5. Choose **Print store message…**. Verify the queue, paper size and one-copy setting in the macOS dialog. Hand out the message with the original POS receipt.

Use the original POS workflow for fiscal receipts. If a print outcome is uncertain, check the macOS printer queue before printing again.

The app stores the connection in Keychain. Receipt data and the current message stay in memory. Select **Disconnect** to remove the local token, and use [your ReAI profile](https://app.reai.no/user/profile#user-access-tokens) to revoke it in ReAI.

## Build and distribution

Apple Silicon and macOS 15 or newer are required. Build from the repository root with `tools/apple/build.py receipt-printer`.

Signed releases use the shared [Apple release tooling](../../tools/apple/README.md) and the `receipt-printer.xml` Sparkle feed. Before publishing, add the app-specific Sparkle public key to `Info.plist` and store its paired private key as `RECEIPT_PRINTER_SPARKLE_PRIVATE_KEY` in the `apple-release` environment. Development builds without that public key run without update checks. Distribute the signed and notarized DMG from the Apps catalog.
