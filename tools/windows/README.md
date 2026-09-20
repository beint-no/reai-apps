# Windows builds and releases

Windows apps ship as free, unsigned portable ZIPs on GitHub. There is no signing subscription or Store review.
Customers may get an unknown-publisher warning. Smart App Control, S mode and workplace policies can block unsigned apps; the download and app README explain this before installation.

## Release

Merge the change, then open **[Actions → Windows apps](https://github.com/beint-no/reai-apps/actions/workflows/windows.yml) → Run workflow**, keep **main**, and choose the app.

```sh
gh workflow run windows.yml --repo beint-no/reai-apps --ref main -f app=import-windows
gh workflow run windows.yml --repo beint-no/reai-apps --ref main -f app=time-tracker-windows
```

The action chooses the next independent patch version (starting at 0.1.0), builds x64 and ARM64, checks the executable version and native x64 startup, validates both final ZIPs and their architectures, generates SHA256SUMS, publishes a GitHub release and updates Pages. ARM64 is compiled and its archive verified; it is not launched in CI.

Release tags use `<app>/v<version>` and point to the main commit that was built. Only manual runs on main publish. PRs and pushes run build checks and keep temporary artifacts for seven days. No signing keys or Azure account are needed; releases use the workflow’s GitHub token. The two architectures must both pass before publishing. A published release is never overwritten by a rerun; run a new release for a new version.

`apps.json` owns app identity and asset names. `matrix.py` chooses the app/version and rejects releases from other branches. `release.py` checks the final ZIP contents and produces checksums and installation notes. `site/build.py` offers Windows downloads only when both architecture assets and SHA256SUMS exist in a published release.

## Build

Run from the repository root on Windows:

```powershell
./tools/windows/build.ps1 -App time-tracker-windows -Architecture x64
./tools/windows/build.ps1 -App import-windows -Architecture ARM64
```

`build.ps1` publishes a self-contained folder and ZIP; `-Version 0.1.0` sets the app version. Local/check builds default to 0.0.0. `windows/global.json` pins .NET 11 RC1. Run local .NET commands from `windows/` so SDK selection applies.

## Windows warnings

These are unpackaged apps, not MSIX installers. If Windows offers a per-app SmartScreen confirmation, users can decide whether to run the release after checking its source. Do not advise disabling Defender, SmartScreen or Smart App Control, installing a root certificate, or running as administrator to bypass policy. A checksum is an integrity check, not Authenticode signing.

Microsoft Store signing applies to packages submitted for Store distribution and certification; it is not a general signing certificate for arbitrary GitHub releases. Paid signing and Store submission are not required by this repository’s release process.

[Microsoft Store signing scope](https://learn.microsoft.com/en-us/windows/apps/publish/get-started) · [Smart App Control limitations](https://support.microsoft.com/en-us/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions)
