# ReAI RecMan

Native macOS proof of concept. Build with `tools/apple/build.py recman` from the repository root using Swift 6.4.

Load employees with the RecMan v2 Candidates SELECT scope on explicit request. Bound paging and reject HTTP redirects. RecMan and ReAI credentials use separate items in the app’s Keychain service. Accept only loopback roots and the official HTTPS production root. Bind device authorization, tokens, and journals to the selected root. Send the approved tenant ID on scoped requests. Read `/openapi/public` before changing ReAI requests.

Preview before writing. Match employee identity and validate one supported employment relation. Never overwrite an existing employment relation or import national ID, bank, wage, or municipality data in this flow.

Persist a receipt before each POST. An interrupted or unverified write blocks further writes in the company pending manual reconciliation. Never silently reset an unreadable journal. Keep client data and credentials outside Git.
