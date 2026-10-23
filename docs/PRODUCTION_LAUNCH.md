# Production launch runbook

The order of work to take Workpad from `workpad-dev` to an unlisted Chrome Web Store release. [PRODUCTION.md](PRODUCTION.md) explains each component; this file is the checklist. **Owner** is who does the step: *You* for anything needing your accounts, payment or secrets; *Claude* for repository, migration and deploy work once you have given access.

Status as of 23 October 2026: production Supabase is `workpad` (`wamtehiigikrvtnvshov`, London). A1, A6 and A7 are done: all six migrations are applied with access rules verified, all six Edge Functions are deployed, and the production Pro allowance is set to 200 credits (free 30). No OpenAI, Stripe or Google secrets are set on production yet.

## Decisions

Decided on 22 October 2026: Pro plan, London and the shared OAuth client. VAT handling and pricing are still open.

| Decision | Choice | Why |
| --- | --- | --- |
| Supabase plan for production | **Pro** (decided) | Free projects pause after about a week without activity. `workpad-dev` already paused once; a paused production project breaks sign-in, AI and billing for every user. |
| Supabase region | **London (eu-west-2)** (decided) | UK operator and likely UK/EU customers. Dev is in Ireland; either is acceptable for UK GDPR. |
| Google sign-in client | **Reuse the existing Web OAuth client** and add the store redirect (decided) | The client ID is fixed in `manifest.json`. One client with both the dev and store redirect URIs needs no per-environment build step. |
| VAT handling | Open: Stripe Tax, or a merchant of record (Paddle, Lemon Squeezy) | Selling digital services to UK and EU consumers requires VAT handling. A merchant of record is less work at small scale but means replacing the Stripe integration. **Blocks Stripe live mode.** |
| Credit allowances and Pro price | Open: set from the cost sample | The seeded limits (free 30, Pro 600 credits) and £1.99 are placeholders. **Blocks Stripe live mode and the listing copy.** |

## Phase A: infrastructure (no blockers)

| # | Step | Owner |
| --- | --- | --- |
| A1 | Create the production Supabase project (`workpad`, Pro plan, London). Send me the project ref. | You |
| A2 | In Supabase Auth: enable **Google**, enter the Web client ID and secret, and leave email sign-up disabled. Set the Site URL to `https://madhusudhankonda.github.io/workpad/`. | You |
| A3 | Register a Chrome Web Store developer account (one-off fee) and upload the current `workpad-0.1.0.zip` as a **draft** item. Do not submit it. This assigns the permanent extension ID. Send me the ID. | You |
| A4 | In Google Cloud for the existing OAuth client: add `https://<store-extension-id>.chromiumapp.org/` as an authorized redirect URI (keep the dev one). Move the OAuth consent screen to **In production** with the privacy and terms URLs. Scopes are `openid`, `email` and `profile`, which do not need Google verification. | You |
| A5 | Create a separate OpenAI project for production. Set a monthly budget and usage alerts, create its API key, and add it as Supabase secret `OPENAI_API_KEY` in the production project, either in the dashboard or with the prompt-based command from earlier. | You |
| A6 | Link the CLI to production (after you confirm the ref), dry-run then apply all migrations, and verify row security, grants and client access as done on dev. | Claude |
| A7 | Deploy all six Edge Functions: `ai-proxy`, `create-checkout`, `customer-portal`, `billing-return`, `stripe-webhook`, `delete-account`. Smoke-test that unauthenticated requests are refused. | Claude |
| A8 | Add GitHub repository secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` with the **production** values. The publishable key is public client configuration. Without these, the release workflow fails. | You |
| A9 | Build a production extension locally against production, sign in, and run one AI action and one research question. | You + Claude |

## Phase B: pricing and billing (after the cost sample and VAT decision)

| # | Step | Owner |
| --- | --- | --- |
| B1 | Set the measured allowances in `ai_plan_limits` with a migration, and update `src/config/pricing.ts` and the Pro offer copy to the new price. | Claude |
| B2 | First, in Stripe **test mode** against the production project: create the Workpad Pro product and GBP price, configure the Customer Portal (cancel, payment method, invoices), and add the webhook endpoint `https://<prod-ref>.supabase.co/functions/v1/stripe-webhook` with the six events in PRODUCTION.md. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID` and `WORKPAD_BILLING_RETURN_URL=https://madhusudhankonda.github.io/workpad/billing.html`. | You |
| B3 | Run the billing acceptance tests on the production project in test mode: checkout, failed payment, cancellation, portal, refund, duplicate webhook, and account deletion removing the Stripe customer and all rows. | You + Claude |
| B4 | Activate Stripe live mode (business details, bank account, tax), recreate the product, price, portal and webhook in live mode, and replace the four Stripe secrets with live values. Use a restricted key if possible. | You |

## Phase C: release (after A and B)

| # | Step | Owner |
| --- | --- | --- |
| C1 | Bump the version in `package.json` and both manifests, merge, and push a `v<version>` tag. The release workflow builds the production ZIP. | Claude |
| C2 | Upload the ZIP to the draft item. Complete the listing from [CHROME_WEB_STORE.md](CHROME_WEB_STORE.md), the single-purpose statement, the permission justifications and the privacy practices form. Set visibility to **Unlisted** and submit for review. | You |
| C3 | Disclosures for the privacy practices form: **website content** (page and selection text sent to Workpad AI and stored as research snapshots), **personal communications** (emails the user captures), **personally identifiable information** (account email) and **authentication information** (session tokens). Not sold, not used for advertising or creditworthiness, and covered by Limited Use. | You |
| C4 | After approval: install from the store, sign in, then run AI, research, a brief, backup export/import, checkout and the billing portal end to end. Invite the first 10–20 testers. | You |

## Known gaps to accept or fix before inviting testers

- **No error monitoring.** Only Supabase function logs exist. Acceptable for an unlisted beta; add a scrubbed error reporter before a public listing.
- **Dev and production share one Google OAuth client.** This is simpler, but a misconfigured redirect affects both. A separate production client would need a build-time manifest change.
- **The CSP only allows `*.supabase.co`.** A custom Supabase domain would need a manifest change.
- **Cloud sync covers notes only.** Research projects are local plus backups until sync is extended.
