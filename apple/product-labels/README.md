# ReAI Product Labels

Native Mac app for price tags, product labels and Code 128 barcode labels. Create labels manually without an account, or connect to ReAI to choose product variants. Designed for printing many labels in one batch.

## Install on the Mac mini

1. [Download ReAI Product Labels](https://beint-no.github.io/reai-apps/#product-labels), open the signed and Apple-notarized DMG, and drag the app into Applications. Requires an Apple Silicon Mac (M1 or newer), macOS 15+.
2. Install the label printer in System Settings → Printers & Scanners using a PDF-capable driver. Load the stock you will use.
3. Open the app. For your product catalog, click **Connect to ReAI**, approve the code in your browser and choose the company. Your ReAI user needs permission to read products. Manual labels work without connecting.
4. Choose **Price label**, **Product label** or **Barcode label**. Price labels default to **50 × 30 mm**; product/barcode layouts default to **60 × 40 mm**. Other stock presets and custom sizes (25–110 mm wide, 20–150 mm high) are available.
5. Choose your installed printer and **Print one test label**. Check the size, readability and barcode with your actual scanner.

## Bulk printing

Under **ReAI products**, search by title, SKU, barcode or variant details. Use Command-click or Shift-click to select variants, then **Add selected**. **Add all results** adds every matching variant at once. Each row has its own copy count; adjust quantities, prices and details directly in the batch. For manual labels, enter the fields and copy count and click **Add to batch**. The eye button previews each row. Choose **Print batch** to send all rows and copies as one printer job, with up to 1,000 labels. The batch remains available for reuse across restarts; reprinting always requires confirmation. **Export PDF** saves the same layout and quantities for review or manual printing.

Price labels show the product title and final customer price. ReAI stores net product prices. Catalog labels default to the company's currency and include each product's domestic VAT rate (or ReAI's standard domestic rate when no product override exists). Under **Label currencies**, choose up to four actual catalog currencies, selecting one price list per currency. Multiple prices appear on the same label. Changing this selection updates catalog prices already in the batch. No exchange-rate conversion or fallback price is used; a missing variant price blocks the change before any labels are added or changed. For other markets, choose **Custom VAT rate**, or **Stored net price** to add no VAT. After changing tax settings, use **Update catalog prices in batch** to replace existing catalog prices; manual labels stay as entered. Review final customer prices before printing. Manual prices are final amounts with no automatic tax calculation. Price labels show whole amounts without thousands separators in every currency. The label renderer rounds to the nearest whole unit, with half units rounded up (for example, EUR 129.90 → 130 EUR and NOK 1490.50 → 1491 kr). Saved/catalog amounts retain their precision; rounding only affects the printed/exported label. Enter prices without thousands separators using the selected price-input format. Product labels include title, SKU, variant details/material, country of origin and optional barcode. Barcode labels include title, SKU and barcode. All barcodes use **Code 128**, including values that originally came from an EAN field; this is not an EAN-13 symbol generator. Codes must be printable ASCII. The app rejects labels whose text or barcode cannot fit legibly. For several currencies or long details, choose a larger label format. Product/barcode batches can be added without prices; after switching such a batch to price labels, use **Update catalog prices in batch** to fill its selected currencies. Changing the number format reformats existing amounts without changing their value.

PDFs have one label per page with the selected physical dimensions. Printing requests actual size, custom media and no scaling. Driver support varies; always check one test label first. A4 sticker sheets and raw-only printer queues are not supported.

## Updates, privacy and recovery

Use **ReAI Product Labels → Check for Updates…**, also available from the menu bar icon, to install and relaunch future signed updates. Checks and installation are manual; there are no scheduled checks or automatic updates.

The app only reads ReAI products; it does not change stock, prices or fulfillment. Products synced into ReAI from Shopify can be selected from ReAI; there is no separate direct Shopify login. Access tokens stay in macOS Keychain under `no.reai.productlabels`, restricted to the approved company. Revoke access in your [ReAI profile](https://app.reai.no/user/profile#user-access-tokens).

Draft, batch, printer, design, price-list selection, VAT choice and last print status are stored privately in `~/Library/Application Support/ReAI Product Labels/state.json`. Catalog results are held in memory. Disconnect removes the token and clears the draft and batch. Unreadable saved data is preserved and printing is blocked until repaired. Exported PDFs are saved where you choose.

The app records an attempted submission before invoking macOS. **Sent to the printer queue** means the queue accepted the job, not that labels physically printed. If interrupted or an error occurs, inspect the macOS queue before sending another job. The app never automatically retries printing. Temporary PDFs are removed after spooling; macOS owns its spool.

To remove the app, disconnect, quit and delete it from Applications. Optionally remove its Application Support folder and preferences.
