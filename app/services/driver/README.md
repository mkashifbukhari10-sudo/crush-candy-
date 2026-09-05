# Driver service boundary

Driver-plane services belong here and may receive identity only from
`app/auth/driver.server.ts`. They must not import Shopify customer or admin
authentication.

The standalone driver login, activation, reset, and portal shell are M2
surfaces. Operational delivery features remain deferred to later milestones.
