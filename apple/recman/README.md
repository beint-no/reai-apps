# ReAI RecMan

ReAI RecMan is a native Apple Silicon macOS 15+ proof of concept. It uses synthetic fixtures derived from the [RecMan API documentation](https://developers.recman.io/) and writes to a disposable ReAI company at `http://localhost:8080`. No RecMan credentials or live RecMan calls are needed.

## Run the sample

1. Start the ReAI dev app on localhost port 8080. Use a disposable NOK company with payroll enabled, VAT registration covering the sample date and an open accounting period. Sign in as a user who can manage employees, customers, products, invoices and payroll in that company.
2. From the repository root, run `tools/apple/build.py recman` with Swift 6.4. Open `dist/recman/ReAI RecMan.app` for local testing.
3. Select **Connect to ReAI**, approve the disposable company in the browser, and return to the app.
4. Choose a sample date in an unused payroll period and select **Load Sample**. The preview lists customer and product mappings, employee and employment actions, two issued documents and the draft wage line. The two-municipality case appears under **Hold for review**.
5. Select **Import Sample…** and confirm. The app verifies the saved employee relations, booked amounts, VAT, original PDF bytes and the draft wage line. Load and run the same sample again to check the results without creating duplicates.

The fixture represents candidates marked as employees in RecMan. It creates or matches two employees and their employment relations, one customer and a synthetic 25% VAT staffing product. It books one already-issued invoice and one negative credit note with their original PDFs. The credit note remains unapplied. The app uses an all-zero synthetic bank account because ReAI requires an account even for a draft. It adds the single-municipality wage line to a regular draft salary payment and leaves the multi-municipality wage lines for manual review. Individual time entries stay out of ReAI.

Sample mappings are fixed for the demo. Client-specific employee identity, product and wage mappings, and the availability of workplace information in real RecMan payloads require separate verification. Payroll submission, bank payments, invoice delivery and live RecMan sync are outside this POC.

## Local state and recovery

The approved ReAI token is stored in Keychain under `no.reai.recman`. **Disconnect** removes that local credential. Revoke the approval from ReAI if you also want to invalidate the server token. Remove the locally built app when finished. Local ad-hoc builds are for development only. A distributable build requires the shared signed and notarized release pipeline.

The journal in `~/Library/Application Support/ReAIRecMan/` records each operation before posting and retains confirmed results for replay checks. An interrupted or unverified write stops subsequent imports for that company. Check its state in localhost ReAI before proceeding. For this POC, start over in a new disposable company after an unresolved write. Keep the journal when reusing an existing company.
