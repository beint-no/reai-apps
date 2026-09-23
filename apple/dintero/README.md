# ReAI Dintero Fees for Mac

Review paid Dintero settlements for a month, compare their net payouts with pending ReAI bank transactions, and optionally create **one monthly fee voucher flagged for review**. Nothing runs in the background. macOS 15+ on Apple Silicon.

## Connect

1. In [Dintero Backoffice](https://backoffice.dintero.com/), open Settings → API & Integrations → API clients. Create an API client with read access to settlement reports. Copy its account ID, client ID, and client secret; the secret is shown only once. The app exchanges these locally for a short-lived API token using Dintero's client credentials flow. There is no browser OAuth. See [Dintero's API client guide](https://docs.dintero.com/docs/checkout/checkout-client) and [Settlement API](https://docs.dintero.com/billing-api.html). If Dintero denies settlement reads, check the client's billing/report/settlement permissions.
2. Create a [ReAI user access token](https://app.reai.no/user/profile#user-access-tokens) with permission to read bank reconciliation and vouchers and, if you intend to book fees, create manual vouchers. Paste it in the app and choose a company and bank account.
3. Choose a payout month and click **Review settlements**. The app totals the `fee` values on paid Dintero settlement amounts in the company's currency. Compare that total with Dintero's payout report before booking.
4. To book withheld fees, enter a fee expense account and a payout clearing asset/liability account from ReAI. Confirm that the total matches the payout reports and has **not** already been invoiced or booked. Click **Create fee voucher for review**. ReAI receives a debit to the expense account and credit to the clearing account, with VAT code 0 and a review flag. Check the source documentation and VAT treatment in ReAI before clearing review.

Dintero says its payout reports show gross sales, deducted fees and net payouts. It also offers free automated delivery of payout reports to accounting systems. If Dintero has separately invoiced a fee, or the fee is already booked through a report/integration, **do not create a second voucher here**. The app checks for its own existing voucher marker for the account and month, but cannot identify all entries made outside this app. It does not post sales, refunds, VAT, or bank matches.

Export CSV writes the reviewed settlement rows to a local file. Both credentials stay in this Mac's Keychain. Remove them in the app and revoke the ReAI token in ReAI when finished. Build with `python3 tools/apple/build.py dintero` using Swift 6.4. Published DMGs are Developer ID signed and notarized.
