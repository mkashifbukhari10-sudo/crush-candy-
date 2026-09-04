import { PlaneUnavailableError } from "../lib/errors.server";

export interface CustomerAuthContext {
  readonly plane: "customer";
  readonly shop: string;
  readonly shopifyCustomerId: string;
}

// DEFERRED TO M1: this will verify the App Proxy signature and derive the
// Shopify customer id server-side. It intentionally cannot use admin or driver
// sessions and fails closed until that implementation exists.
export async function requireCustomer(request: Request): Promise<CustomerAuthContext> {
  void request;
  throw new PlaneUnavailableError("customer", "M1");
}

