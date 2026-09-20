Native Apple Silicon importer for products, customers and suppliers. Swift 6.4, macOS 15+.
Read the canonical public API before changing payloads. Creates only; never silently overwrite existing records.
Use the shared company-scoped browser connection and Keychain. Keep file parsing and network work off the main actor.
ZIPFoundation is pinned for safe in-memory XLSX decompression; do not implement another ZIP parser. Bound file size, expanded data, rows and columns. Never evaluate spreadsheet formulas or resolve external XML entities.
Column matching is local and editable. Numeric separators and defaults must be visible. Do not infer VAT codes from percentages.
Persist each sending state before POST. Interrupted/ambiguous writes require checking ReAI, never automatic retries. Store journals privately, separate from credentials.
Build: python3 tools/apple/build.py import. Shared signing/notarization and release instructions: tools/apple/README.md.
