# ReAI Apps

Desktop apps that connect to the [ReAI API](https://app.reai.no/openapi/public/ui).

**[Download apps](https://beint-no.github.io/reai-apps/)** — Apple Silicon (M1 or newer), macOS 15+.

| App | What it does |
| --- | --- |
| [Time Tracker](apple/time-tracker) | Start and stop your timesheet timer from the menu bar. |
| [Import for Mac](apple/import) | Import products, customers and suppliers from Excel or CSV. |
| [Import for Windows](windows/import) | Native Windows 11 import app. Public download pending Windows code signing. |
| [Finder Vault](apple/finder-vault) | Upload documents and watch folders for new files. |

## Install

1. Download the app’s disk image from the [download page](https://beint-no.github.io/reai-apps/).
2. Open the disk image and drag the app to **Applications**.
3. Open the app and click **Connect to ReAI**. Sign in in your browser, compare the code, choose a company, and approve.

Published downloads are signed with Developer ID and notarized by Apple. No build tools or security-setting changes are needed.
macOS may ask you to confirm opening an app downloaded from the internet. To update, quit the app and replace it in Applications.

Your password stays in the browser. Access keys are stored in macOS Keychain and restricted to the company chosen during approval,
with your existing API permissions. Revoke access in your [ReAI profile](https://app.reai.no/user/profile#user-access-tokens).

## Repository

```text
apple/
  time-tracker/     Swift package and app source
  finder-vault/     Swift package and app source
  import/           Swift package and app source
windows/
  import/           .NET 10 / WinUI 3 app and app-local import logic
  global.json       Current stable .NET SDK
apps.json          App identities and download names
site/              GitHub Pages download site
tools/apple/       Apple build, signing and release tools
tools/windows/     Windows build and packaging tools
.github/           CI, release and Pages workflows
```

Each app is independently versioned. Platform folders contain app source; shared release tooling stays in `tools/`.
Apple apps use SwiftUI. Windows apps use WinUI 3 and support Windows 11 25H2+, x64 and ARM64. Each platform uses native controls.

## Build and release

Install [Swift 6.4](https://www.swift.org/install/macos/) and the macOS SDK, then run from the repository root:

```sh
python3 tools/apple/build.py time-tracker
python3 tools/apple/build.py finder-vault
python3 tools/apple/build.py import
```

Set `SWIFT_BIN` to the Swift 6.4 executable if needed. Local builds appear in `dist/<app>/` and are ad-hoc signed for development.
Pull requests build affected apps without signing credentials. Public releases use the shared [Apple release workflow](tools/apple/README.md).

To release, merge your changes, then open **[Actions → Release app](https://github.com/beint-no/reai-apps/actions/workflows/apps.yml) → Run workflow**, keep **main**, and choose the app.
Or run:

```sh
gh workflow run apps.yml --repo beint-no/reai-apps --ref main -f app=time-tracker
```

GitHub chooses the next patch version, builds, signs, notarizes, verifies, publishes the download, and updates the site.
Pushing code runs build checks; publishing requires the release action. Repository write access is required.
Apple credentials are already stored in GitHub. Teammates need no signing secrets or `.zshrc` changes.
A failed verification publishes nothing.

## Windows development

The Windows Import app uses .NET 10.0.401, C# 14 and Windows App SDK 2.5.1. Write code on your Mac; GitHub Windows runners build the native UI and self-contained x64/ARM64 packages. The app-local import logic also builds on macOS.

See [Windows Import](windows/import) for development and import instructions. The **Windows apps** action builds on pull requests and pushes; it does not publish unsigned downloads. Trusted Windows signing is a separate setup from Apple notarization.

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
