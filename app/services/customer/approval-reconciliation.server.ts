import db from "../../db.server";
import { logger } from "../../lib/logger.server";
import { unauthenticated } from "../../shopify.server";
import { reconcileCustomerApproval } from "./approval.server";
import { readApprovedCustomerTag } from "./shopify-customer.server";

const RECONCILIATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 5 * 60 * 1000;
const BATCH_SIZE = 500;

const schedulerGlobal = globalThis as typeof globalThis & {
  ccsApprovalReconciliationTimer?: ReturnType<typeof setTimeout>;
};

export async function reconcileStaleCustomerApprovals(): Promise<number> {
  await db.rateLimitBucket.deleteMany({
    where: { resetAt: { lt: new Date(Date.now() - RECONCILIATION_INTERVAL_MS) } },
  });
  const offlineSession = await db.session.findFirst({
    where: { isOnline: false, accessToken: { not: "" } },
    orderBy: { id: "asc" },
  });
  if (!offlineSession) return 0;

  const { admin } = await unauthenticated.admin(offlineSession.shop);
  const staleBefore = new Date(Date.now() - RECONCILIATION_INTERVAL_MS);
  const profiles = await db.customerProfile.findMany({
    where: {
      OR: [
        { lastShopifyTagObservedAt: null },
        { lastShopifyTagObservedAt: { lt: staleBefore } },
      ],
    },
    orderBy: { id: "asc" },
    take: BATCH_SIZE,
    select: { shopifyCustomerId: true },
  });

  let reconciled = 0;
  for (const profile of profiles) {
    try {
      const approved = await readApprovedCustomerTag(
        admin,
        profile.shopifyCustomerId,
      );
      await reconcileCustomerApproval(profile.shopifyCustomerId, approved, {
        actorId: "nightly-approval-reconciliation",
        actorPlane: "SYSTEM",
      });
      reconciled += 1;
    } catch (error) {
      logger.warn("customer.approval_reconciliation_item_failed", {
        error,
      });
    }
  }

  logger.info("customer.approval_reconciliation_completed", { reconciled });
  return reconciled;
}

export function startApprovalReconciliationScheduler(): void {
  if (
    process.env.NODE_ENV !== "production" ||
    schedulerGlobal.ccsApprovalReconciliationTimer
  ) {
    return;
  }

  const runAndReschedule = async () => {
    try {
      await reconcileStaleCustomerApprovals();
    } catch (error) {
      logger.error("customer.approval_reconciliation_failed", { error });
    } finally {
      schedulerGlobal.ccsApprovalReconciliationTimer = setTimeout(
        runAndReschedule,
        RECONCILIATION_INTERVAL_MS,
      );
      schedulerGlobal.ccsApprovalReconciliationTimer.unref?.();
    }
  };

  schedulerGlobal.ccsApprovalReconciliationTimer = setTimeout(
    runAndReschedule,
    INITIAL_DELAY_MS,
  );
  schedulerGlobal.ccsApprovalReconciliationTimer.unref?.();
}
