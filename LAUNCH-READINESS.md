# Crush Candy Supplies — final pre-launch closure

## A. DEVELOPMENT COMPLETE

- M0–M8 application code, Prisma schema/migrations, CI, Railway deployment, and Neon migrations are complete.
- App-side delivery tiers and the AUD $250 minimum are implemented. Production pricing requires actual driving/road distance and rounds additional distance above 55 km up; the signed Carrier Service callback fails closed when provider configuration is unavailable.
- Shopify-native `faq_entry` Metaobjects remain the public Q&A source; no duplicate FAQ database exists.
- Customer and driver announcements, guided help, support tickets, dispatch, chat, and compliance redaction are implemented.
- The architecture-approved M6 fallback is **postcode-based delivery zones configured in a Shopify shipping profile** (§8.6). The app does not create or manage those Shopify zones; merchant configuration is still required.

## B. BLOCKING BEFORE PUBLIC LAUNCH

- Production payment gateway and website-checkout behavior verified.
- Production Carrier Service eligibility decided. If eligible, Carrier Service is registered and attached to the correct shipping profile; otherwise the merchant explicitly configures/accepts the §8.6 postcode-zone fallback.
- Driving-distance provider and credentials configured.
- Chat retention policy confirmed.
- Required Shopify FAQ Metaobjects published and storefront visibility verified.
- Any Shopify scope reauthorization completed.
- Storefront password/access state verified and real-store end-to-end QA completed.

## C. CLIENT DECISIONS REQUIRED

| Decision | Current safe behavior | After confirmation |
|---|---|---|
| Chat retention duration | Chat is hidden from customer/driver after delivery and history remains Admin-readable; no deletion job runs | Configure any future retention/deletion policy |
| Payment gateway/policy | Website checkout only; gateway remains merchant-configured | Activate and verify the approved production gateway/payment methods |

## D. MERCHANT / PROVIDER ACTIONS

- Activate/test the production payment gateway.
- Provide the production store domain and verify Carrier Service eligibility.
- If eligible, approve `write_shipping` if required, register the service, and attach it to the appropriate shipping profile.
- If not eligible, configure the documented Shopify postcode-zone fallback and AUD $250 minimum condition in the shipping profile; do not represent this as exact distance pricing.
- Supply/configure driving-distance provider credentials and server-side origin/pickup address configuration.
- Approve any required Shopify scope reauthorization.
- Define/publish `faq_entry` Metaobjects in Shopify Content.
- Set storefront password/access state as intended for launch.
- Activate the first Driver account securely.

## E. REAL-STORE QA (ORDERED)

1. Logged-out visitor sees the private-store gate; no normal catalogue/cart access is available.
2. Unapproved customer is blocked; redeeming a valid access code grants approval.
3. Returning approved customer logs in without another code.
4. Approved customer can browse, add to cart, meet the AUD $250 minimum, and complete website checkout.
5. New order syncs once; Admin sees it, assigns an active Driver, and schedules it.
6. Default assignment is verified if enabled; customer status and Driver Upcoming update.
7. Customer and assigned Driver exchange chat messages; unread state is independent.
8. Admin searches/reads the conversation; `CHAT_READ_BY_ADMIN` is present and Admin is not a participant.
9. Reassign Driver A → B; A loses access immediately, B gains access, and history remains; after delivery completion both customer and drivers lose chat access while Admin retains it.
10. Customer announcement appears only to customers; Driver notice appears only to active Drivers.
11. Customer walks guided help, submits a support request, and Admin replies/changes status; customer sees the response.
12. Verify the 5 kg pickup flow and authorized address disclosure; address is not available publicly or to unrelated customers.
13. Verify driving-distance Carrier Service checkout rate if enabled, or verify the configured postcode-zone fallback and its minimum-order behavior.
14. Attempt customer-A/customer-B and driver-A/driver-B resource access; all unauthorized requests fail closed.

## F. NON-BLOCKING POST-LAUNCH ITEMS

- Toolchain dependency upgrades when compatible non-breaking fixes are available.
- Carrier Service activation if the fallback is initially used.
- Retention automation after policy confirmation.
- Broader production-scale load testing and refresher training.

## G. ROLLBACK / INCIDENT BASICS

Redeploy the previous known-good Git commit through Railway. Migrations are additive; never edit historical migration files. Use response `x-request-id` values with Railway logs. Revoke compromised access codes, deactivate compromised Drivers and revoke all sessions, and rotate Shopify/Railway/provider credentials through their respective dashboards. Never place secrets, tokens, passwords, access codes, full addresses, or unnecessary customer PII in logs or tickets.
