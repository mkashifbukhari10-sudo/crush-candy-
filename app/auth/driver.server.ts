import { PlaneUnavailableError } from "../lib/errors.server";

export interface DriverAuthContext {
  readonly plane: "driver";
  readonly accountId: string;
  readonly driverId: string;
  readonly sessionId: string;
}

// DEFERRED TO M2: app-owned driver sessions will be verified here. This module
// never imports Shopify customer or admin authentication and fails closed until
// the driver authentication milestone is implemented.
export async function requireDriver(request: Request): Promise<DriverAuthContext> {
  void request;
  throw new PlaneUnavailableError("driver", "M2");
}

