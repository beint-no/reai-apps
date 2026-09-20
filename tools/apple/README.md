# Apple releases

One Developer ID Application certificate and one App Store Connect API key serve every app in this repository.
Adding an app does not require another Apple credential or a ReAI backend registration.

## Release

1. Add or update the app in `apps.json`. Increase its semantic version and numeric build number.
2. Merge the PR after affected apps build and the code is reviewed.
3. Push `<app>/v<version>` at the merged commit, for example `finder-vault/v0.2.0`.
4. Check the **Apple apps** workflow. It publishes the DMG and `SHA256SUMS` only after Apple accepts notarization and Gatekeeper verification passes.

The download site rebuilds after publication. Each app has its own tags and releases; GitHub's single “latest release” is not used.

The build job creates a development archive with Swift 6.4 on an Apple Silicon runner. The release job imports credentials into a temporary keychain,
signs with hardened runtime and a secure timestamp, creates a disk image with an Applications shortcut, signs and submits the disk image to Apple,
staples the ticket, and verifies the result. The temporary keychain is added to the search list so macOS can resolve the certificate chain. The original search list is restored and the temporary keychain and credential files are removed even on failure.

No app-store listing, per-app certificate, provisioning profile, or installer certificate is required for these apps.
Apps that add restricted Apple capabilities or embedded code need their signing requirements reviewed first.

## Credentials

Use the GitHub environment **apple-release**, restricted to release tags. Store:

| Name | Type | Value |
| --- | --- | --- |
| `APPLE_SIGNING_CERTIFICATE` | Secret | Base64-encoded Developer ID Application `.p12`, including its private key and Developer ID intermediate certificate |
| `APPLE_SIGNING_PASSWORD` | Secret | Password protecting the `.p12` |
| `APPLE_NOTARY_KEY` | Secret | Base64-encoded App Store Connect team API `.p8` key |
| `APPLE_NOTARY_KEY_ID` | Secret | API key ID |
| `APPLE_NOTARY_ISSUER` | Secret | Team API issuer UUID |
| `APPLE_TEAM_ID` | Variable | Apple developer team ID |

The App Store Connect key uses the Developer role. Apple team keys apply across the team's apps, so access to these secrets must stay limited to release jobs.
Use `gh secret set --repo beint-no/reai-apps --env apple-release NAME` with stdin; never paste secrets into issues, PRs, logs, or workflow files.
Keep a secure backup of the certificate, private key, and one-time API key download outside the repository.

When the certificate approaches expiry, issue a replacement and update the certificate/password secrets. Existing correctly timestamped downloads continue to work.
Rotate or revoke the API key if compromised. Renew Apple Developer membership and review new Apple agreements when requested.
There is no per-app credential setup or scheduled manual notarization step.

## Failures

Failed notarization never publishes a release. Download the workflow's notarization diagnostics to find Apple's submission ID and rejection details.
Apple may take longer on initial submissions. If the wait times out, inspect that submission before resubmitting:

```sh
xcrun notarytool info SUBMISSION_ID --key /secure/path/AuthKey.p8 --key-id KEY_ID --issuer ISSUER_ID
xcrun notarytool log SUBMISSION_ID --key /secure/path/AuthKey.p8 --key-id KEY_ID --issuer ISSUER_ID notarization-log.json
```

Do not tell users to disable Gatekeeper or remove quarantine. Fix the release and publish a new version.

References: [Developer ID certificates](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/),
[notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution),
[packaging Mac software](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution).
