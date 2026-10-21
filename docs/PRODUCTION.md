# Workpad production deployment

Workpad keeps local notes independent from its optional account and billing service. Production accounts and Stripe subscriptions use Supabase Auth, Postgres Row Level Security, and Edge Functions.

## 1. Supabase

1. Create separate staging and production Supabase projects.
2. Apply every migration in `supabase/migrations` in filename order with the Supabase CLI.
3. In Google Auth Platform, create a Web application OAuth client for each environment. Add the Supabase callback and the exact `https://<extension-id>.chromiumapp.org/` callback as authorized redirect URIs.
4. Put the public Web client ID and the `openid`, `email`, and `profile` scopes in the extension manifest's `oauth2` section. Keep its secret only in Supabase.
5. Enable Google Auth in Supabase with the same Web client ID and secret.
6. Copy `.env.example` to `.env.local` and set the project URL and publishable key. These values are public client configuration; never put a Supabase secret key in a Vite variable. Set `VITE_ALLOW_FREE_SYNC=true` only in staging while validating sync; production should leave it false so cloud sync follows the Pro entitlement.

## 2. Stripe test mode

Create a Workpad Pro Product with a recurring GBP Price of **£1.99 per month** (199 pence). Use tax-inclusive pricing if Workpad is required to collect VAT so the displayed customer price remains accurate. Put that Price ID in `STRIPE_PRO_PRICE_ID`. Configure the Customer Portal with cancellation, payment-method updates and invoice history. The extension deliberately keeps the display price in `src/config/pricing.ts`; update it whenever the Stripe Price changes.

Set Edge Function secrets using the Supabase secret manager:

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRO_PRICE_ID
WORKPAD_BILLING_RETURN_URL
```

Never commit these values. Deploy `create-checkout`, `customer-portal`, `delete-account`, `stripe-webhook`, and `billing-return`. During development, set `WORKPAD_BILLING_RETURN_URL` to the Supabase `billing-return` URL. For launch, switch it to the HTTPS URL hosting `docs/billing.html` after that page is live. Register the webhook URL:

```text
https://<project-ref>.supabase.co/functions/v1/stripe-webhook
```

Subscribe only to:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

Run successful payment, failed payment, cancellation, duplicate webhook and refund acceptance tests in Stripe test mode before creating live objects.

The production build must use `VITE_ALLOW_FREE_SYNC=false`. That makes Workpad Cloud sync available only while Supabase reports an active or trialing Pro subscription. Staging may temporarily bypass this gate and labels that state as a development preview.

## 3. Build and release

```bash
npm ci
npm run lint
npm test
npm run build
npm run validate:release
npm run validate:production
```

Use a stable Chrome Web Store extension ID before allowlisting the OAuth callback. CI uploads the unpacked `dist` artifact. Package the contents of `dist`, not the directory itself.

Configure repository secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. A `v<package-version>` tag runs the full release gate and publishes the store-ready ZIP as a GitHub release asset. The tag is rejected if it does not match `package.json` and the Chrome manifests.

## 4. Launch gates

- Dependency audit has no high-severity production findings.
- Privacy policy and Limited Use disclosure are hosted on a stable HTTPS domain.
- Terms, refund policy, support contact, account deletion and data-export routes are live.
- Account deletion has been tested against a Stripe test subscription and confirms that the Stripe customer, Supabase user, cloud notes, and billing rows are removed.
- Real Chrome tests cover permissions, navigation, offline mode, sign-in, Checkout, Customer Portal and subscription revocation.
- Cloud-sync tests cover first merge, simultaneous edits, offline retry, deletion propagation, account switching and the opt-in boundary.
- Error monitoring scrubs URLs, page content, note content, API keys and authentication tokens.
- Live Stripe and Supabase secrets are stored only in their secret managers.

The current paid foundation is BYOK: users supply their own OpenAI key. A managed-AI tier requires a separate authenticated server-side OpenAI proxy, quota enforcement and usage accounting before launch.
