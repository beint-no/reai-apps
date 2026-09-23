# ReAI Klarna Reconcile for Mac

Manually compare Klarna settlement payouts with pending ReAI bank transactions for one month. Export a CSV for review. macOS 15+ on Apple Silicon. Nothing runs in the background.

## Connect

1. Create an API key in [Klarna Merchant Portal](https://portal.klarna.com/) with access to the [Settlements API](https://docs.klarna.com/acquirer/klarna/api/settlements/). Paste the `klarna_live_api_…` key into the app. [Klarna authentication instructions](https://docs.klarna.com/acquirer/klarna/get-started/integration-resilience/authentication/) explain API key creation. One Klarna key is sufficient; the app sends it using Klarna's Basic authorization header. No browser OAuth or app registration is needed.
2. Create a **user access token** from your [ReAI profile](https://app.reai.no/user/profile#user-access-tokens) with read access to company banks and reconciliation. Paste it into the app and choose the company and payout bank account. Both credentials stay in this Mac's Keychain.
3. Pick a month and click **Review payouts**. The app reads Klarna's paginated payouts and compares settlement amount, currency, payout date and payment reference with ReAI's pending bank transactions. An amount/date candidate is a suggestion, not a confirmed match.

Export CSV saves the payout reference, amount, status and possible ReAI transaction ID to a local file. The app does not create vouchers, record sales, infer VAT, match transactions, or change Klarna. A payout may arrive in the bank later or in the next month. The app uses Klarna's payout totals for bank comparison, not gross sales; use a transaction-level report and your accountant for sales, returns, fee and VAT postings.

Remove credentials in the app and revoke the ReAI token in ReAI when finished. The Klarna key is never sent to ReAI. Build locally with `python3 tools/apple/build.py klarna` using Swift 6.4. Published DMGs are Developer ID signed and notarized.
