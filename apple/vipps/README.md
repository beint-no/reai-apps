# ReAI Vipps Reconcile for Mac

Manually compare Vipps MobilePay **scheduled payouts** with pending ReAI bank transactions for one month. Export a CSV for review. macOS 15+ on Apple Silicon. Nothing runs in the background.

## Connect

1. In the [Vipps MobilePay business portal](https://portal.vipps.no), open the production sales unit and copy its **client ID**, **client secret**, **subscription key** and **merchant serial number**. The [Report API quick start](https://developer.vippsmobilepay.com/docs/APIs/report-api/report-api-quick-start/) shows where these values go. The Report API is production only. A merchant with only a Vippsnummer and no API keys may need to use the business portal's settlement export instead; this app cannot access their reports with just a Vippsnummer. The app needs four fields; a single API key is not sufficient for this API. No ReAI or Vipps app registration is done by the Mac app.
2. In your [ReAI profile](https://app.reai.no/user/profile#user-access-tokens), create a **user access token** with permission to read company banks and bank reconciliation. Paste it into the app. Choose the company and its payout bank account. The token and Vipps credentials stay in this Mac's Keychain.
3. Pick a month and click **Review payouts**. The app reads Vipps funds ledgers by day, collects `payout-scheduled` entries, and compares their bank amount, currency, date and reference with ReAI's pending bank transactions. It shows an exact reference and amount suggestion separately from an amount/date candidate. Confirm any candidate in ReAI before booking.

Export CSV saves the payout reference, amount, status and possible ReAI transaction ID to a local file. The app does not create vouchers, record sales, infer VAT, match transactions, or change Vipps. A scheduled payout may arrive in the bank later, including the next month, so a missing match does not establish a discrepancy. Vipps may return a report later than the day it was scheduled. This app does not import individual sales or fee lines.

Remove credentials in the app and revoke the ReAI token in ReAI when finished. The app's credentials are never sent to ReAI. Build locally with `python3 tools/apple/build.py vipps` using Swift 6.4. Published DMGs are Developer ID signed and notarized.
