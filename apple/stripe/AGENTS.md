Manual Stripe to ReAI migration app. Build with `python3 tools/apple/build.py stripe`.
Stripe keys are read only and held in the app Keychain. Never log or persist Stripe responses.
Only import simple, fully paid, tax-free invoices with an explicitly selected zero-rate ReAI product.
Use ReAI's tenant-scoped idempotent invoice import. A 409 requires user review, not automatic retry.
Stage subscriptions with automaticBillingGeneration=false; never cancel Stripe or move payment methods.
Keep the migration manual and show skipped records and reasons. No background polling or webhooks.
