Native macOS time tracker for the ReAI public API. Swift 6.4, SwiftUI, Observation, Swift 6 concurrency; macOS 15+ on Apple Silicon only. No third-party dependencies.
Use a dedicated worktree for changes. Keep credentials in Keychain, networking in actors, and timer/accounting behavior on ReAI.
Read https://app.reai.no/openapi/public before changing API calls. Every tenant request needs X-Tenant-Id.
Persist the exact start request UUID or stop timer ID before sending; never silently retry a mutation with a new identity.
App connections accept a self-declared `client_id` and `client_name`; no ReAI registration is required.
The user chooses a company in ReAI during approval. The key and `/api/me` are restricted to that company.
Keep UI and documentation concise and factual.
From the repository root, build/package with `python3 tools/apple/build.py time-tracker`. Follow the shared release instructions in tools/apple/README.md.
