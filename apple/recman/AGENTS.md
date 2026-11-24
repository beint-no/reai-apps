# ReAI RecMan

Build with `tools/apple/build.py recman` using Swift 6.4. Keep client data, credentials, and real screenshots outside Git.

Use only explicit, bounded RecMan v2 GET requests. Keep RecMan and ReAI credentials separate in Keychain. Scope ReAI tokens and journals to the selected loopback root or official HTTPS production root. Send the approved tenant ID on scoped requests. Review `/openapi/public` before changing ReAI requests.

Preview and validate before each import. Require reviewed mappings for unmatched employees and customers, products, VAT, revenue accounts, and wage codes. Only import amounts that the ReAI API can represent and preserve the original PDFs. Require workplace confirmation against the ReAI employment relation before drafting payroll. Do not write RecMan export logs, send invoices or EHF, submit A-melding, finalize payroll, or initiate payments.

Persist operation receipts before POST. An interrupted or unverified write blocks later writes for that ReAI company pending reconciliation. Never reset an unreadable journal or advance a checkpoint beyond an eligible unimported record.
