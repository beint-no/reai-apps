# ReAI Shipping

Independent native macOS shipping client of the public ReAI API. The web app has no print preferences, app links, tickets or protocol handoff. Keep booking, payment capture, inventory and fulfillment decisions on the server.

Build from the root with `python3 tools/apple/build.py shipping`. Swift 6.4, macOS 15+, arm64. Sparkle 2 is the only runtime dependency, for signed manual in-app updates. Release through the shared signed and notarized pipeline. Never distribute local ad-hoc builds.

Use browser device authorization with client `shipping`; Keychain service `no.reai.shipping`. One approved company, X-Tenant-Id, Accept-Language. Read `/openapi/public` before changing requests. Discover `/api/orders/shipping-ready`, `/api/orders/{id}/shipping-options`, shipping-rates and shipping-quote. Explicitly accept the displayed customer price. POST /api/shipments prepares a snapshot; POST /api/shipments/{id}/book purchases it. Checkout shipments already exist and must be booked by ID.

Persist request UUID and exact accepted proposal in the private shipping-operations.json journal BEFORE any write. After an uncertain create, look up by request ID; retry only that same proposal/UUID. Save shipment ID before booking. Pending progress uses bounded GET polling. Unknown outcomes never trigger a replacement or automatic booking retry. Resuming is explicit. Preserve unresolved operations across restarts and company changes. Never silently reset unreadable journals.

History browses cursor-paged shipments and searches all order dates by number, ID or tenant-checked ReAI link. Load saved shipments directly without preparing a new parcel; reprinting must only retrieve the existing label, never invoke booking. Keep the local print receipt and explicit reprint confirmation.

Use installed macOS printer queues; automatically choose exactly one Zebra. Carrier PDF dimensions determine custom media. Reject non-PDF, oversized, mixed-size and non-label documents. Print one copy without dialogs. Temporary PDFs are private and removed after spooling.

Persist a tenant/shipment receipt before invoking lp. Interrupted/uncertain submissions require checking the OS queue and explicitly reprinting. Never automatically retry uncertain prints. Report queue acceptance, never physical printing success. Keep English and Norwegian copy in Resources. Native UI and the download site require local screenshot inspection after UI changes.

Ready to ship sends an inclusive `from` date 14 calendar days ago by default. Include older orders removes that restriction; History always covers all dates. Keep the date cutoff stable while paging.

Sparkle is pinned in Package.swift/Package.resolved. Check for Updates is manual only and disabled while shipping/printing or authorizing; shipping controls are disabled for the update session. The signed appcast is published as shipping.xml on each shipping release, then copied byte-for-byte to Pages updates/shipping.xml. The release environment owns SHIPPING_SPARKLE_PRIVATE_KEY; never put it in Git.
