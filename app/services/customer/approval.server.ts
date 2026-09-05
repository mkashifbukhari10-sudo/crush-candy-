import type { ApprovalSource } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

import db from "../../db.server";
import { CustomerAuthorizationError } from "../../lib/errors.server";
import { appendAuditLog } from "../audit/audit.server";
import {
  readApprovedCustomerTag,
  removeApprovedCustomerTag,
} from "./shopify-customer.server";

export interface CustomerApprovalState {
  approved: boolean;
  shopifyCustomerId: string;
}

interface ReconcileOptions {
  actorId?: string;
  actorPlane?: "ADMIN" | "CUSTOMER" | "SYSTEM";
  observedAt?: Date;
  source?: ApprovalSource;
}

function localProfileIsApproved(profile: {
  approvedAt: Date | null;
  approvalRevokedAt: Date | null;
} | null): boolean {
  return Boolean(profile?.approvedAt && !profile.approvalRevokedAt);
}

export async function reconcileCustomerApproval(
  shopifyCustomerId: string,
  authoritativeApproved: boolean,
  options: ReconcileOptions = {},
): Promise<CustomerApprovalState> {
  const observedAt = options.observedAt ?? new Date();

  await db.$transaction(async (transaction) => {
    const profile = await transaction.customerProfile.findUnique({
      where: { shopifyCustomerId },
    });
    const localApproved = localProfileIsApproved(profile);

    if (localApproved !== authoritativeApproved) {
      await appendAuditLog(transaction, {
        actorPlane: options.actorPlane ?? "SYSTEM",
        actorId: options.actorId ?? "shopify-tag-reconciliation",
        action: "APPROVAL_DIVERGENCE",
        targetType: "CustomerProfile",
        targetId: shopifyCustomerId,
        payload: {
          authoritativeApproved,
          previousLocalApproved: localApproved,
        },
      });
    }

    if (authoritativeApproved) {
      const source = options.source ?? "MIGRATION";
      await transaction.customerProfile.upsert({
        where: { shopifyCustomerId },
        create: {
          shopifyCustomerId,
          approvedAt: observedAt,
          approvalSource: source,
          lastShopifyTagObservedAt: observedAt,
        },
        update: {
          ...(localApproved
            ? {}
            : { approvedAt: observedAt, approvalSource: source }),
          approvalRevokedAt: null,
          lastShopifyTagObservedAt: observedAt,
        },
      });

      if (!localApproved) {
        await appendAuditLog(transaction, {
          actorPlane: options.actorPlane ?? "SYSTEM",
          actorId: options.actorId ?? "shopify-tag-reconciliation",
          action: "CUSTOMER_APPROVED",
          targetType: "CustomerProfile",
          targetId: shopifyCustomerId,
          payload: { source },
        });
      }
    } else {
      await transaction.customerProfile.upsert({
        where: { shopifyCustomerId },
        create: {
          shopifyCustomerId,
          lastShopifyTagObservedAt: observedAt,
        },
        update: {
          ...(localApproved ? { approvalRevokedAt: observedAt } : {}),
          lastShopifyTagObservedAt: observedAt,
        },
      });

      if (localApproved) {
        await appendAuditLog(transaction, {
          actorPlane: options.actorPlane ?? "SYSTEM",
          actorId: options.actorId ?? "shopify-tag-reconciliation",
          action: "APPROVAL_REVOKED",
          targetType: "CustomerProfile",
          targetId: shopifyCustomerId,
          payload: { source: "SHOPIFY_TAG_REMOVED" },
        });
      }
    }
  });

  return { approved: authoritativeApproved, shopifyCustomerId };
}

export async function getCustomerApprovalState(
  admin: AdminApiContext,
  shopifyCustomerId: string,
): Promise<CustomerApprovalState> {
  const approved = await readApprovedCustomerTag(admin, shopifyCustomerId);
  return reconcileCustomerApproval(shopifyCustomerId, approved);
}

export async function requireApprovedCustomer(
  admin: AdminApiContext,
  shopifyCustomerId: string,
): Promise<CustomerApprovalState> {
  const state = await getCustomerApprovalState(admin, shopifyCustomerId);
  if (!state.approved) throw new CustomerAuthorizationError();
  return state;
}

export async function revokeCustomerApproval(
  admin: AdminApiContext,
  shopifyCustomerId: string,
  adminId: string,
): Promise<void> {
  await removeApprovedCustomerTag(admin, shopifyCustomerId);
  await reconcileCustomerApproval(shopifyCustomerId, false, {
    actorId: adminId,
    actorPlane: "ADMIN",
    source: "ADMIN_MANUAL",
  });
}

export async function reconcileCustomerTagWebhook(
  shopifyCustomerId: string,
  tags: readonly string[],
  occurredAt: Date,
): Promise<void> {
  await reconcileCustomerApproval(
    shopifyCustomerId,
    tags.includes("approved"),
    {
      actorId: "shopify-customer-tag-webhook",
      actorPlane: "SYSTEM",
      observedAt: occurredAt,
      source: "ADMIN_MANUAL",
    },
  );
}
