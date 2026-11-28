# Windows POS Print Bridge

Native .NET / WinUI 3 port of apple/pos-print-bridge, Windows 11 25H2+, x64 and ARM64. Follow windows/AGENTS.md and the fiscal rules in apple/pos-print-bridge/AGENTS.md; the C# and Swift encoders must produce identical bytes for the same receipt.

Core owns the API client, receipt renderer, ESC/POS encoder (PC865), ledger, polling model and the TCP 9100 sender; it builds and can be exercised on macOS. The app project owns the WinUI window, tray icon (Shell_NotifyIcon with a window subclass), WinSpool RAW printing, Credential Locker and the per-user Run key. Device authorization uses client `pos-print-bridge-windows`; Credential Locker resource `ReAI POS Print Bridge`; state in `%LOCALAPPDATA%\ReAI\POS Print Bridge\bridge.json`; single-instance mutex `Local\ReAI.POSPrintBridge`.

Without arguments the window opens (CI expects a native window with **Connect to ReAI**). `--background` from the Run key starts in the tray when a connection is stored. Closing the window hides it; Quit is in the tray menu.

WinSpool: OpenPrinter or StartDocPrinter failure is not-sent; a failed write that AbortPrinter removes is not-sent; anything else after StartDocPrinter is uncertain. Uncertain and printed receipts are never sent again, and there is no copy or reprint feature; copies are made in ReAI. No updater; releases are unsigned portable ZIPs. Temporary tests live outside the repository.
