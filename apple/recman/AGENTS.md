# ReAI RecMan

Native macOS proof of concept. Build with `tools/apple/build.py recman` from the repository root using Swift 6.4.

Use synthetic RecMan fixtures based on the public API docs. Use localhost ReAI only and reject HTTP redirects. Authorize one disposable company with device auth, send its tenant ID, and keep the token in the app's Keychain service. Read `/openapi/public` before changing API calls.

Preview before writing. Verify employee identity, employment relations, customer and product mapping before dependent writes. Import issued documents with original numbers and PDFs. Create only draft payroll through regular salary payments and wage specs. Keep multi-municipality payroll for manual review. Never send invoices, submit A-melding, post payroll or issue bank payments.

Persist a local operation receipt before each POST. An interrupted or unverified write blocks further writes in the company pending manual reconciliation. Never silently reset an unreadable journal. Keep all client data and credentials outside Git.
