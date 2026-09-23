# ReAI Stripe Import for Mac

Manually bring selected paid Stripe invoices into ReAI and stage simple subscriptions for a later handover. macOS 15+ on Apple Silicon. Nothing runs in the background.

## Connect

1. In your [Stripe Dashboard → API keys](https://dashboard.stripe.com/apikeys), create a **restricted key** for the account you want to import. Grant **Read** access to **Account, Customers, Invoices, and Subscriptions**. Grant no write permissions. Start with a test key (`rk_test_…`) against test data, then use a live key (`rk_live_…`) when ready. A publishable key (`pk_…`) cannot read these records; a full secret key (`sk_…`) is unnecessary. Paste the restricted key into the app. The key is stored in this Mac's Keychain, never sent to ReAI.
2. Select **Connect to ReAI**. Your browser opens ReAI's approval page. Compare the code, sign in, choose the company, and approve. ReAI's own device connection needs no app registration or Stripe OAuth setup. The ReAI token stays in Keychain and can be revoked from your [ReAI profile](https://app.reai.no/user/profile#user-access-tokens).
3. Pick a **non-stock, zero-rate product** in ReAI. The app uses its VAT code and revenue category for historical invoices. Create one in ReAI if needed. Check that this product and its zero VAT treatment are appropriate for the selected sales; the app does not infer tax treatment.

## Paid invoices

Click **Import** on an eligible invoice and confirm. The app creates a historical invoice in ReAI with a paid record. It uses ReAI's idempotent invoice import with Stripe account and invoice IDs, so retrying the same unchanged invoice returns the existing record. A conflicting record or number stops with an error for review.

This first version accepts only a fully paid, positive invoice with verified zero tax, a normal two-decimal currency matching the ReAI company's currency (NOK, EUR, USD or GBP), and exactly one existing ReAI customer matched by email. It records the total as one line using the selected product. It imports with `accounting=none`: **historical revenue, VAT and bank postings are not created**. Handle any opening balance and bank reconciliation separately with your accountant. It does not send an invoice or reminder, alter Stripe, import refunds, or import credit notes. Skipped items show the reason in the list. Stripe's newest 500 paid invoices are shown; the app warns if older pages remain.

## Subscriptions

Click **Stage** for an eligible active subscription. The app creates a ReAI subscription starting at the next Stripe period boundary, with one fixed monthly or yearly item, matching currency and customer, and **automatic billing disabled**. It checks this customer's existing ReAI subscriptions for the Stripe ID before writing. Review the staged amount, VAT, customer, schedule and collection method in ReAI. Stripe remains active and keeps collecting payments. This app cannot move saved card details or payment mandates; plan and execute the billing switch separately, and avoid issuing a second charge for a period already paid in Stripe.

Subscription staging requires a single fixed-price item, explicit zero-tax configuration and exactly one existing ReAI customer matched by email. Complex plans, trials, metered prices, multiple items, tax or discounts need manual review. The newest 500 Stripe subscriptions are shown.

## Install and remove

Download the signed, notarized DMG from the [ReAI Apps page](https://beint-no.github.io/reai-apps/), open it and drag the app to Applications. To update, quit and replace the app. To remove, delete the app, use **Remove key from this Mac** for the Stripe key, and revoke the ReAI token in your ReAI profile. Existing ReAI records remain.

Build locally with `python3 tools/apple/build.py stripe` using Swift 6.4. Local builds are for development; published builds go through the repository's signing and notarization workflow.
