import { timingSafeEqual } from "node:crypto";

import { CustomerAuthorizationError } from "../lib/errors.server";
import type { CustomerAuthContext } from "./customer.server";
import type { DriverAuthContext } from "../services/driver/auth.server";

/** Customer resource ownership is always the signed App Proxy identity. */
export function requireCustomerResourceOwner(
  context: CustomerAuthContext,
  resourceCustomerId: string,
): string {
  if (context.shopifyCustomerId !== resourceCustomerId) {
    throw new CustomerAuthorizationError();
  }
  return context.shopifyCustomerId;
}

/** Driver resources use 404 to avoid confirming another driver's resource exists. */
export function requireDriverResourceOwner(
  context: DriverAuthContext,
  resourceDriverId: string,
): string {
  if (context.driverId !== resourceDriverId) {
    throw new Response("Not found", { status: 404 });
  }
  return context.driverId;
}

export function assertInternalJobSecret(
  request: Request,
  expectedSecret: string | undefined,
): void {
  const supplied = request.headers.get("x-ccs-internal-secret");
  if (!expectedSecret || !supplied) throw new Response("Not found", { status: 404 });
  const suppliedBytes = Buffer.from(supplied, "utf8");
  const expectedBytes = Buffer.from(expectedSecret, "utf8");
  if (
    suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    throw new Response("Not found", { status: 404 });
  }
}
