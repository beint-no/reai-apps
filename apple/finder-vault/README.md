# ReAI Finder Vault

Upload documents to ReAI from your Mac, or watch selected folders for new files.

## Install

Requires **Apple Silicon (M1 or newer)** and **macOS 15+**.

1. [Download Finder Vault](https://beint-no.github.io/reai-apps/#finder-vault).
2. Open **ReAI-Finder-Vault-Apple-Silicon.dmg** and drag **ReAI Finder Vault.app** into Applications.
3. Open the app and click **Connect to ReAI**. Sign in in your browser, compare the code, choose a company, and approve.
4. Choose a destination and add files, or choose a folder to watch.

Published downloads are Developer ID signed and Apple-notarized. No build tools, GitHub account, or security-setting changes are needed.
To update, quit the app and replace it in Applications.

## Uploads

- Choose documents, receipts, or supplier invoices as the destination. Your ReAI account needs permission to upload there.
- Drag files into the app or use **Add files**. Originals stay in place; the app keeps a local copy and transfer history.
- Enable **Watch company inboxes** to scan the app's company folders. Use **Open folder** to find them.
- Add a watched folder to upload new or changed files while the app is open. Existing files are skipped when the folder is first added. Subfolders are not watched.
- Identical file contents already staged for the same company and destination are skipped.
- If an upload is interrupted, check ReAI before retrying: the server may already have received it.
- To change company, disconnect and connect again. Existing folder mappings remain associated with their original account and company.

## Access and privacy

The app connects directly to `https://app.reai.no`. Your password stays in the browser; the access key is stored in macOS Keychain.
The key is restricted to the company chosen during approval, using your existing permissions, until revoked.
**Disconnect** removes the local key. Revoke server access in your [ReAI profile](https://app.reai.no/user/profile#user-access-tokens).
There is no analytics or third-party upload service.

## Development

Swift 6.4, SwiftUI, no third-party dependencies. From the repository root:

```sh
python3 tools/apple/build.py finder-vault
```

Set `SWIFT_BIN` if needed. Development builds appear in `dist/finder-vault/`.
See [release instructions](../../tools/apple/README.md) and the [public API contract](https://app.reai.no/openapi/public).

[MIT license](../../LICENSE) · [Report an issue](https://github.com/beint-no/reai-apps/issues)
