import { requireAdmin } from "../../auth/admin.server";
import { getSafeRuntimeSummary } from "../../config/env.server";
import { checkDatabaseHealth } from "../../db/health.server";
import { logger } from "../../lib/logger.server";
import { getRequestId } from "../../lib/request-context.server";

export async function getFoundationStatus(request: Request) {
  const requestId = getRequestId(request);
  const { session } = await requireAdmin(request);
  const database = await checkDatabaseHealth(requestId);
  const runtime = getSafeRuntimeSummary();

  logger.info("admin.foundation_status_viewed", {
    requestId,
    shop: session.shop,
    databaseConnected: database.connected,
  });

  return {
    appConnected: true,
    databaseConnected: database.connected,
    environment: runtime.environment,
    milestone: runtime.milestone,
  } as const;
}

