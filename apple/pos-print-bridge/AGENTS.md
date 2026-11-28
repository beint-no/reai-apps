# ReAI POS Print Bridge

Native macOS menu bar app that prints ReAI POS fiscal receipts on ESC/POS thermal printers and kicks the cash drawer. Keep behavior aligned with windows/pos-print-bridge; both encoders must produce identical bytes for the same receipt.

Build from the root with `tools/apple/build.py pos-print-bridge`. Swift 6.4, SwiftUI, Observation, macOS 15+, arm64, no third-party dependencies. MenuBarExtra plus one settings Window; LSUIElement; single instance (a second launch asks the first to show settings); SMAppService login item.

Device authorization client `pos-print-bridge`; Keychain service `no.reai.posprintbridge`; state in `~/Library/Application Support/ReAI POS Print Bridge/bridge.json`. Read `/openapi/public` before changing requests. The bridge is read-only: `/api/me`, `/api/company-settings`, `/api/vat-codes`, `/api/kassasystem/sales` and `/api/kassasystem/sales/{id}`.

Fiscal rules (kassasystemforskriften, bokføringsforskriften § 5-1-2 and § 5-3-12, ReAI kassasystem/AGENTS.md):
- Render only from the receipt snapshot. Never recompute prices, VAT or totals; group line VAT per code as ReAI's PDF does. Follow the content and order of ReAI's KassasystemReceiptPdfSvc. Statutory headings and «KOPI» are Norwegian; other labels mirror ReAI's English receipt labels.
- Missing company name, organization number, unknown receipt type or a VAT code without a rate in `/api/vat-codes` blocks the receipt with a visible reason. Never guess data the API does not provide.
- Copies: «KOPI» in double-size text (at least 50 % larger than amounts), at most one per receipt, never opening the drawer.
- Print each original once. Persist `printing` before sending; on launch a stale `printing` becomes `uncertain`. Only `notSent` (nothing reached the printer) retries automatically; uncertain prints need explicit confirmation.
- On selecting a cash point, the baseline is the server's clock (HTTP Date); earlier receipts are history and never printed. Poll every 3 s with a 10-minute overlap and deduplicate by journal ID; back off to 60 s on errors; at most 10 pages per pass. Pending receipts older than 24 hours are skipped, not printed.

ESC/POS: `ESC @`, code page PC865 (`ESC t 5`), `ESC R 0`, `GS !` sizes, `GS ( k` QR model 2 level M, `GS V B` partial cut, `ESC p 0 25 250` drawer. Network printers use TCP 9100 (Network framework); installed queues use `lp -o raw`.

Verify the encoder with a one-off script outside Git that renders a sample receipt and dumps the bytes. Report queue or socket acceptance, never physical printing. Inspect the settings window after UI changes.
