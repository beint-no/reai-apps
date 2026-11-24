# ReAI RecMan

Native Apple Silicon macOS 15+ proof of concept for importing selected RecMan employees and employment relations into an approved ReAI company on a local server or on `https://app.reai.no`.

## Import employees

1. Build from the repository root with `tools/apple/build.py recman` and Swift 6.4. Open `dist/recman/ReAI RecMan.app`.
2. Select **ReAI URL…** and enter the server root. Use a loopback URL such as `http://localhost:8080` for development, or `https://app.reai.no` for production. A local ReAI instance must advertise the selected root in its device-approval URL.
3. Select **Connect to ReAI** and approve the NOK company in the browser. The signed-in user needs permission to manage its employees.
4. Select **Set RecMan Key…** and save a RecMan key with Candidates SELECT permission. **Load Employees** reads RecMan’s employee list and prepares the ReAI preview. Each load is limited to ten RecMan requests.
5. Check the employees to import. **Select All** checks eligible rows, and **Select None** clears the selection. Select **Import Selected Employees…** and confirm.

The import sends names, email addresses, employment start and end dates, and position percentages. ReAI applies its defaults for employment fields the app leaves unset, including employment form and working hours. Check these fields in ReAI before using an imported employment relation for payroll. The app does not transfer national IDs, bank accounts, wage lines, or municipality values.

The preview requires a unique name and email and one RecMan employment relation with valid dates and a position percentage. Exact existing ReAI matches are reused. Conflicts are flagged for review. An exact employee match without an employment relation can receive one. Imports never update an existing relation.

## Local state and recovery

The RecMan key and approved ReAI tokens are stored as separate Keychain items under the `no.reai.recman` service. Each ReAI root has its own approval and import journal. Changing the root clears the employee preview and restores the selected root’s saved approval when available. **Disconnect** removes the credential for the selected root. Revoke the approval in ReAI to invalidate that server token. RecMan requests are GET-only and the employee preview is held in memory.

The journal under `~/Library/Application Support/ReAIRecMan/` records operation identifiers, request digests, and confirmed ReAI IDs. An interrupted or unverified write blocks further imports into the company until the recorded operation is reconciled in ReAI. Keep the journal when reusing an existing company.

Local ad-hoc builds are for development. A distributable build requires the shared signed and notarized release pipeline.
