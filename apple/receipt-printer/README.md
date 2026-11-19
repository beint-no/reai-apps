# ReAI Receipt Printer for Mac

Look up an existing POS sale and print the ReAI receipt copy on an 80 mm thermal roll. The copy preserves the original sale details and QR. An optional store message, such as seasonal returns information, goes below the QR.

1. Install a compatible Star or other thermal printer on the Mac in **System Settings → Printers & Scanners**. Confirm the manufacturer supports your printer model and macOS version.
2. Open ReAI Receipt Printer and choose **Connect to ReAI**. Approve the correct company in the browser with a user who can read and operate its cash register.
3. Choose a date range. The initial search covers the last seven business dates, including today. Changing either date reloads the results automatically. Use **Load older** to see earlier rows in the selected period. Optionally enter an exact receipt number and register ID. Select the receipt to see its stored line items and prices.
4. Enter an optional store message and select the installed printer with an 80 mm roll.
5. Choose **Print receipt copy…** and confirm. ReAI records the copy before the app sends the PDF to the selected queue.

The copy is marked **KOPI**. Its QR opens the original sale in ReAI, where staff can verify returns. The original sale receipt is issued at checkout. ReAI permits one issuance of the copy per sale. If the outcome is uncertain, check the printer queue and the ReAI journal. The app never retries issuance automatically. This feature requires a ReAI server with the receipt-copy endpoint.

The app stores the connection in Keychain. Receipt data and the current message stay in memory. Select **Change company…** to replace the local connection, and use [your ReAI profile](https://app.reai.no/user/profile#user-access-tokens) to revoke it in ReAI.

## Build and distribution

Apple Silicon and macOS 15 or newer are required. Build from the repository root with `tools/apple/build.py receipt-printer`.

Signed releases use the shared [Apple release tooling](../../tools/apple/README.md) and the `receipt-printer.xml` Sparkle feed. Before publishing, add the app-specific Sparkle public key to `Info.plist` and store its paired private key as `RECEIPT_PRINTER_SPARKLE_PRIVATE_KEY` in the `apple-release` environment. Development builds without that public key run without update checks. Distribute the signed and notarized DMG from the Apps catalog.
