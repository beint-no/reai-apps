# Windows apps

Keep Windows apps independent under windows/<app>. Use the .NET 11 RC1 and the latest stable Windows App SDK with WinUI 3.
Windows 11 25H2+ only; x64 and ARM64. No Windows 10, .NET Framework, Windows Forms, WPF or cross-platform UI layer.
Shared packaging tooling belongs in tools/windows. GitHub Windows runners compile WinUI; macOS can build app-local .NET logic.
Pin verified dependency versions (the user explicitly selected .NET 11 RC1) and commit lockfiles. Read each app's AGENTS.md before editing.

Reference the individual WinUI and runtime packages; these apps do not use AI, ML, widgets or app-content search. Keep WebView2 (required by WinUI) and MSIX build tooling pinned to current releases. Windows UI automation in CI must load assemblies matching the PowerShell host runtime, independently of the app runtime.

The owner chose free unsigned portable ZIP releases on GitHub, with no paid signing or Store review. Release through the Windows apps action on main; publish both architectures, SHA256SUMS and explicit unsigned-installation guidance. Do not tell customers to disable security, install a root certificate or run as administrator to bypass a block.
