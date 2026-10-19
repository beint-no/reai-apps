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

Disconnect removes the Keychain token. Revoke access in your [ReAI profile](https://app.reai.no/user/profile#user-access-tokens). Update by quitting and replacing the app in Applications. To remove, disconnect, quit, delete the app, and optionally remove its Application Support folder and preferences.

Use **History** to browse orders with saved shipments, or search all historical orders by order number, internal ID or a full ReAI order link. Select a saved shipment and click **Print label** to send another copy of its existing label after checking the printer queue. History does not book a new shipment. **Load more** reaches older shipments, including orders with multiple parcels. Labels are available across Macs connected to the same company, independently of this Mac’s recent print receipts.
