# Production launch runbook

The order of work to take Workpad from `workpad-dev` to an unlisted Chrome Web Store release. [PRODUCTION.md](PRODUCTION.md) explains each component; this file is the checklist. **Owner** is who does the step: *You* for anything needing your accounts, payment or secrets; *Claude* for repository, migration and deploy work once you have given access.

Status as of 24 October 2026: Workpad 0.1.1 is **submitted to the Chrome Web Store for Unlisted review**. Production runs on Supabase `workpad` (`wamtehiigikrvtnvshov`, London) with Google sign-in, Workpad AI and live Stripe billing working end to end. The store extension ID is `fjkidcpbclhdbnignknhkbmlmpcpgaad`. Before inviting testers: decide VAT, confirm the OpenAI budget, and test account deletion on production.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Supabase plan for production | **Pro** (decided 22 Oct) | Free projects pause after about a week without activity. `workpad-dev` already paused once; a paused production project breaks sign-in, AI and billing for every user. |
| Supabase region | **London (eu-west-2)** (decided 22 Oct) | UK operator and likely UK/EU customers. Dev is in Ireland; either is acceptable for UK GDPR. |
| Google sign-in client | **Reuse the existing Web OAuth client** with the store redirect added (decided 22 Oct) | The client ID is fixed in `manifest.json`. The manifest `key` gives local builds the store ID, so one redirect URI covers local and store installs. |
| Billing provider | **Stripe** (decided 23 Oct) | Already integrated. A merchant of record would mean replacing the billing integration before launch. |
| Pro price and allowances | **£1.99 a month; Pro 200 credits, free 30** (decided 23 Oct, tentative) | Low entry price for the beta, to revisit with usage data. Production `ai_plan_limits` is set; dev keeps the seeded values. |
| VAT handling | **Open** | Depends on VAT registration and whether the beta is UK-only. If registered or selling to EU consumers, add Stripe Tax (`automatic_tax` and address collection) to `create-checkout`. **Blocks inviting paying testers.** |

## Phase A: infrastructure

| # | Step | Owner | Status |
| --- | --- | --- | --- |
| A1 | Create the production Supabase project (`workpad`, Pro plan, London). | You | Done |
| A2 | In Supabase Auth: enable **Google** with the Web client ID and secret, disable email sign-in, and set the Site URL to `https://madhusudhankonda.github.io/workpad/`. | You | Done |
| A3 | Register a Chrome Web Store developer account and create the item, which assigns the permanent extension ID. | You | Done: `fjkidcpbclhdbnignknhkbmlmpcpgaad` |
| A4 | In Google Cloud for the existing OAuth client: add `https://fjkidcpbclhdbnignknhkbmlmpcpgaad.chromiumapp.org/` as a redirect URI (keep the dev one) and move the consent screen to **In production** with the privacy and terms URLs. | You | Done |
| A5 | Production OpenAI key as Supabase secret `OPENAI_API_KEY`, with a monthly budget and usage alerts on its OpenAI project. | You | Key set; **confirm budget and alert** |
| A6 | Apply all migrations to production and verify row security, grants and client access. | Claude | Done |
| A7 | Deploy the six Edge Functions and check that unauthenticated requests are refused. | Claude | Done; `stripe-webhook` redeployed with the `cancel_at` fix (#32) |
| A8 | Add GitHub repository secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` with production values. | You | Done |
| A9 | Build against production, sign in, and run an AI action and a research question. | You + Claude | Done |

## Phase B: pricing and billing

Stripe test mode was skipped: the live account was configured directly and tested with a real subscription that was then refunded.

| # | Step | Owner | Status |
| --- | --- | --- | --- |
| B1 | Set the production allowances in `ai_plan_limits`, and match `src/config/pricing.ts` and the Pro offer copy to the price. | Claude | Done: Pro 200, free 30, £1.99 |
| B2 | In Stripe **live** mode: Workpad Pro product and GBP price, Customer Portal (cancel, payment method, invoices), webhook endpoint `https://wamtehiigikrvtnvshov.supabase.co/functions/v1/stripe-webhook` with the six events in PRODUCTION.md, and the four Stripe secrets on production (restricted key). | You | Done |
| B3 | Billing acceptance on production: checkout, cancellation, refund and webhook delivery. | You + Claude | Done; cancellation exposed the `cancel_at` bug, fixed in #32 |
| B4 | Remaining acceptance: failed payment, duplicate webhook delivery, and account deletion removing the Stripe customer and all rows. | You + Claude | **Open**: test Delete account with a throwaway account |
| B5 | VAT: add Stripe Tax to checkout if the VAT decision requires it. | Claude | **Open**: waiting on the decision |

## Phase C: release

| # | Step | Owner | Status |
| --- | --- | --- | --- |
| C1 | Bump the version in `package.json` and both manifests, merge, and push a `v<version>` tag. The release workflow builds the production ZIP without the manifest key. | Claude | Done: [v0.1.1](https://github.com/madhusudhankonda/workpad/releases/tag/v0.1.1) |
| C2 | Upload the ZIP, complete the listing from [CHROME_WEB_STORE.md](CHROME_WEB_STORE.md) with the assets in `store-assets/`, add the permission justifications and single purpose, set visibility to **Unlisted** and submit. | You | Done: submitted 24 Oct |
| C3 | Privacy practices disclosures: **website content**, **personal communications**, **personally identifiable information** and **authentication information**; not sold, not used for unrelated purposes or creditworthiness; remote code: none. | You | Done |
| C4 | After approval: export a backup from the unpacked install, remove it, install from the store, sign in, import the backup, then run AI, research, a brief, backup export/import, checkout and the billing portal end to end. If publishing was deferred, click Publish within 30 days of approval. | You | Waiting for review |
| C5 | Invite the first 10–20 testers with the unlisted link. | You | After C4, B4 and B5 |

## Known gaps to accept or fix before inviting testers

- **No error monitoring.** Only Supabase function logs exist. Acceptable for an unlisted beta; add a scrubbed error reporter before a public listing.
- **Dev and production share one Google OAuth client.** This is simpler, but a misconfigured redirect affects both. A separate production client would need a build-time manifest change.
- **Delete account is styled as a primary action** in Settings. Restyle it as a quiet danger action in a later release.
- **The extension's toolbar icons** in `public/icons` still use the old design; the store icon is new.
- **The CSP only allows `*.supabase.co`.** A custom Supabase domain would need a manifest change.
- **Cloud sync covers notes only.** Research projects are local plus backups until sync is extended.
