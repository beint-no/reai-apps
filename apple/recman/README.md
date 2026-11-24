# ReAI RecMan

Native Apple Silicon macOS 15+ app for reviewing RecMan employee, invoice, credit note, and payroll records and importing them into ReAI.

## Connect

1. Build with `tools/apple/build.py recman` using Swift 6.4 and open `dist/recman/ReAI RecMan.app`.
2. Open **ReAI URL…**. Enter a loopback root such as `http://localhost:8080` or select `https://app.reai.no`. The ReAI server must advertise the same root in its device-approval URL.
3. Select **Connect to ReAI** and approve the NOK company. Your ReAI access determines the records and actions available.
4. Save the RecMan key under **Set RecMan Key…**. **Test RecMan** checks read access and identifies the RecMan organization when the key exposes it. Grant SELECT on candidates, companies, products, invoices, credit notes, payroll, work, and projects for the corresponding workflows.

## Import

- **Employees.** Load, review, and check the employees to import. The app sends names, emails, and employment dates and percentages. It adds missing employment relations to exact matches and leaves existing relations for review when they differ. ReAI applies defaults for employment fields the app leaves unset. Review employment forms, working hours, bank details, and workplace information in ReAI before payroll.
- **Invoices.** Choose an inclusive start date. Review the issued invoices and credit notes, confirm the amounts are in NOK, and map source customers and products to ReAI. The ReAI product must have an explicit revenue account and compatible VAT code. The app can create an unmatched Norwegian business customer after you choose that mapping. It fetches the original PDFs before writing, verifies amounts and VAT, and books with reminders disabled. Paid invoices and lines whose totals cannot be represented by the import API need a separate review. Credit notes are booked as issued documents and remain unapplied.
- **Payroll.** Choose a month and payment date. Review unexported RecMan paychecks, match employees, and select a ReAI wage type for each source article. Review linked workplace information and confirm that every line on a paycheck can use the municipality already configured on the ReAI employment relation. Leave multi-municipality or uncertain cases for manual handling. The app creates or resumes its own draft with regular salary payments and wage lines. ReAI remains the place to review, approve, and run payroll.

Check records and confirm the operation and destination before each import. The app does not send invoices or EHF, submit A-melding, or execute payments.

## Local state and recovery

RecMan and ReAI credentials use separate Keychain items under `no.reai.recman`. ReAI approvals and import journals are scoped to the selected server. Changing the server clears the preview and restores its approval, when available. Disconnect removes the credential for that server.

RecMan access is GET-only and user-triggered. Under `~/Library/Application Support/ReAIRecMan/`, the app keeps a 24-hour cache of companies, products, and projects and counts up to 200 requests per configured key per Oslo calendar day. Journals retain per-record receipts and advance incremental checkpoints only through a range with no unimported eligible records. Employee input, document PDFs, and payroll previews stay in memory.

A pre-write receipt records the operation and digest before each POST. A write with an uncertain outcome blocks additional writes to that ReAI company. Check the destination record and reconcile the journal before resuming. Do not delete the journal or retry against a fresh profile to work around an uncertain write.

Local builds are for development. Publish a distributable build through the shared signing and notarization workflow after review and merge.
