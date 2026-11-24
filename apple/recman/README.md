# ReAI RecMan

Native Apple Silicon macOS 15+ app for reviewing RecMan employee, invoice, credit note, and payroll records and importing them into ReAI.

## Connect

1. Build with `tools/apple/build.py recman` using Swift 6.4 and open `dist/recman/ReAI RecMan.app`.
2. Open **ReAI URL…**. Enter a loopback root such as `http://localhost:8080` or select `https://app.reai.no`. The ReAI server must advertise the same root in its device-approval URL.
3. Select **Connect to ReAI** and approve the NOK company. Your ReAI access determines the records and actions available.
4. Save the RecMan key under **Set RecMan Key…**. **Test RecMan** checks read access and identifies the RecMan organization when the key exposes it. Grant SELECT on candidates, companies, products, invoices, credit notes, payroll, work, and projects for the corresponding workflows.

## Import

- **Employees & Payroll.** Load employees, check the ones to import, then select **Review Import**. The preview includes only their unexported paychecks. The review shows how many paychecks are ready and which confirmations are missing. It reuses a saved municipality when it matches the verified workplaces. Evening, night, and weekend shift additions require a ReAI wage type for irregular supplements for time worked. Paychecks containing those additions are held while that wage type is unavailable. Confirm NOK, map RecMan wage articles to ReAI wage types, and confirm the workplace municipality. If the linked workplaces resolve to one municipality, the preview suggests its code for you to confirm. The app looks up the linked companies’ publicly registered workplace street and postcode using Kartverket. If no address can be resolved, enter a verified municipality manually. When workplaces resolve to multiple municipalities, verify how the employment should be recorded in ReAI. The app derives the payroll month from the wage lines and uses the company's ReAI payout setting to propose a payment date. It uses the last calendar day of the payroll month when no setting exists and retains the payment date of a draft it created earlier.
- **Import Employees & Payroll** adds or matches employees and employment relations, then adds ready wage lines to native ReAI drafts. The employee import sends names, emails, and employment dates and percentages. It fills blank bank accounts from RecMan when a Norwegian account passes validation and shows the last four digits in the preview. If payroll still needs review, **Save Employee Updates** saves independently confirmed municipalities and other ready employee changes. **Import Ready Records** imports ready drafts and shows how many paychecks remain held. ReAI applies defaults for other unset employment fields. Paychecks with incomplete mappings or prerequisites stay in review. If this app already created a draft for the month, it can append wage lines for the employees already on that draft.
- **Invoices.** Choose an inclusive start date. Review the issued invoices and credit notes, confirm the amounts are in NOK, and map source customers and products to ReAI. The ReAI product must have an explicit revenue account and compatible VAT code. The app can create an unmatched Norwegian business customer after you choose that mapping. It fetches the original PDFs before writing, verifies amounts and VAT, and books with reminders disabled. Paid invoices and lines whose totals cannot be represented by the import API need a separate review. Credit notes are booked as issued documents and remain unapplied.

Check records and confirm the operation and destination before each import. The app does not send invoices or EHF, submit A-melding, or execute payments.

## Local state and recovery

RecMan and ReAI credentials use separate Keychain items under `no.reai.recman`. ReAI approvals and import journals are scoped to the selected server. Changing the server clears the preview and restores its approval, when available. Disconnect removes the credential for that server.

RecMan access is GET-only and user-triggered. Under `~/Library/Application Support/ReAIRecMan/`, the app keeps a 24-hour cache of companies, products, and projects and counts up to 200 requests per configured key per Oslo calendar day. Journals retain per-record receipts and advance incremental checkpoints only through a range with no unimported eligible records. Employee input, document PDFs, and payroll previews stay in memory.

A pre-write receipt records the operation and digest before each POST. A write with an uncertain outcome blocks additional writes to that ReAI company. Check the destination record and reconcile the journal before resuming. Do not delete the journal or retry against a fresh profile to work around an uncertain write. When a previously imported employee has been deleted in ReAI, the preview offers **Recreate missing employee**. Confirm the deletion before importing. The app retains the old receipt and records the new import separately.

Local builds are for development. Publish a distributable build through the shared signing and notarization workflow after review and merge.
