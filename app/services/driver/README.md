# Driver service boundary

Driver-plane services belong here and may receive identity only from
`app/auth/driver.server.ts`. They must not import Shopify customer or admin
authentication.

`DEFERRED TO M2`: no driver credentials, sessions, login UI, or portal exists
in Milestone 0.

