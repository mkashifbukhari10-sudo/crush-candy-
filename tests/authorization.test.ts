import { describe, expect, it } from "vitest";

import { requireCustomerResourceOwner, requireDriverResourceOwner, assertInternalJobSecret } from "../app/auth/authorization.server";
import type { CustomerAuthContext } from "../app/auth/customer.server";
import type { DriverAuthContext } from "../app/services/driver/auth.server";

const customer = { plane: "customer", shop: "shop.myshopify.com", shopifyCustomerId: "gid://shopify/Customer/1", admin: {} } as CustomerAuthContext;
const driver = { plane: "driver", accountId: "account-1", driverId: "driver-1", sessionId: "session-1", email: "driver@example.com", displayName: "Driver" } as DriverAuthContext;

describe("M3 authorization boundaries", () => {
  it("binds customer resources to the authenticated Shopify customer", () => {
    expect(requireCustomerResourceOwner(customer, customer.shopifyCustomerId)).toBe(customer.shopifyCustomerId);
    expect(() => requireCustomerResourceOwner(customer, "gid://shopify/Customer/2")).toThrow();
  });

  it("binds driver resources to the authenticated session and returns 404 on mismatch", async () => {
    expect(requireDriverResourceOwner(driver, driver.driverId)).toBe(driver.driverId);
    try { requireDriverResourceOwner(driver, "driver-2"); throw new Error("expected 404"); } catch (error) { expect(error).toBeInstanceOf(Response); expect((error as Response).status).toBe(404); }
  });

  it("fails closed for missing, wrong-length, and wrong internal secrets", () => {
    const request = (secret?: string) => new Request("https://integration.invalid/internal", secret ? { headers: { "x-ccs-internal-secret": secret } } : undefined);
    expect(() => assertInternalJobSecret(request("secret"), undefined)).toThrow();
    expect(() => assertInternalJobSecret(request("wrong"), "expected-secret")).toThrow();
    expect(() => assertInternalJobSecret(request("expected-secret"), "expected-secret")).not.toThrow();
  });
});
