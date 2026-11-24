# ReAI RecMan

ReAI RecMan is a native Apple Silicon macOS 15+ proof of concept. It uses synthetic fixtures derived from the [RecMan API documentation](https://developers.recman.io/) and writes to a disposable ReAI company at `http://localhost:8080`. No RecMan credentials or live RecMan calls are needed.

## Run the sample

1. Start the ReAI dev app on localhost port 8080. Use a disposable NOK company and sign in as a user who can manage employees in that company.
2. From the repository root, run `tools/apple/build.py recman` with Swift 6.4. Open `dist/recman/ReAI RecMan.app` for local testing.
3. Select **Connect to ReAI**, approve the disposable company in the browser, and return to the app.
4. Click **Load Sample** and check the employees to import. **Select All** checks every employee ready to import. **Select None** clears the selection.
5. Click **Import Selected Employees…** and confirm. The app creates or matches the checked employees and their employment relations.

The sample contains two employees. Candidates without employee status are excluded. Repeat the same selection to verify the saved records without creating duplicates.

## Local state and recovery

The approved ReAI token is stored in Keychain under `no.reai.recman`. **Disconnect** removes that local credential. Revoke the approval from ReAI if you also want to invalidate the server token. Remove the locally built app when finished. Local ad-hoc builds are for development only. A distributable build requires the shared signed and notarized release pipeline.

The journal in `~/Library/Application Support/ReAIRecMan/` records each operation before posting and retains confirmed results for replay checks. An interrupted or unverified write stops subsequent imports for that company. Check its state in localhost ReAI before proceeding. For this POC, start over in a new disposable company after an unresolved write. Keep the journal when reusing an existing company.
