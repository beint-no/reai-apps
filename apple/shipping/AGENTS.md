# ReAI Shipping

Native macOS label-printing companion for ReAI's web shipping workflow. Keep booking, payment capture, inventory and fulfillment on the server. This app only reads existing labels and submits PDFs to the macOS print queue; it never books a shipment.

Build from the root with `tools/apple/build.py shipping`. Swift 6.4, macOS 15+, arm64; no dependencies. Release through the shared signed and notarized pipeline.

Use browser device authorization with client `shipping`; Keychain service `no.reai.shipping`. One approved company. Accept only `reai-shipping://print?tenantId=<positive int>&shipmentId=<positive int>&printTicket=<signed proof>`; no remote document URLs, paths, credentials or printer commands in links. Automatic requests must include the browser handoff ticket for server validation. Explicit in-app reprints may omit it after user confirmation. Read `/api/shipments/{id}/label` using the approved company's token and X-Tenant-Id. 202 permits bounded GET polling. Never retry booking or accounting writes.

Use installed macOS printer queues; automatically choose exactly one Zebra. Carrier PDF dimensions determine custom media. Reject non-PDF, oversized, mixed-size and non-label documents. Print one copy without dialogs. Temporary PDFs are private and removed after spooling.

Persist a tenant/shipment receipt before invoking lp. Duplicate URLs cannot print twice, including across restarts. Interrupted/uncertain submissions require the user to check the OS queue and explicitly reprint. Do not silently discard the receipt journal or automatically retry uncertain prints. Report queue acceptance, never physical printing success. Keep English and Norwegian copy in Resources.
