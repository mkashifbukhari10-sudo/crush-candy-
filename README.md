# Crush Candy Supplies — Phase 2 App

This is the custom, single-merchant Shopify app described by
`../PHASE2-ARCHITECTURE-PLAN.md`. The architecture plan is locked.

Current implementation: **Milestone 4 — dispatch core**. M4 adds Shopify order synchronization, operational assignments, scheduling, driver Upcoming work, and approved-customer delivery status. Chat, commerce rules, content/support, and launch hardening remain intentionally unimplemented.

## Runtime stack

- Shopify's official React Router app template (React Router 7)
- Embedded Shopify Admin UI using App Bridge and Polaris web components
- Prisma 6 with PostgreSQL
- Shopify session storage using `@shopify/shopify-app-session-storage-prisma`
- Node.js `>=20.19 <22` or `>=22.12` (Node 22 LTS recommended)
- npm `>=10`; `package-lock.json` is authoritative

Use Node 22 LTS for local work and CI. The locally detected Node 26 runtime is
accepted by the template's broad engine range, but Shopify CLI failed under it
during the M0 audit; use 22.12+ for a known-good toolchain.

## Local development

Prerequisites:

1. A supported Node.js version and npm.
2. Shopify CLI installed and authenticated.
3. Access to the linked `Crush Candy Supplies` Dev Dashboard app and its
   development store.
4. A PostgreSQL database. SQLite is no longer an app runtime option.

Setup from this directory:

```powershell
Copy-Item .env.example .env
npm ci
npm run db:generate
npm run db:migrate:deploy
shopify app dev
```

Replace every placeholder in `.env` before starting. Never commit `.env` or
copy secrets into source, TOML, logs, issue comments, or screenshots. Shopify
CLI supplies its app variables during `shopify app dev`; production hosting
must supply the same variables through its secret manager.

Useful checks:

```powershell
shopify app config validate --json
npm run db:validate
npm run db:generate
npm run typecheck
npm run lint
npm run build
```

Vitest covers M1/M2 security primitives. The opt-in database integration suite exercises the real PostgreSQL customer claim/finalize and driver-auth lifecycles without calling Shopify:

```powershell
$env:RUN_DATABASE_TESTS='1'
npm run test:integration
```

## Environment strategy

`app/config/env.server.ts` is the only application-level environment parser.
It validates required runtime values and returns only a deliberately safe
summary to the UI. Server-only modules must never be imported into browser code.

Required now:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection used by Prisma and Shopify session storage |
| `SHOPIFY_API_KEY` | Shopify app client ID; safe to pass to App Bridge |
| `SHOPIFY_API_SECRET` | OAuth, webhook, and Shopify signature verification secret |
| `SHOPIFY_APP_URL` | Current public HTTPS origin; dynamically supplied during CLI development |
| `SCOPES` | Comma-separated Shopify scopes; M1 uses only `write_customers,write_app_proxy` |

M1 key-separation overrides:

- `ACCESS_CODE_HASH_SECRET` — keyed access-code and private-identifier hashes
- `CUSTOMER_CSRF_SECRET` — short-lived App Proxy form tokens

Both should be independent 32+ character production secrets. If absent, the
runtime derives domain-separated keys from `SHOPIFY_API_SECRET`; no derived key
is persisted or logged.

Reserved and validated only when configured:

- `DRIVER_CSRF_SECRET` and `DRIVER_*` session settings — active for M2; use independent production values
- `SHOPIFY_STORE_DOMAIN` — expected canonical single-store domain when enforced
- `SHOP_CUSTOM_DOMAIN` — optional custom shop-domain adapter support
- `EMAIL_*` — `DEFERRED TO M4`
- `OBJECT_STORAGE_*` — `DEFERRED TO M4`
- `DISTANCE_*` — `DEFERRED TO M6`

The provider placeholders record integration boundaries only. They are not
provider selections and do not resolve any open client decision.

## Database and migrations

The generated SQLite schema was replaced at M0. The PostgreSQL baseline keeps
the `Session` table required by Shopify's Prisma session adapter unchanged. M1
adds customer access sidecars, and M2 adds `DriverAccount`, `Driver`,
`DriverSession`, and `DriverAuthEvent` without duplicating Shopify identity.

The ignored `prisma/dev.sqlite` file can be retained temporarily as a local
backup, but it is not read by the app. Existing development sessions are not
portable between database engines; after provisioning PostgreSQL and applying
the migration, reopening the embedded app will create a fresh Shopify session.

Migration workflow:

```powershell
# After an intentional schema change during development
npm run db:migrate:dev -- --name <descriptive_name>

# In CI/hosting against an already-provisioned database
npm run db:migrate:deploy
```

Do not use `prisma db push` for shared or production databases. Every schema
change must have a reviewed migration and must belong to the current milestone.

## Project structure

