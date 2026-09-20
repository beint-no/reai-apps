# ReAI Apps

### Small apps. Connected to ReAI.

Focused tools for the jobs that deserve their own app. Install what you need, connect your ReAI account, and get back to work.

Our open-source apps use the [ReAI public API](https://app.reai.no/openapi/public/ui). Your data stays in ReAI; each app provides a native experience for a specific task.

## The collection

| App | What it does | Platform | Availability |
| --- | --- | --- | --- |
| **[Time Tracker](https://github.com/beint-no/reai-time-tracker)** | Start and stop work from your menu bar. Save time directly to your ReAI timesheet. | macOS 15+ · Apple Silicon & Intel | [Download preview](https://github.com/beint-no/reai-time-tracker/releases) · MIT open source |
| **Finder Vault** | A native ReAI document vault. | macOS | Planned for the public collection; repository currently private |

**Time Tracker preview:** the app is downloadable without building. Its browser connection needs the `time-tracker` client registration deployed in ReAI. The initial download is not Apple notarized; its README explains macOS installation. Check the release notes for readiness before sharing it with customers.

## Connect once. Work in your own way.

1. **Install an app** from its GitHub Releases page. Choose a ready-built app under Assets, not the source archive.
2. **Connect to ReAI** using your browser. Check the approval code matches the code shown in the app.
3. **Choose your company** and start working. The app uses your existing ReAI permissions.

Native apps keep connection keys in the operating system's secure storage. User API keys inherit the account's existing permissions across accessible companies. You can revoke them from your [ReAI profile](https://app.reai.no/user/profile#user-access-tokens).

## One category for the whole suite

Every public app in this collection carries the **[`reai-apps`](https://github.com/topics/reai-apps)** topic, alongside `reai` and its platform topics. This repository is the shared landing page and catalog; each app keeps its own code, issues, license and downloadable releases.

[Browse ReAI Apps on GitHub](https://github.com/search?q=org%3Abeint-no+topic%3Areai-apps&type=repositories)

## Have an idea?

[Suggest an app](https://github.com/beint-no/reai-apps/issues/new?template=app-idea.yml). Describe the task, who needs it, and what they should be able to do. Small, focused tools are welcome.

Want to contribute an app? Open a pull request adding it to the table once it has a public repository, an open-source license, a useful README, and a working installable release. Document its permissions and never put credentials in source code or release assets.

For API integrations, start with the canonical [OpenAPI JSON](https://app.reai.no/openapi/public). New “Connect to ReAI” clients must be registered by the ReAI server administrator; public client IDs cannot self-register.

---

Made for ReAI users. Built in the open.
