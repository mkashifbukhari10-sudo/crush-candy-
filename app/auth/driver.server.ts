// Driver authentication is deliberately app-owned and never imports Shopify
// customer or Admin authentication. The implementation lives in its own
// service boundary and uses only opaque, server-side sessions.
export {
  requireDriver,
  loginDriver,
  logoutDriver,
  type DriverAuthContext,
} from "../services/driver/auth.server";
