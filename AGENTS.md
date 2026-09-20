# ReAI Apps

Use a dedicated worktree under ~/.r-worktrees and a descriptive codex/ branch. Read the app's AGENTS.md before changing its source.
Keep user-facing copy concise and factual. Never commit credentials, private keys, signing files, build output, or customer data.

Apple apps use Swift 6.4, SwiftUI, Observation, strict concurrency, macOS 15+, and arm64 only. No third-party dependencies unless justified.
Keep each app independent. Share release tooling; introduce shared runtime code only when real duplication warrants it.
Read https://app.reai.no/openapi/public before changing API calls. ReAI owns permissions and accounting behavior.
Device authorization accepts self-declared app names. Approval chooses one company; tokens remain bound to it.

Windows apps live in windows/; read windows/AGENTS.md and the app module instructions. Shared build tools live in tools/windows.

apps.json is authoritative for app identity and downloadable filename.
Build affected apps with python3 tools/apple/build.py <app>. Set SWIFT_BIN when Swift 6.4 is not the default.
Never release an ad-hoc Apple build. Release tags use <app>/v<version> and point to a commit merged into main. The Release app action on main chooses the next patch version; build numbers use GITHUB_RUN_NUMBER.
The apple-release environment holds signing and notary secrets; PR jobs must never receive them.
Sign with hardened runtime, notarize the outer DMG, staple and assess before publishing. See tools/apple/README.md.

site/ is a static GitHub Pages site built using Python's standard library. No runtime framework, tracking, external fonts, or browser JS.
Build with python3 site/build.py; --offline shows the unpublished state. Preview in a browser after visual changes.
Downloads come only from published, non-prerelease app releases. Do not link to CI artifacts. Apple downloads must be signed and notarized. The owner chose free unsigned Windows ZIP releases; label them clearly and explain SmartScreen/Smart App Control restrictions. Do not add paid signing or Store requirements.
Keep app versions independent. Add new platform folders when they contain a real app.
