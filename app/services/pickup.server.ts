import db from "../db.server";
import { getServerEnvironment } from "../config/env.server";
import { appendAuditLog } from "./audit/audit.server";

export const PICKUP_THRESHOLD_GRAMS = 5000;

/** Statuses past which fulfilment can no longer change. */
const TERMINAL_STATUSES = ["DELIVERED", "FAILED", "CANCELLED"] as const;

export function normalizeWeightToGrams(value: number, unit: string | null | undefined): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  switch ((unit ?? "g").toLowerCase()) {
    case "kg": return value * 1000;
    case "lb":
    case "lbs": return value * 453.59237;
    case "oz": return value * 28.349523125;
    case "g":
    case "gram":
    case "grams": return value;
    default: return 0;
  }
}
export function orderWeightGrams(lineItems: unknown): number {
  if (!Array.isArray(lineItems)) return 0;
  return lineItems.reduce((sum, raw) => { if (!raw || typeof raw !== "object") return sum; const item = raw as Record<string, unknown>; const grams = typeof item.weightGrams === "number" ? item.weightGrams : normalizeWeightToGrams(Number(item.weightValue), typeof item.weightUnit === "string" ? item.weightUnit : "g"); const quantity = Math.max(0, Number(item.quantity) || 0); return sum + grams * quantity; }, 0);
}
export function isPickupEligible(lineItems: unknown, thresholdGrams = PICKUP_THRESHOLD_GRAMS) { return orderWeightGrams(lineItems) >= thresholdGrams; }

export type PickupFailure = "NOT_FOUND" | "NOT_ELIGIBLE" | "TERMINAL_STATE" | "NOT_PICKUP" | "ADDRESS_UNCONFIGURED";

export class PickupError extends Error {
  readonly reason: PickupFailure;

  constructor(reason: PickupFailure, message?: string) {
    super(message ?? reason);
    this.name = "PickupError";
    this.reason = reason;
  }
}

export type PickupView = {
  assignment: { id: string; shopifyOrderNumber: string; status: string; fulfillmentMode: string; pickupElectedAt: Date | null };
  eligible: boolean;
  elected: boolean;
  /** Present only once pickup is elected. Read from env per request and never persisted. */
  address: string | null;
  conversationId: string | null;
};

function requireOwnedAssignment(assignmentId: string, customerId: string) {
  return db.assignment.findFirst({
    where: { id: assignmentId, shopifyCustomerId: customerId },
    select: { id: true, shopifyOrderId: true, shopifyOrderNumber: true, shopifyCustomerId: true, lineItems: true, status: true, fulfillmentMode: true, pickupElectedAt: true, driverId: true },
  });
}

function pickupAddress(): string {
  const address = getServerEnvironment().PICKUP_ADDRESS;
  if (!address) throw new PickupError("ADDRESS_UNCONFIGURED", "Pickup address is not configured");
  return address;
}

/**
 * Read-only view for the owning approved customer. Electing pickup is a POST, so this never
 * mutates anything, and the private address is withheld until pickup has actually been elected.
 */
export async function getPickupForCustomer(assignmentId: string, customerId: string): Promise<PickupView> {
  const assignment = await requireOwnedAssignment(assignmentId, customerId);
  if (!assignment) throw new PickupError("NOT_FOUND");

  const eligible = isPickupEligible(assignment.lineItems);
  if (!eligible) throw new PickupError("NOT_ELIGIBLE");

  const elected = assignment.fulfillmentMode === "PICKUP";
  const conversation = elected
    ? await db.conversation.findFirst({ where: { assignmentId, kind: "PICKUP_ARRANGEMENT" }, select: { id: true } })
    : null;

  return {
    assignment: {
      id: assignment.id,
      shopifyOrderNumber: assignment.shopifyOrderNumber,
      status: assignment.status,
      fulfillmentMode: assignment.fulfillmentMode,
      pickupElectedAt: assignment.pickupElectedAt,
    },
    eligible,
    elected,
    address: elected ? pickupAddress() : null,
    conversationId: conversation?.id ?? null,
  };
}

