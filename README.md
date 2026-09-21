# ReAI Apps

Desktop apps that connect to the [ReAI API](https://app.reai.no/openapi/public/ui).

**[Download apps](https://beint-no.github.io/reai-apps/)** — Mac: Apple Silicon, macOS 15+. Windows: Windows 11 25H2+, x64 or ARM64.

| App | What it does |
| --- | --- |
| [Time Tracker for Windows](windows/time-tracker) | Native Windows timer, with or without a project. Unsigned ZIP download. |
| [Time Tracker for Mac](apple/time-tracker) | Start and stop your timesheet timer from the menu bar. |
| [Import for Mac](apple/import) | Import products, customers and suppliers from Excel or CSV. |
| [Import for Windows](windows/import) | Native Windows 11 import app. Unsigned ZIP download. |
| [Finder Vault](apple/finder-vault) | Upload documents and watch folders for new files. |

## Install

Download from the **[app page](https://beint-no.github.io/reai-apps/)**.

- **Mac:** open the disk image and drag the app to **Applications**. Mac releases are signed with Developer ID and notarized by Apple. To update, quit and replace the app in Applications.
- **Windows:** choose your processor (x64 or ARM64), **Extract All** from the ZIP, and open the app’s EXE. Keep the whole folder together. No .NET installation or administrator access is needed. To update, close the app and extract the new version into a new folder.

**Windows downloads are unsigned.** Windows may warn or block them. If SmartScreen offers **More info → Run anyway**, you can choose it after confirming the download came from this repository and you trust it. Smart App Control, S mode and workplace policy may prevent running the app. Keep Windows security protections enabled. See the app README for details and checksum verification.

Click **Connect to ReAI**, sign in in your browser, compare the code, choose a company and approve. Your password stays in the browser. Access keys stay in macOS Keychain or Windows Credential Locker, restricted to the approved company and your existing permissions. Revoke access in your [ReAI profile](https://app.reai.no/user/profile#user-access-tokens).

## Repository

```text
apple/
  time-tracker/     Swift package and app source
  finder-vault/     Swift package and app source
  import/           Swift package and app source
windows/
  import/           .NET 11 / WinUI 3 app and app-local import logic
  time-tracker/     .NET 11 / WinUI 3 app and app-local timer logic
  global.json       Pinned .NET 11 RC1 SDK
apps.json          App identities and download names
site/              GitHub Pages download site
tools/apple/       Apple build, signing and release tools
tools/windows/     Windows build and packaging tools
.github/           CI, release and Pages workflows
```

Each app is independently versioned. Platform folders contain app source; shared release tooling stays in `tools/`.
Apple apps use SwiftUI. Windows apps use WinUI 3 and support Windows 11 25H2+, x64 and ARM64. Each platform uses native controls.

## Add an app

Follow **[Adding a new app](CONTRIBUTING.md)** for the starting points, identity checklist, `apps.json` examples and build/release steps.
Add the app inside this monorepo and reuse the existing release tooling. No ReAI backend registration or new signing credentials are needed for ordinary apps.

## Build and release

Install [Swift 6.4](https://www.swift.org/install/macos/) and the macOS SDK, then run from the repository root:

```sh
python3 tools/apple/build.py time-tracker
python3 tools/apple/build.py finder-vault
python3 tools/apple/build.py import
```

Set `SWIFT_BIN` to the Swift 6.4 executable if needed. Local builds appear in `dist/<app>/` and are ad-hoc signed for development.
Pull requests build affected apps without signing credentials. Apple releases use the shared [Apple release workflow](tools/apple/README.md).

To release a Mac app, merge your changes, then open **[Actions → Release app](https://github.com/beint-no/reai-apps/actions/workflows/apps.yml) → Run workflow**, keep **main**, and choose the app.
Or run:

```sh
gh workflow run apps.yml --repo beint-no/reai-apps --ref main -f app=time-tracker
```

GitHub chooses the next patch version, builds, signs, notarizes, verifies, publishes the download, and updates the site.
Pushing code runs build checks; publishing requires the release action. Repository write access is required.
Apple credentials are already stored in GitHub. Teammates need no signing secrets or `.zshrc` changes.
A failed verification publishes nothing.

## Windows development

Windows Import and Time Tracker use .NET 11 RC1 (SDK 11.0.100-rc.1.26425.128), C# 15 and Windows App SDK 2.5.1. Write code on your Mac; GitHub Windows runners build the native UI and self-contained x64/ARM64 packages. The app-local logic also builds on macOS. Toolchains and dependencies are pinned; the app READMEs record the versions checked on 20 September 2026. Verify current releases when adding or updating dependencies.

See [Windows Import](windows/import) and [Windows Time Tracker](windows/time-tracker) for instructions. To publish a free unsigned release, merge changes, then open **[Actions → Windows apps](https://github.com/beint-no/reai-apps/actions/workflows/windows.yml) → Run workflow**, keep **main**, and choose the app. GitHub builds both architectures, verifies the archives, publishes ZIPs and checksums, and updates the download site. PRs and pushes only run checks. No Azure account, signing subscription or developer-held secret is needed. See [Windows release tooling](tools/windows/README.md).

## Connect another app

No registration or ReAI backend change is required:

1. POST form data to `/oauth/device/authorize` with a self-chosen `client_id` and optional `client_name`.
2. Display `user_code` and open `verification_uri_complete`. The user compares the code, chooses a company, and approves.
3. Poll `/oauth/device/token` with `client_id`, `device_code`, and `grant_type=urn:ietf:params:oauth:grant-type:device_code`.
   Respect the returned polling interval, backoff, and expiry.
4. Store `access_token` securely. Call `/api/me` for the approved company and send its ID in `X-Tenant-Id` on company requests.

Read the [public API contract](https://app.reai.no/openapi/public) before constructing requests.
App names are self-declared, not publisher verification. See [Time Tracker’s connection code](apple/time-tracker/Sources/ReAITimeTracker/Connection.swift).

[Suggest an app](https://github.com/beint-no/reai-apps/issues/new?template=app-idea.yml) · [Report an issue](https://github.com/beint-no/reai-apps/issues) · [MIT license](LICENSE)
