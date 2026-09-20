# Windows builds

`build.ps1` publishes Import or Time Tracker as a self-contained Windows folder and ZIP for x64 or ARM64.
GitHub's **Windows apps** workflow runs the same build for both apps and architectures without signing credentials.
Unsigned artifacts are for development only and expire after seven days.

A public release requires a trusted Windows Authenticode identity, such as Microsoft Artifact Signing.
Apple Developer ID and notarization do not apply to Windows. Never distribute a self-signed certificate or ask customers to disable SmartScreen.
When Windows signing is configured, sign the app executable and installer, verify Authenticode, then publish a versioned GitHub release and update Pages.

Run from the repository root on Windows:

```powershell
./tools/windows/build.ps1 -App time-tracker-windows -Architecture x64
./tools/windows/build.ps1 -App import-windows -Architecture ARM64
```

`windows/global.json` pins .NET 11 RC1. Run local .NET commands from `windows/` so SDK selection applies.
