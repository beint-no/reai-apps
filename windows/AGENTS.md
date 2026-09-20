# Windows apps

Keep Windows apps independent under windows/<app>. Use the .NET 11 RC1 and the latest stable Windows App SDK with WinUI 3.
Windows 11 25H2+ only; x64 and ARM64. No Windows 10, .NET Framework, Windows Forms, WPF or cross-platform UI layer.
Shared packaging tooling belongs in tools/windows. GitHub Windows runners compile WinUI; macOS can build app-local .NET logic.
Pin verified dependency versions (the user explicitly selected .NET 11 RC1) and commit lockfiles. Read each app's AGENTS.md before editing.
