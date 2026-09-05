# Crush Candy Supplies — M8 launch readiness

## Deployment

1. Push the reviewed commit to `main`; Railway builds the existing Docker image.
2. Railway runs `prisma migrate deploy` before starting the React Router server.
3. Required environment variable names are documented in `.env.example`; secrets are supplied only through Railway/Shopify configuration.
4. Verify the production URL and run the smoke requests below.

For a rollback, redeploy the previous known-good commit. Migrations are additive; do not edit or delete historical migration files. Restore application code first, then investigate any migration issue before changing the database.

## Shopify and admin setup

- Validate `shopify.app.toml` before any app configuration deploy.
- Confirm the Railway application URL, OAuth redirects, App Proxy, webhooks, and least-privilege scopes in the Shopify Dev Dashboard.
- Create the first driver from the embedded Admin app, deliver the activation invite securely, and verify activation/password reset/logout-everywhere.
- Create customer access codes in Admin and deliver each code out-of-band; codes are displayed once and stored hashed.
- Manage customer/driver announcements and support requests from the Admin inbox.
- Public Q&A is Shopify-native Metaobject content; define/publish the merchant's `faq_entry` entries in Shopify Content.

## Required environment variable names

`DATABASE_URL`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `ACCESS_CODE_HASH_SECRET`, `CUSTOMER_CSRF_SECRET`, `DRIVER_CSRF_SECRET`, `DRIVER_SESSION_COOKIE_NAME`, `DRIVER_IDLE_TIMEOUT_MINUTES`, `DRIVER_ABSOLUTE_TIMEOUT_HOURS`, `APPROVAL_RECONCILIATION_SECRET`, `DELIVERY_ORIGIN_LATITUDE`, `DELIVERY_ORIGIN_LONGITUDE`, `DELIVERY_DISTANCE_METHOD`, and `DELIVERY_KM_ROUNDING`.

Never commit or print values for these variables.

## Smoke tests

- `GET /` returns 200 and the current milestone marker.
- Unauthenticated `/app/*` and `/driver/*` requests fail closed or redirect to login.
- Unauthenticated `/api/carrier/rates` returns 401/no rates.
- A real approved customer can open the App Proxy portal, delivery status, announcements, chat, and Help/support.
- A deactivated driver cannot access Upcoming, Chat, or Notices.
- Admin can read a customer-driver chat and the audit log records `CHAT_READ_BY_ADMIN`.
- Duplicate order/webhook deliveries do not create duplicates.
- Support submission displays “responses may take up to 24 hours”; it does not claim live 24/7 staffing.

## Blocking before public launch

- Merchant completes real Shopify customer login/approval and first-driver activation QA.
- Merchant verifies production payment gateway and checkout policy.
- Merchant verifies production Carrier Service eligibility/profile attachment or accepts the documented postcode fallback.
- Client confirms distance method, >55 km rounding, chat retention, and large-quantity pickup/address disclosure policy.
- Merchant publishes required Shopify Q&A Metaobjects and confirms catalogue/legal compliance.

## Non-blocking / post-launch

- M6 distance-provider credentials and Carrier Service activation if still using the fallback.
- M8 load/E2E testing against production-scale data and operational training refresh.
- Retention automation only after the client supplies retention policy.

## Incident basics

Use the request ID from response headers and Railway logs for triage. Never include passwords, codes, tokens, secrets, full addresses, or unnecessary customer PII in tickets/logs. Disable a compromised driver account and revoke all sessions; revoke leaked access codes in Admin; if Shopify credentials are suspected, rotate them in the Shopify dashboard and Railway immediately.
