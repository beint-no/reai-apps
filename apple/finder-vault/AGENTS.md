Native macOS Finder Vault client. Swift 6.4, SwiftUI, macOS 15+.
Keep networking and file processing off the main actor. No third-party dependencies.
The public ReAI API owns permissions and accounting behavior. Every request binds to an explicit company.
From the repository root, build/package with `python3 tools/apple/build.py finder-vault`. Follow tools/apple/README.md for signed releases.
Connections use browser approval with one selected company; no manual token entry or client registration.
Keep source files intact. Interrupted uploads require checking ReAI before retrying; do not silently duplicate documents.
This module is independent of Gradle and main application deployment.
