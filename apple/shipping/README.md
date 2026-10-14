# ReAI Shipping

Print shipping labels directly from ReAI to your Mac's Zebra printer. ReAI books the shipment and handles payment, inventory and fulfillment; this app fetches the existing label and sends it to macOS's print queue.

## Install and connect

1. Download the signed, Apple-notarized DMG from [ReAI Apps](https://beint-no.github.io/reai-apps/#shipping), open it and drag **ReAI Shipping** into **Applications**. Requires Apple Silicon and macOS 15 or later.
2. Add your Zebra under **System Settings → Printers & Scanners**, using a driver that can print PDFs from macOS.
3. Open ReAI Shipping, choose **Connect to ReAI**, and approve the company in your browser. Your ReAI user needs invoice read permission and shipping enabled.
4. The app chooses a single installed Zebra automatically. If several are installed, choose one. Click **Enable printing in ReAI**.
5. Prepare the order normally and click **Create label**. The app fetches and prints the label automatically. Allow your browser to open ReAI Shipping when first asked; browsers may require permission again according to their own policies.

The preference applies to the current browser and company. Turn it off on ReAI's Shipments page. Labels use the carrier PDF's actual size, including common 100/102 × 150/192 mm formats. Load matching label stock. No API key entry, print dialog, cloud printing service or label-size setting is needed. The printer must already be installed and able to print through macOS; raw-only Zebra queues are not supported.

## Recovery and privacy

The app waits up to two minutes when a label is still being prepared. A retry here only downloads/prints an existing label; it never creates another shipment or charges shipping again. Return labels print the same way.

**Sent to the printer queue** means macOS accepted the job. If the printer is offline or out of labels, check the macOS queue before using **Reprint**. macOS retains accepted jobs. Duplicate shipping links do not automatically print another copy, including after relaunch. Interrupted submissions require checking the queue and confirming another copy. A label sent before connecting/selecting a printer stays in memory until setup is complete; reopen its print link if the app is quit during setup.

Browser handoff links contain numeric company/shipment IDs and a ten-minute server-signed print ticket. The ticket prevents arbitrary websites from inventing automatic print requests; it does not grant API access. A server restart invalidates tickets; explicit Reprint remains available. Access tokens stay in Keychain (`no.reai.shipping`) and are bound to the approved company. Labels come only from `https://app.reai.no`, with redirects blocked. Temporary PDFs are deleted after submission; macOS owns its print spool. Local receipt IDs and queue status are stored in `~/Library/Application Support/ReAI Shipping/print-history.json`, without customer names or addresses. Keep this history to preserve duplicate protection.

Disconnect removes the Keychain token. Revoke access in your [ReAI profile](https://app.reai.no/user/profile#user-access-tokens). To remove the app, disconnect, quit, delete it from Applications, and optionally remove its Application Support folder and preferences. To update, quit and replace the app in Applications; history and connection survive.

Build: `tools/apple/build.py shipping`. Publish with the repository's Release app action on main, choosing `shipping`. Development bundles are not public downloads.
