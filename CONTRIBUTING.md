# Adding a new app

Add apps inside this monorepo. Reuse a small existing app as a starting point and the shared build/release tooling; a separate repository, backend registration or new release system is unnecessary.

## 1. Pick one platform and starting point

| Platform | Starting point | Keep |
| --- | --- | --- |
| Mac | [Time Tracker](apple/time-tracker) | Swift package structure, SwiftUI app entry point, browser connection, Keychain and `Info.plist` |
| Windows | [Time Tracker](windows/time-tracker) | WinUI project settings, app entry point, browser connection and Credential Locker |
| Spreadsheet import | [Mac Import](apple/import) or [Windows Import](windows/import) | Bounded parsing, editable mapping, preview and durable import progress where relevant |

Create `apple/<app>` or `windows/<app>`. Copy only source/configuration files, not `.build`, `bin`, `obj`, downloads, credentials or local app data. Remove the original app's business logic and domain-specific error messages. Keep each app independent; share runtime code only when actual duplication warrants it.

Read the root and platform/app `AGENTS.md` files. Keep the pinned toolchain unless intentionally upgrading it; verify current official versions when adding dependencies. Windows UI builds run on Windows; app-local .NET logic can be developed on macOS.

## 2. Give it its own identity

Do this before launching a copied app, so it cannot read or replace another app's connection or data.

| Identity | Mac | Windows |
| --- | --- | --- |
| Code/project | Rename package, target, source folder and executable | Rename `.csproj`, namespaces, XAML classes, assembly and project references |
| App metadata | Update bundle ID, executable and display names in `Info.plist` | Update product name, icon and any identity in `app.manifest` |
| Credentials | Unique Keychain service in `Credentials.swift` | Unique Credential Locker resource in `Credentials.cs` |
| Local state | Unique Application Support folder and UserDefaults keys | Unique LocalApplicationData folder and single-instance mutex |
| ReAI connection | Unique `client_id` and readable `client_name` | Unique `client_id` and readable `client_name` |

Use stable IDs, for example `my-app` / `no.reai.myapp` on Mac and `my-app-windows` / `ReAI.MyApp` on Windows. Search the copied source for the original names, IDs and paths, including account/history stores, then replace the remaining app-specific references.

Keep tokens in the OS credential store. Reuse the existing browser device-authorization flow; it already validates the approval URL, handles polling and lets the user choose one company. The connection code lives in [Mac Connection.swift](apple/time-tracker/Sources/ReAITimeTracker/Connection.swift) and [Windows ReAIClient.cs](windows/time-tracker/Core/ReAIClient.cs).

Read the live [public API contract](https://app.reai.no/openapi/public) before implementing requests. Send the approved company in `X-Tenant-Id`. Keep the existing permission boundaries and choose retry behavior from each endpoint's actual contract; do not copy the timer's retry semantics into unrelated writes.

## 3. Register it in the app catalog

Add an entry to [apps.json](apps.json). Example Mac entry:

```json
"my-app": {
  "name": "ReAI My App",
  "path": "apple/my-app",
  "executable": "ReAIMyApp",
  "bundle_id": "no.reai.myapp",
  "icon": "scripts/make-icon.swift",
  "asset": "ReAI-My-App-Apple-Silicon.dmg"
}
```

Example Windows entry:

```json
"my-app-windows": {
  "name": "ReAI My App for Windows",
  "platform": "windows",
  "path": "windows/my-app",
  "executable": "ReAI.MyApp.exe",
  "asset": "ReAI-My-App-Windows-x64.zip",
  "arm64_asset": "ReAI-My-App-Windows-ARM64.zip"
}
```

The paths must exist. Mac bundle/executable identities must agree with `Info.plist` and `Package.swift`; the icon script path is relative to the app folder. On Windows, the project filename must match the executable basename (`ReAI.MyApp.csproj`). Preserve the self-contained WinUI settings and `resources.pri` output; update and commit the NuGet lockfile after renaming project references.

Build matrices discover apps from `apps.json`. Add the ID to the matching workflow's manual `inputs.app.options` list: [Apple](.github/workflows/apps.yml) or [Windows](.github/workflows/windows.yml). Those lists power GitHub's app picker; no changes to the build scripts are needed.

## 4. Make it discoverable and maintainable

- Write the app's `README.md`: purpose, permissions, install/update/remove instructions, local storage and recovery behavior. Keep the platform's current signing/unsigned-download guidance.
- Write its `AGENTS.md`: responsibilities, build command, API boundaries and any important recovery constraints.
- Add it to the root README's app table.
- Add a card, or a platform download on an existing card, in [site/index.html](site/index.html). Use `{{my-app.download}}` and `{{my-app.version}}` (or the Windows ID). Add the source/instructions link and icon in `site/assets/`. The site generates download URLs from published releases; never hardcode a release version.
- Keep dependency licenses and attribution with the app. Keep credentials and customer data outside Git.

## 5. Build, review and release

For Mac, from the repository root:

```sh
python3 tools/apple/build.py my-app
```

Set `SWIFT_BIN` when Swift 6.4 is not the default. For Windows, on Windows:

```powershell
./tools/windows/build.ps1 -App my-app-windows -Architecture x64
./tools/windows/build.ps1 -App my-app-windows -Architecture ARM64
```

Check the native UI, connection/company choice, revocation, and the app's main flow with suitable test data. Test recovery where the app writes data. Windows CI expects a native window with a **Connect to ReAI** control; retain that entry point. CI launches x64 only, so report ARM64 execution separately.

Run `python3 site/build.py --offline` and preview `dist/site` when changing the site. Offline mode intentionally shows unpublished placeholders. Run without `--offline` to use actual releases.

Commit and push from a worktree/feature branch, review the PR and merge after the affected builds pass. Then run the platform's release action on `main`, choosing the app. Versions come from independent app tags; the first release is 0.1.0. Pushing ordinary code does not publish an app.

Mac releases reuse the repository's Apple signing/notarization environment. Windows releases are free unsigned ZIPs. No new per-app credential setup is needed for ordinary apps; review Apple signing requirements if adding restricted capabilities or embedded code.

[Apple release details](tools/apple/README.md) · [Windows release details](tools/windows/README.md)
