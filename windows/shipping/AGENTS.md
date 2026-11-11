# Windows Shipping

Native .NET / WinUI 3 port of the Mac Shipping app, Windows 11 25H2+, x64 and ARM64. Follow windows/AGENTS.md and keep behavior aligned with apple/shipping/AGENTS.md; ReAI owns booking, payment capture, inventory and fulfillment.

Core owns the public API client, the shipping/recovery model and the journal; it builds on macOS. The app project owns the WinUI window, Credential Locker and printing. Read /openapi/public before changing requests. Device authorization uses client `shipping-windows`.

Journal the request UUID and the exact accepted proposal in `shipping.json` BEFORE any write. After an uncertain create, look up by request ID and retry only that same proposal. Save the shipment ID before booking. Unknown outcomes never trigger a replacement or an automatic booking retry; resuming is explicit. Never replace an unreadable journal: shipping and printing pause instead.

Persist a print receipt before spooling. Report queue acceptance, never physical printing. Never retry an uncertain print automatically; a repeat print needs explicit confirmation and only fetches the existing label. History and reprinting never book shipping.

Printing is silent: one copy to one installed queue, no dialog. Carrier PDFs are rasterized with Windows.Data.Pdf at the printer's resolution and keep their own page size; A4 / Letter labels are rejected on a detected Zebra. Location labels are drawn at actual size (60 × 40, 80 × 50, 100 × 50 mm) with a QR quiet zone; preview and print share one drawing routine. System.Drawing.Common is used only for printing and label drawing, QRCoder only for the QR matrix.

The app updates itself in place (`Core/Updater.cs`): it reads `updates/shipping-windows.json` from Pages (written by site/build.py for apps with `"updates": true`), downloads the release ZIP for its architecture from this repository's GitHub releases only, verifies the feed's SHA-256, stages it under `%LOCALAPPDATA%\ReAI\Shipping\update`, and the staged copy replaces the app folder after the app exits. It only adds and replaces the app's files, never deletes others, and never updates while shipping or printing. Automatic checks run daily on weekdays while idle and install on close; unversioned local builds never update. There is no tray icon; releases stay unsigned portable ZIPs. Build both architectures in CI; temporary tests live outside the repository.
