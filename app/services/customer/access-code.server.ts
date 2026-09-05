import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

import {
  ACCESS_CODE_CUSTOMER_LIMIT,
  ACCESS_CODE_CUSTOMER_WINDOW_SECONDS,
  ACCESS_CODE_IP_LIMIT,
  ACCESS_CODE_IP_WINDOW_SECONDS,
} from "../../config/constants";
import db from "../../db.server";
import { RateLimitExceededError } from "../../lib/rate-limit.server";
import { appendAuditLog } from "../audit/audit.server";
import {
  hashAccessCode,
  hashPrivateIdentifier,
} from "../../lib/access-code-security.server";
import { customerRateLimiter } from "./rate-limit.server";
import {
  addApprovedCustomerTag,
  readApprovedCustomerTag,
} from "./shopify-customer.server";

export type RedemptionResult =
  | { status: "APPROVED" }
  | { status: "ALREADY_APPROVED" };

export type AccessCodeFailureReason =
  | "INVALID"
  | "EXPIRED"
  | "REVOKED"
  | "USED"
  | "CLAIMED";

export class AccessCodeRedemptionError extends Error {
  readonly reason: AccessCodeFailureReason;

  constructor(reason: AccessCodeFailureReason) {
    super("This access code is invalid or unavailable");
    this.name = "AccessCodeRedemptionError";
    this.reason = reason;
  }
}

interface RedeemAccessCodeInput {
  admin: AdminApiContext;
  code: string;
  ipAddress: string;
  shopifyCustomerId: string;
}

async function enforceRedemptionLimits(
  shopifyCustomerId: string,
  ipAddress: string,
): Promise<string> {
  const customerLimit = await customerRateLimiter.consume(
    "access-code-customer",
    shopifyCustomerId,
    {
      limit: ACCESS_CODE_CUSTOMER_LIMIT,
      windowSeconds: ACCESS_CODE_CUSTOMER_WINDOW_SECONDS,
    },
  );
  if (!customerLimit.allowed) {
    throw new RateLimitExceededError(customerLimit.retryAfterSeconds ?? 60);
  }

  const ipLimit = await customerRateLimiter.consume(
    "access-code-ip",
    ipAddress,
    {
      limit: ACCESS_CODE_IP_LIMIT,
      windowSeconds: ACCESS_CODE_IP_WINDOW_SECONDS,
    },
  );
  if (!ipLimit.allowed) {
    throw new RateLimitExceededError(ipLimit.retryAfterSeconds ?? 60);
  }

  return hashPrivateIdentifier("audit-ip", ipAddress);
}

async function finalizeClaim(
  accessCodeId: string,
  shopifyCustomerId: string,
  ipHash: string,
): Promise<void> {
  await db.$transaction(async (transaction) => {
    const finalized = await transaction.accessCode.updateMany({
      where: {
        id: accessCodeId,
        status: "CLAIMED",
        claimedByCustomerId: shopifyCustomerId,
      },
      data: {
        status: "REDEEMED",
        redeemedAt: new Date(),
        redeemedByCustomerId: shopifyCustomerId,
      },
    });

    if (finalized.count === 0) {
      const existing = await transaction.accessCode.findUnique({
        where: { id: accessCodeId },
      });
      if (
        existing?.status === "REDEEMED" &&
        existing.redeemedByCustomerId === shopifyCustomerId
      ) {
        return;
      }
      throw new AccessCodeRedemptionError("CLAIMED");
    }

    await transaction.customerProfile.upsert({
      where: { shopifyCustomerId },
      create: {
        shopifyCustomerId,
        approvedAt: new Date(),
        approvalSource: "ACCESS_CODE",
        accessCodeUsedId: accessCodeId,
        lastShopifyTagObservedAt: new Date(),
      },
      update: {
        approvedAt: new Date(),
        approvalSource: "ACCESS_CODE",
        accessCodeUsedId: accessCodeId,
        approvalRevokedAt: null,
        lastShopifyTagObservedAt: new Date(),
      },
    });

    await appendAuditLog(transaction, {
      actorPlane: "CUSTOMER",
      actorId: shopifyCustomerId,
      action: "CUSTOMER_APPROVED",
      targetType: "CustomerProfile",
      targetId: shopifyCustomerId,
      payload: {
        approvalSource: "ACCESS_CODE",
        accessCodeId,
      },
      ipHash,
    });
  });
}

function failureForCode(code: {
  claimedByCustomerId: string | null;
  expiresAt: Date;
  status: "ACTIVE" | "CLAIMED" | "REDEEMED" | "REVOKED";
} | null): AccessCodeRedemptionError {
  if (!code) return new AccessCodeRedemptionError("INVALID");
  if (code.status === "REVOKED") return new AccessCodeRedemptionError("REVOKED");
  if (code.status === "REDEEMED") return new AccessCodeRedemptionError("USED");
  if (code.status === "CLAIMED") return new AccessCodeRedemptionError("CLAIMED");
  if (code.expiresAt <= new Date()) return new AccessCodeRedemptionError("EXPIRED");
  return new AccessCodeRedemptionError("INVALID");
}

export async function redeemAccessCode({
  admin,
  code,
  ipAddress,
  shopifyCustomerId,
}: RedeemAccessCodeInput): Promise<RedemptionResult> {
  const codeHash = hashAccessCode(code);
  const existing = await db.accessCode.findUnique({ where: { codeHash } });
  const authoritativeApproved = await readApprovedCustomerTag(
    admin,
    shopifyCustomerId,
  );

  if (
    authoritativeApproved &&
    existing?.status === "CLAIMED" &&
    existing.claimedByCustomerId === shopifyCustomerId
  ) {
    const ipHash = hashPrivateIdentifier("audit-ip", ipAddress);
    await finalizeClaim(existing.id, shopifyCustomerId, ipHash);
    return { status: "APPROVED" };
  }

  if (authoritativeApproved) return { status: "ALREADY_APPROVED" };

  const ipHash = await enforceRedemptionLimits(shopifyCustomerId, ipAddress);
  let claimed = existing;

  if (
    existing?.status === "CLAIMED" &&
    existing.claimedByCustomerId === shopifyCustomerId
  ) {
    claimed = existing;
  } else {
    const now = new Date();
    const claim = await db.accessCode.updateMany({
      where: {
        codeHash,
        status: "ACTIVE",
        expiresAt: { gt: now },
        revokedAt: null,
      },
      data: {
        status: "CLAIMED",
        claimedAt: now,
        claimedByCustomerId: shopifyCustomerId,
      },
    });

    if (claim.count !== 1) {
      const current = await db.accessCode.findUnique({ where: { codeHash } });
      throw failureForCode(current);
    }
    claimed = await db.accessCode.findUnique({ where: { codeHash } });
  }

  if (!claimed || claimed.claimedByCustomerId !== shopifyCustomerId) {
    throw new AccessCodeRedemptionError("CLAIMED");
  }

  try {
    await addApprovedCustomerTag(admin, shopifyCustomerId);
  } catch (error) {
    // A network failure can be ambiguous: Shopify might have committed the tag.
    // Query the authoritative state before leaving the claim for a safe retry.
    const approvedAfterFailure = await readApprovedCustomerTag(
      admin,
      shopifyCustomerId,
    ).catch(() => false);
    if (!approvedAfterFailure) throw error;
  }

  await finalizeClaim(claimed.id, shopifyCustomerId, ipHash);
  return { status: "APPROVED" };
}
