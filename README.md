# ReAI Apps

Applications that use the [ReAI API](https://app.reai.no/openapi/public/ui).

| App | Purpose | Requirements | Download |
| --- | --- | --- | --- |
| [Time Tracker](https://github.com/beint-no/reai-time-tracker) | Start and stop your timesheet timer from the menu bar. | Apple Silicon · macOS 15+ | [Latest release](https://github.com/beint-no/reai-time-tracker/releases/latest) |
| Finder Vault | Upload documents to ReAI from your Mac. | macOS | Private repository; not publicly available yet |

Time Tracker is MIT licensed. Its README includes installation instructions. The current download is not Apple-notarized.

## Connect an app

Apps can connect without registration or backend changes. The app opens ReAI in your browser; compare the approval
code, choose a company, and approve access. App names are self-declared. Only approve apps you trust.

Each connection is restricted to the company chosen during approval, using your existing API permissions. Revoke them in your
[ReAI profile](https://app.reai.no/user/profile#user-access-tokens).

For an implementation example, see [Time Tracker’s connection code](https://github.com/beint-no/reai-time-tracker/blob/main/Sources/ReAITimeTracker/Connection.swift).
Use the [public OpenAPI contract](https://app.reai.no/openapi/public) for API requests.

## Contribute

[Suggest an app](https://github.com/beint-no/reai-apps/issues/new?template=app-idea.yml) or open a PR to add one.
Each listed public app needs an open-source license, installation instructions, and a downloadable release.
Use the [`reai-apps` topic](https://github.com/topics/reai-apps) to group repositories.

[Browse the repositories](https://github.com/search?q=org%3Abeint-no+topic%3Areai-apps&type=repositories).