/**
 * Elects pickup for an order. Pickup replaces delivery: the driver is released, delivery
 * scheduling is cleared and the delivery conversation is closed, all in one transaction.
 * Re-confirming an order already on pickup is a no-op that returns the same view.
 */
export async function electPickup(assignmentId: string, customerId: string): Promise<PickupView> {
  const assignment = await requireOwnedAssignment(assignmentId, customerId);
  if (!assignment) throw new PickupError("NOT_FOUND");
  if (!isPickupEligible(assignment.lineItems)) throw new PickupError("NOT_ELIGIBLE");
  // Resolved before the transaction so a misconfigured address fails without half-electing.
  const address = pickupAddress();

  if (assignment.fulfillmentMode === "PICKUP") return getPickupForCustomer(assignmentId, customerId);
  if (TERMINAL_STATUSES.includes(assignment.status as (typeof TERMINAL_STATUSES)[number])) {
    throw new PickupError("TERMINAL_STATE");
  }

  const conversationId = await db.$transaction(async (tx) => {
    // Conditional update: a concurrent election updates zero rows and this one becomes the no-op.
    const claim = await tx.assignment.updateMany({
      where: { id: assignment.id, fulfillmentMode: "DELIVERY", status: { notIn: [...TERMINAL_STATUSES] } },
      data: {
        fulfillmentMode: "PICKUP",
        pickupElectedAt: new Date(),
        // Pickup replaces delivery: no driver, no delivery schedule, back to PENDING.
        driverId: null,
        assignedAt: null,
        assignedBy: null,
        scheduledFor: null,
        status: "PENDING",
      },
    });
    if (claim.count === 0) return null;

    if (assignment.driverId) {
      await tx.assignmentEvent.create({
        data: { assignmentId: assignment.id, type: "UNASSIGNED", actorPlane: "CUSTOMER", actorId: customerId, metadata: { reason: "PICKUP_ELECTED", previousDriverId: assignment.driverId } },
      });
      await appendAuditLog(tx, { actorPlane: "CUSTOMER", actorId: customerId, action: "ORDER_UNASSIGNED", targetType: "Assignment", targetId: assignment.id, payload: { reason: "PICKUP_ELECTED" } });
    }

    // History is preserved; only access is withdrawn. Admin oversight reads closed threads.
    await tx.conversation.updateMany({
      where: { assignmentId: assignment.id, kind: "ORDER_DELIVERY", status: "OPEN" },
      data: { status: "CLOSED", closedAt: new Date() },
    });

    const existing = await tx.conversation.findFirst({ where: { assignmentId: assignment.id, kind: "PICKUP_ARRANGEMENT" }, select: { id: true } });
    const conversation =
      existing ??
      (await tx.conversation.create({
        data: {
          assignmentId: assignment.id,
          kind: "PICKUP_ARRANGEMENT",
          shopifyOrderId: assignment.shopifyOrderId,
          shopifyCustomerId: customerId,
          participants: { create: [{ role: "CUSTOMER", subjectId: customerId }, { role: "ADMIN", subjectId: "admin" }] },
        },
        select: { id: true },
      }));

    await tx.assignmentEvent.create({
      data: { assignmentId: assignment.id, type: "PICKUP_ELECTED", actorPlane: "CUSTOMER", actorId: customerId, metadata: { conversationId: conversation.id } },
    });
    await appendAuditLog(tx, { actorPlane: "CUSTOMER", actorId: customerId, action: "PICKUP_ELECTED", targetType: "Assignment", targetId: assignment.id, payload: { conversationId: conversation.id } });
    return conversation.id;
  });

  // A lost race means another request already elected pickup; report that state, not an error.
  if (conversationId === null) return getPickupForCustomer(assignmentId, customerId);

  const refreshed = await requireOwnedAssignment(assignmentId, customerId);
  return {
    assignment: {
      id: assignment.id,
      shopifyOrderNumber: assignment.shopifyOrderNumber,
      status: refreshed?.status ?? "PENDING",
      fulfillmentMode: "PICKUP",
      pickupElectedAt: refreshed?.pickupElectedAt ?? null,
    },
    eligible: true,
    elected: true,
    address,
    conversationId,
  };
}
