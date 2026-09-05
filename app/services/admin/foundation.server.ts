import { requireAdmin } from "../../auth/admin.server";
import { getSafeRuntimeSummary } from "../../config/env.server";
import { checkDatabaseHealth } from "../../db/health.server";
import { logger } from "../../lib/logger.server";
import { getRequestId } from "../../lib/request-context.server";
import db from "../../db/client.server";

export async function getFoundationStatus(request: Request) {
  const requestId = getRequestId(request);
  const { session } = await requireAdmin(request);
  const database = await checkDatabaseHealth(requestId);
  const runtime = getSafeRuntimeSummary();
  const [activeDrivers, pendingOrders, scheduledDeliveries, openTickets, activeConversations, activeAccessCodes] = database.connected
    ? await Promise.all([
        db.driver.count({ where: { account: { status: "ACTIVE" } } }),
        db.assignment.count({ where: { status: { in: ["PENDING", "ASSIGNED"] } } }),
        db.assignment.count({ where: { status: "SCHEDULED" } }),
        db.supportTicket.count({ where: { status: "OPEN" } }),
        db.conversation.count({ where: { status: "OPEN" } }),
        db.accessCode.count({ where: { status: "ACTIVE" } }),
      ])
    : [0, 0, 0, 0, 0, 0];

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
    metrics: { activeDrivers, pendingOrders, scheduledDeliveries, openTickets, activeConversations, activeAccessCodes },
  } as const;
}
