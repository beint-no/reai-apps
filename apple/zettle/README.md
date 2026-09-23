# ReAI Zettle Reconcile for Mac

Manually compare Zettle payouts with pending ReAI bank transactions for one month. Export a CSV for review. macOS 15+ on Apple Silicon. Nothing runs in the background.

## Connect

1. Follow Zettle's [self-hosted app credential instructions](https://developer.zettle.com/docs/get-started/user-guides/create-app-credentials/create-app-credentials-for-self-hosted-app/create-credentials-self-hosted-app). Create a key with **READ:FINANCE** scope. Paste both its **client ID** and **API key** into the app. Zettle requires a client ID as well as the key and may require a developer account to create these credentials. The app exchanges the key for a short-lived access token internally; there is no browser approval flow.
2. Create a **user access token** from your [ReAI profile](https://app.reai.no/user/profile#user-access-tokens) with read access to company banks and reconciliation. Paste it into the app and choose the company and payout bank account. Both credentials stay in this Mac's Keychain.
3. Pick a month and click **Review payouts**. The app reads Zettle Finance API `PAYOUT` transactions from the liquid account, treats their negative amount as the positive bank deposit, and compares amount, currency and date with pending ReAI bank transactions. Zettle's payout UUID may not appear on the bank statement, so amount/date candidates require review.

Export CSV saves the payout reference, amount, status and possible ReAI transaction ID to a local file. The app does not create vouchers, record POS sales, infer VAT, match transactions, or change Zettle. A payout may arrive in the bank later or in the next month. The [Finance API](https://developer.zettle.com/docs/api/finance/user-guides/fetch-account-transactions) supplies payout amounts; purchase details and VAT need a separate sales import.

Remove credentials in the app and revoke the ReAI token in ReAI when finished. The Zettle key is never sent to ReAI. Build locally with `python3 tools/apple/build.py zettle` using Swift 6.4. Published DMGs are Developer ID signed and notarized.