```text
app/
  auth/                    # one explicit authenticator per trust plane
  config/                  # server environment and safe constants
  db/                      # Prisma client and database health checks
  lib/                     # request IDs, safe errors, logging, rate-limit contract
  models/                  # milestone-owned database boundaries
  routes/                  # React Router filesystem routes
  services/
    admin/                 # Shopify Admin-authenticated services
    customer/              # App Proxy/customer services (M1+)
    driver/                # app-owned driver services (M2+)
    shopify/               # Shopify integration helpers, including webhooks
    audit/                 # persistent audit boundary (M2+)
  utils/                   # shared non-identity utilities and validation
prisma/
  migrations/              # PostgreSQL migrations
  schema.prisma
```

### Trust boundaries

| Plane | Route convention | Identity source | Current state |
|---|---|---|---|
| Admin | `/app/*` (`app*.tsx`) | Official Shopify Admin/session-token verification | Active; status page only |
| Customer | `/apps/portal/*` proxy routes (`apps.portal*.tsx`) | App Proxy signature plus server-derived Shopify customer ID | Active; live `approved` tag check |
| Driver | future `/driver/*` routes (`driver*.tsx`) | App-owned driver session cookie and database session | Fail-closed placeholder; `DEFERRED TO M2` |

The `/app/*` prefix follows the official React Router template while serving
the plan's Admin plane. Each plane has a separate auth module and service
directory. ESLint rejects cross-plane imports in plane routes and services.
There is no generic role parameter, shared plane session, or client-selectable
identity path.

Customer App Proxy form posts use a short-lived HMAC token bound to the signed
shop and customer identity. Shopify Admin, App Proxy, and webhook requests use
Shopify's official verification helpers. M1 access-code rate limits use the
shared PostgreSQL `RateLimitBucket`; driver policies remain deferred to M2.

## Shopify configuration and scope policy

`shopify.app.toml` is embedded, linked to the existing app, and targets Admin
API/webhook version `2026-07`. `app/shopify.server.ts` remains
`AppDistribution.SingleMerchant`, and M1 adds the `/apps/portal` App Proxy.

Scope changes are added only for the milestone that uses them and must be
revalidated against the current API version:

- `write_customers`, `write_app_proxy` — active for M1; write access includes the required customer read
- order, product-read, assigned-fulfilment scopes — `DEFERRED TO M4`
- `write_shipping` — `DEFERRED TO M6`
- any content/metaobject scope — `DEFERRED TO M7` if the current API requires it

Do not add `read_all_orders` unless historical backfill older than 60 days is
explicitly confirmed. Do not add `write_products`, `read_locations`,
`write_locations`, broad fulfilment scopes, or discount scopes speculatively.

`application_url` and the OAuth callback target the existing Railway production
service. CLI development URL updates remain enabled for intentional local use.

## Webhook pattern

App-specific subscriptions in `shopify.app.toml` currently cover:

- `app/uninstalled`
- `app/scopes_update`
- compliance topics: `customers/data_request`, `customers/redact`, `shop/redact`
- M1 customer tag topics: `customer.tags_added`, `customer.tags_removed`

Every route passes the raw `Request` to `handleShopifyWebhook`, which calls
Shopify's official `authenticate.webhook` before handler code runs. Invalid
HMACs retain Shopify's authentication response. Logs contain request ID, shop,
topic, and status only—never headers, cookies, request bodies, or webhook
payloads.

The compliance route removes M1 customer sidecar data and pseudonymizes the
canonical customer identifier in retained audit records. No webhook payload or
customer PII is logged. Order and fulfilment webhooks remain deferred.

## Logging and errors

Server logs are one-line JSON with a timestamp, level, event name, and request
ID. Known secret fields, bearer tokens, and credentials in connection strings
are redacted. Do not log raw request objects, webhook payloads, GraphQL payloads,
chat text, customer PII, access codes, or driver credentials. Client-facing
unexpected errors use a generic message and a correlation ID.

## Dawn boundary

The Phase 1 Dawn theme lives at `../../dawn` in its own Git repository. M1
changes only the layout authorization gate, private-access snippet, robots
template, and predictive-search setting. Phase 1 sections and styling remain
otherwise untouched.

## CI and deployment

`.github/workflows/ci.yml` verifies Prisma, M1 unit tests, TypeScript, ESLint,
and the production build on Node 22.18. Railway runs the existing Dockerfile and
applies reviewed Prisma migrations before starting the React Router server.

## Milestone gates and manual actions

M0 is implemented. Recorded decisions relevant to M1:

- Written acceptance/resolution of plan §2 risks.
- Written answer to §13.12: access control versus true catalogue secrecy.
- Carrier Service eligibility is deferred to M6.
- Protected Customer Data review is not a pre-M1 blocker for this Custom
  distribution setup; M1 stores no direct customer PII.
- Historical order backfill decision recorded; default is no `read_all_orders`.
- Production hosting/database selected and real PostgreSQL `DATABASE_URL`
  provisioned.

These are decisions or external dashboard actions, not values for the codebase
to invent.
#   c r u s h - c a n d y -  
 
