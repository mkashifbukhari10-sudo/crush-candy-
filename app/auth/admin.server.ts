import { authenticate } from "../shopify.server";

// Admin requests are authenticated only by Shopify's official session-token
// verifier. No client-supplied identity or role value is accepted here.
export async function requireAdmin(request: Request) {
  return authenticate.admin(request);
}

