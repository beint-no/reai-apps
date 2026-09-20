# Windows Import

Native Windows-only app: .NET 10, C# 14, WinUI 3 / Windows App SDK 2.5.1. Use the current stable toolchain, not prereleases, .NET Framework, WPF, Windows Forms, UWP, MAUI or compatibility layers.
Minimum customer OS is Windows 11 25H2; x64 and ARM64 only. Use Microsoft.Windows.Storage.Pickers, AppWindow and native Fluent controls.

Core/ owns file parsing, matching, validation, HTTP and durable import progress. It is an app-local .NET library so logic can be verified on macOS; it is not a cross-platform product framework.
MainWindow owns the Windows UI. Credentials uses Windows Credential Locker. Read the live /openapi/public contract before changing payloads.

Never retry ambiguous creates. Persist Sending before POST, then persist its result. Recovered Sending rows need manual review.
Resume only in the original account/company. Fetch active and archived existing records before review and execution.
Never log keys or row data. Never put credentials in the progress journal. Keep bounded file parsing and DTD/external-entity rejection.

Build Core locally, then verify both Windows architectures in GitHub CI. Temporary tests may live outside the repository; do not commit tests.
Public downloads require trusted Windows Authenticode signing. Apple signing credentials are unrelated. Unsigned CI artifacts are developer-only, not public site downloads.
