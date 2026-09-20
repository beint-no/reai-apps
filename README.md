# ReAI Apps

Desktop apps that connect to the [ReAI API](https://app.reai.no/openapi/public/ui).

**[Download apps](https://beint-no.github.io/reai-apps/)** — Apple Silicon (M1 or newer), macOS 15+.

| App | What it does |
| --- | --- |
| [Time Tracker](apple/time-tracker) | Start and stop your timesheet timer from the menu bar. |
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
apps.json          App identities, versions and download names
site/              GitHub Pages download site
tools/apple/      Shared build, signing and release tools
.github/           CI, release and Pages workflows
```

Each app is independently versioned. Platform folders contain app source; shared release tooling stays in `tools/`.
Add `windows/<app>/` when the first Windows app exists. No empty platform projects or shared app framework are required.

## Build and release

Install [Swift 6.4](https://www.swift.org/install/macos/) and the macOS SDK, then run from the repository root:

```sh
python3tools/apple/build.py time-tracker
python3tools/apple/build.py finder-vault
```

Set `SWIFT_BIN` to the Swift 6.4 executable if needed. Local builds appear in `dist/<app>/` and are ad-hoc signed for development.
Pull requests build affected apps without signing credentials. Public releases use the shared [Apple release workflow](tools/apple/README.md).

To release, update that app’s version and build number in `apps.json`, merge the PR, then tag the merged commit:

```sh
git tag time-tracker/v0.3.0
git push origin time-tracker/v0.3.0
```

Use the version from `apps.json`. CI signs, notarizes, staples, verifies, and publishes the app’s disk image and checksums.
The download site updates automatically after publication. A failed verification publishes nothing.

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
