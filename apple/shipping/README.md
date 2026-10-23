# ReAI Shipping

Ship orders and print labels from a native Mac app. Connect to ReAI, choose an order, review its parcel and shipping price, then click **Ship & print**. ReAI books the carrier, handles payment capture where required, and records shipping, stock and fulfillment. The Mac prints one copy of the resulting label.

## Install and connect

1. Download the signed, Apple-notarized DMG from [ReAI Apps](https://beint-no.github.io/reai-apps/#shipping), open it and drag **ReAI Shipping** into **Applications**. Apple Silicon, macOS 15 or later.
2. Add your Zebra under **System Settings → Printers & Scanners**, with a driver that prints PDFs through macOS. Raw-only queues are unsupported. The app chooses a single Zebra automatically; choose a queue if several are installed.
3. Open the app, **Connect to ReAI**, and approve one company in your browser. Your user needs invoice read/write permission and shipping enabled.
4. Select an order. Existing checkout parcels use their agreed snapshot. Other orders get recipient, item, weight and parcel defaults; check the actual package, choose a service/pickup and review the price. The last service choice is remembered.
5. Click **Ship & print**. Labels use the carrier PDF's dimensions, including common 100/102 × 150/192 mm formats; load matching stock. No print dialog or label-size setting is needed.

The app is a public API client. The web app remains independent and needs no browser setting, extension, native app links or handoff permissions. Agents and other clients can use the same shipping operations in [ReAI's public API](https://app.reai.no/openapi/public/ui). An iOS client could use those same operations to pick an order and book it; printing from a phone would need a reachable network printer or a small Mac relay, since iOS cannot directly submit to a locally installed Mac printer queue.

## Recovery and privacy

Shipping requests are saved before sending. If interrupted, use **Resume safely**: the app looks up the original request/shipment, continues confirmed preparation, and polls pending progress. It never creates a replacement merely because a response was lost. Unknown or failed outcomes require review. A definitively rejected create can be reviewed and priced again after the app checks that no shipment exists. Cancel preparation releases an unbooked manual parcel so it can be edited; checkout parcels follow ReAI’s order/payment workflow. There is a two-minute polling limit; resume later to check the same shipment.

**Sent to the printer queue** means macOS accepted the job. Check that queue if the printer is offline or out of stock. Print receipts prevent automatic duplicate copies across restarts. **Reprint** requires explicit confirmation and only downloads/prints the existing label; it never books shipping again. Existing labels can be reprinted from the app's recent history.

Tokens stay in Keychain (`no.reai.shipping`) and are bound to the approved company. Requests go only to `https://app.reai.no`, with redirects blocked. Private local journals live in `~/Library/Application Support/ReAI Shipping/`: `shipping-operations.json` stores request IDs, exact proposals until creation (including delivery details), and shipment progress; `print-history.json` stores shipment IDs and queue receipts. Keep these files to preserve recovery and duplicate protection. Temporary PDFs are removed after submission; macOS owns its spool.

Disconnect removes the Keychain token. Revoke access in your [ReAI profile](https://app.reai.no/user/profile#user-access-tokens). After installing this version, use **ReAI Shipping → Check for Updates…** (also in the menu bar icon) to download, install and relaunch future signed updates without manually replacing the app. Checks and installation are manual; there are no scheduled checks or automatic updates. To remove, disconnect, quit, delete the app, and optionally remove its Application Support folder and preferences.

**Ready to ship** defaults to orders dated within the last 14 days. Check **Include older orders** to include all dates, including when searching. The date filter applies on the server, including counts and pagination, and resets to the recent default when the app restarts.

Use **History** to browse orders with saved shipments, or search all historical orders by order number, internal ID or a full ReAI order link. Select a saved shipment and click **Print label** to send another copy of its existing label after checking the printer queue. History does not book a new shipment. **Load more** reaches older shipments, including orders with multiple parcels. Labels are available across Macs connected to the same company, independently of this Mac’s recent print receipts.

## Customs invoices and full-page labels

A saved customs/commercial invoice appears as **Customs invoice (optional)**, with its own **Print customs invoice** button and 1–5 copies. Select an installed A4/Letter queue under **Document printer** when you need paper copies. It is remembered independently of the label printer. Customs invoices never print automatically with **Ship & print**, and their print receipts and reprint confirmations are separate from the label's.

ReAI requests DHL Paperless Trade (`WY`) together with the structured export declaration and DHL-generated invoice. DHL labels marked **PLT** indicate Paperless Trade; paper invoices are normally unnecessary for those shipments. Follow DHL's instructions if paper or signed originals are requested. The availability of a downloadable invoice alone does not establish Paperless Trade acceptance or required copies. See [DHL's Digital Customs Invoice guide](https://mydhl.express.dhl/content/dam/downloads/pl/en/mydhl-guides/Digital_customs_invoice_pl_en.pdf.coredownload.pdf).

The app preserves full-page A4/Letter PDFs rather than reducing commercial invoices onto label stock. Full-page labels, including existing DHL A4 labels, also use the document printer; label-sized PDFs use the label printer. An A4 printer can handle both of the referenced DHL documents. Mixed page sizes and unsupported sizes still require manual printing in ReAI. Customs invoices cannot be sent to a detected Zebra queue.

The API exposes `customsInvoiceAvailable` and `download_customs_invoice` on shipment detail. `GET /api/shipments/{id}/customs-invoice` retrieves the stored PDF without contacting the carrier or booking shipping. Historical labels containing combined documents are kept intact; no separate invoice is invented when none was stored.
