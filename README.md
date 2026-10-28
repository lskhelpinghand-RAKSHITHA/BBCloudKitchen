# BBCloudKitchen

A responsive storefront for BB Cloud Kitchen, a goat bone soup specialist in
Mancherial, Telangana.

## Run locally

Use Node.js 22.5 or newer (the app uses Node's built-in SQLite support).

```bash
npm install
npm run dev
```

Open the local URL printed by Next.js, usually `http://localhost:3000`. Run
`npm run typecheck`, `npm test`, and `npm run build` to validate the application.

## Staff dashboard and database

- Open `/admin/login` to reach the staff sign-in page. There is no public
  registration route.
- Staff passwords are stored as scrypt hashes. Login sessions use random,
  HTTP-only, same-site cookies; sessions expire after 12 hours, and repeated
  failed sign-ins are rate-limited.
- Every dashboard mutation checks the authenticated staff session in its
  server action. Product, business-setting, order, session, payment-event, and
  idempotency records are stored in SQLite rather than browser storage or
  process memory.
- Local development defaults to `data/bb-cloud-kitchen.sqlite`. Production
  requires `DATABASE_PATH` to reference a durable mounted volume. Back up the
  database and keep its directory private. The current SQLite setup is for a
  single application instance with durable local storage; do not point multiple
  independent serverless instances at ephemeral disks.
- Configure the database path before creating the first staff account. On
  PowerShell, securely prompt for the initial credentials and run the
  one-time setup command:

  ```powershell
  $env:DATABASE_PATH = "D:\bb-cloud-kitchen-data\bb-cloud-kitchen.sqlite"
  $env:ADMIN_EMAIL = Read-Host "Administrator email"
  $securePassword = Read-Host "Administrator password" -AsSecureString
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try {
    $env:ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    npm run admin:setup
  } finally {
    Remove-Item Env:ADMIN_PASSWORD
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  ```

  Choose a unique password with at least 14 characters, including uppercase,
  lowercase, a number, and a symbol. The setup script can only create the first
  administrator and never prints or stores the password in plaintext. Keep
  `DATABASE_PATH` pointed at that same database when starting the app. Do not
  commit database files or credentials.

## Checkout and order tracking

- Checkout is development-only and is permanently restricted to Razorpay
  **Test Mode** credentials in this implementation. It does not contact the
  kitchen, arrange pickup or delivery, or create a real customer order.
- Razorpay Standard Checkout is the recommended gateway for this India-focused
  storefront, subject to Razorpay's current business eligibility rules, KYC,
  underwriting, account approval, and activation. No gateway account or live
  payment capability is claimed to be configured.
- The server creates a Razorpay order from its own current quote in INR paise.
  Razorpay receives the amount and internal order reference; secret credentials
  are used only by server routes and are never prefixed with `NEXT_PUBLIC_`.
  Customers enter card/payment details in Razorpay Checkout; BB Cloud Kitchen
  does not receive or store raw card details.
- The browser success callback is not authoritative. The server validates the
  checkout signature and independently fetches the payment from Razorpay before
  marking it paid. Signed webhooks are verified against the raw request body;
  captured, failed, authorized, refund-created, refund-processed and
  refund-failed events are handled, including partial refund status. Repeated
  event IDs are ignored within the running process.
- A payment retry reuses the same BB order and Razorpay order. A tracking token
  is required for status, verification, cancellation, and retry operations.
- Orders, menu, business settings, staff sessions, payment-event
  idempotency, and checkout idempotency now persist in SQLite. Admin order
  details (including customer phone and delivery address) are only rendered
  after staff authentication. Customer tracking links require the original
  high-entropy token; knowing an order ID alone is insufficient.
- The dashboard shows test/sandbox orders and payment references only. It does
  not expose gateway secrets, and it does not enable live payments.
- Development test business settings live in `src/data/business.ts`. They
  intentionally enable pickup and mark the test kitchen open so the flow can be
  exercised. These are not real operating hours or confirmation of pickup
  availability. Test taxes and discounts are explicitly configured to zero;
  they are not real tax or promotion settings.
- Delivery is disabled until owner-approved Mancherial zones and a fee are
  entered in that configuration. No delivery area, fee, minimum, hours, or
  timing is assumed. Production checkout remains disabled until real business
  settings and persistent order storage are implemented.
- The server recalculates every quote and order from the current menu and
  configuration. Browser-provided prices and totals are not used. Order
  submissions require an idempotency key, and tracking links use a
  high-entropy secret token.
- Checkout remains disabled for production customer orders. The durable
  database is a foundation for staff operations and local test-order tracking;
  it is not a substitute for production payment reconciliation, backups,
  retention policies, privacy terms, or owner-approved fulfillment settings.

## Supabase PostgreSQL schema provisioning

The Supabase migration defines relational tables for menu products, portions,
availability, customers and delivery addresses, orders and line items,
payments/refunds/webhook events, fulfillment, promotions/coupons, business
configuration, and administrator authorization. Customer, address, order,
payment, and staff data have row-level security enabled. Anonymous clients are
denied customer-record access; authenticated dashboard access is limited to
users listed in `authorized_administrators`. Database credentials are only
used by the migration/verification scripts and must never be exposed to the
browser.

**Important runtime boundary:** the current Next.js application still uses its
existing SQLite adapter (`DATABASE_PATH`) for menu, staff sessions, settings,
orders, and payment-event handling. `DATABASE_URL` is used only by the
Supabase migration, seed, and verification commands below; setting it does not
switch application traffic to PostgreSQL. Do not consider the application
connected to Supabase or deploy it against Supabase as its order database until
the application data-access layer has been migrated and verified end to end.
Checkout remains test-only, and the migration does not enable live payments.

To provision and verify the schema in your own Supabase development project:

1. Create a Supabase project in your own organization. Save the database
   password in your password manager. Use a separate Supabase project for
   development and production; do not seed production.
2. In **Project Settings → Database → Connection string**, copy the
   PostgreSQL **Session pooler** connection string (or the direct connection
   string if your host supports its network requirements). Keep SSL enabled.
   Do not use the Supabase `service_role` API key as a database password.
3. In PowerShell, set the connection string only in the current terminal
   session; do not put it in `.env.example`, source control, or chat:

   ```powershell
   $env:DATABASE_URL = Read-Host "Supabase development PostgreSQL connection string"
   npm run db:migrate
   npm run db:verify
   ```

   The migration command applies versioned files under `supabase/migrations/`
   transactionally and records them in the private `bb_internal` schema. The
   verification command checks connectivity, required tables, RLS activation,
   anonymous customer-data denial, and the unauthenticated `authenticated` role
   policy result. Do not treat a successful `SELECT 1` alone as sufficient.
4. For a development database only, load clearly marked demo records:

   ```powershell
   $env:APP_ENV = "development"
   npm run db:seed
   Remove-Item Env:APP_ENV
   ```

   The seed script and SQL both refuse to seed unless development is explicit.
   Demo menu items have `is_demo=true`; no sample customers, orders, payments,
   or real administrator accounts are inserted.
5. Create the intended administrator through **Supabase Authentication** in
   that project's dashboard, then add that authenticated user's UUID to
   `public.authorized_administrators` using the Supabase SQL Editor as the
   project owner. Verify that only intended staff accounts are active. This
   RLS allowlist is separate from the current SQLite `/admin/login` account.
6. Run `npm run db:verify` again after provisioning and retain the output
   privately. Never share the connection string or production credentials.
   Apply the migration and verification independently in a production project
   only after reviewing the schema and setting up backups; never run
   `db:seed` against production.
7. Before switching application traffic to Supabase, migrate the application
   reads/writes to these tables, use authenticated server-only database access,
   and test order-creation transactions, webhook retries, admin authorization,
   and customer-record RLS with both authorized and unauthorized identities.
   The current app has not completed that runtime switch.

## Razorpay sandbox setup

1. Confirm that your business and intended food-service category are eligible
   under Razorpay's current India onboarding and prohibited/restricted business
   policies. Complete its business KYC and obtain account approval. Eligibility
   and activation are decided by Razorpay, not by this application.
2. In the Razorpay Dashboard, switch to **Test Mode** and obtain the Test Mode
   Key ID and Key Secret. Never copy live credentials into this app.
3. Copy `.env.example` to `.env.local` in the project root and set:

   ```dotenv
   RAZORPAY_MODE=test
   RAZORPAY_KEY_ID=rzp_test_<your-test-key-id>
   RAZORPAY_KEY_SECRET=<your-test-key-secret>
   RAZORPAY_WEBHOOK_SECRET=<the-webhook-secret-you-configure-below>
   ```

   Replace the placeholders with values from your own account. Do not commit
   `.env.local`, send secrets in chat, or use `NEXT_PUBLIC_` for any of these
   values. Restart `npm run dev` after changing environment variables. The
   server rejects a Key ID that is not prefixed `rzp_test_`; live payment mode
   is not implemented.
4. Run `npm install` if needed, then `npm run dev`. Open the local URL and
   confirm checkout identifies itself as a sandbox/test flow. Orders cannot be
   submitted until all four variables are present.
5. Complete a sandbox order with the test payment method details listed in
   Razorpay's official [Test Mode guide](https://razorpay.com/docs/payments/payments/test-mode/).
   Verify that the result page reports a server-verified status. Try a failed
   test method, close the checkout modal, and retry from the same order page;
   confirm the order ID stays the same. No real funds should move.
6. In the Razorpay Dashboard's **Test Mode → Webhooks** settings, add the
   publicly reachable HTTPS URL `https://<your-host>/api/payments/webhook`.
   For local testing, expose the local development server through a secure
   temporary HTTPS tunnel and use that tunnel URL; never configure a production
   live-mode webhook for this test-only app. Generate a strong webhook secret,
   set that exact value as `RAZORPAY_WEBHOOK_SECRET`, then restart the app.
7. Subscribe to `payment.authorized`, `payment.captured`, `payment.failed`,
   `refund.created`, `refund.processed`, and `refund.failed`. Save the webhook
   configuration, send a test event from the dashboard, and verify it receives
   HTTP 200. The endpoint checks `X-Razorpay-Signature` against the raw body and
   uses `x-razorpay-event-id` for duplicate-event handling.

Useful official references:

- [Razorpay Standard Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/)
- [Create an order API](https://razorpay.com/docs/api/orders/create/)
- [Webhook signature validation](https://razorpay.com/docs/webhooks/validate-test/)
- [Razorpay account activation](https://razorpay.com/docs/onboarding/account-activation/)

## Before any live-payment activation

Live mode is intentionally unavailable and must remain disabled until the owner
explicitly approves a separate production launch. Approval alone is not enough:

- Obtain Razorpay approval and production credentials after required Indian
  business KYC, bank-account verification, and payment-method activation.
- Implement durable payment-attempt and refund reconciliation, plus recovery
  for provider timeouts and concurrent deployments. Current payment operations
  remain a sandbox integration.
- Review production hosting, persistent-volume backups, retention, privacy,
  monitoring, HTTPS, and access controls for the SQLite deployment model.
- Configure HTTPS, production webhook secrets, monitoring, backups, retention,
  access controls, and incident/refund reconciliation procedures.
- Approve real menu/pricing, taxes, fulfillment zones/hours, privacy and refund
  policies, and customer support details. Run and document end-to-end test-mode
  acceptance before requesting production activation.
- Only after explicit owner approval should a separate reviewed change add
  server-only live credentials and production safeguards. Do not change
  `RAZORPAY_MODE` to `live` in this version; it only accepts `test`.

- The menu data and async database-integration boundary are in
  `src/data/menu.ts`. Every listing there is a clearly marked demo goat bone
  soup; replace the sample products, portions in ml, and prices in paise with
  owner-approved information before launch.
- Ingredients, preparation estimates, spice levels, customizations, and add-ons
  are not invented. Add confirmed values to the central menu data; only add
  customizations or add-ons after owner approval. Vegetarian status is not
  collected or displayed.
- Replace the illustrative demo food image with approved product photography.
  Demo availability and prices are examples, not live kitchen information.
- Add confirmed contact information, opening hours, delivery and pickup
  availability, and approved policy text before publishing them.
