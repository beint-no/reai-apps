# Windows builds

`build.ps1` publishes ReAI Import as a self-contained Windows folder and ZIP for x64 or ARM64.
GitHub's **Windows apps** workflow runs the same build for both architectures without signing credentials.
Unsigned artifacts are for development only and expire after seven days.

A public release requires a trusted Windows Authenticode identity, such as Microsoft Artifact Signing.
Apple Developer ID and notarization do not apply to Windows. Never distribute a self-signed certificate or ask customers to disable SmartScreen.
When Windows signing is configured, sign the app executable and installer, verify Authenticode, then publish a versioned GitHub release and update Pages.
