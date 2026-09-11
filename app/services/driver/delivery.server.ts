import type { AssignmentStatus } from "@prisma/client";

import db from "../../db.server";
import { appendAuditLog } from "../audit/audit.server";

/**
 * Driver-plane delivery workflow. Every read and write is scoped to the authenticated driver and
 * to `fulfillmentMode: "DELIVERY"`, so a pickup order can never be reached through this surface.
 */

/** Statuses a driver may still act on. */
const ACTIVE_STATUSES: AssignmentStatus[] = ["ASSIGNED", "SCHEDULED", "OUT_FOR_DELIVERY"];
/** A delivery can only be started from a state where a driver is holding it but has not left. */
const STARTABLE_STATUSES: AssignmentStatus[] = ["ASSIGNED", "SCHEDULED"];

/**
 * The complete set of fields a driver is entitled to see (architecture 13.9): order number,
 * items, delivery address, suburb/postcode, drop notes and the customer's first name. Selected
 * explicitly so a future column cannot leak into the driver plane by default.
 */
const DRIVER_DELIVERY_SELECT = {
  id: true,
  shopifyOrderNumber: true,
  status: true,
  scheduledFor: true,
  dispatchedAt: true,
  deliveredAt: true,
  lineItems: true,
  destinationAddress1: true,
  destinationAddress2: true,
  destinationCity: true,
  destinationPostcode: true,
  deliveryNotes: true,
  customerFirstName: true,
} as const;

export type DriverDelivery = {
  id: string;
  shopifyOrderNumber: string;
  status: AssignmentStatus;
  scheduledFor: Date | null;
  dispatchedAt: Date | null;
  deliveredAt: Date | null;
  lineItems: unknown;
  destinationAddress1: string | null;
  destinationAddress2: string | null;
  destinationCity: string | null;
  destinationPostcode: string | null;
  deliveryNotes: string | null;
  customerFirstName: string | null;
};

export type DeliveryTransitionFailure = "NOT_FOUND" | "INVALID_TRANSITION";

export class DeliveryWorkflowError extends Error {
  readonly reason: DeliveryTransitionFailure;

  constructor(reason: DeliveryTransitionFailure, message?: string) {
    super(message ?? reason);
    this.name = "DeliveryWorkflowError";
    this.reason = reason;
  }
}

/** Returns null for another driver's order, a pickup order, or one past its active window. */
export async function getDeliveryForDriver(assignmentId: string, driverId: string): Promise<DriverDelivery | null> {
  return db.assignment.findFirst({
    where: { id: assignmentId, driverId, fulfillmentMode: "DELIVERY", status: { in: ACTIVE_STATUSES } },
    select: DRIVER_DELIVERY_SELECT,
  }) as Promise<DriverDelivery | null>;
}

async function transition(
  input: { assignmentId: string; driverId: string; from: AssignmentStatus[]; to: AssignmentStatus; stamp: "dispatchedAt" | "deliveredAt"; event: string; audit: string },
): Promise<DriverDelivery> {
  const now = new Date();

  return db.$transaction(async (tx) => {
    const current = await tx.assignment.findFirst({
      where: { id: input.assignmentId, driverId: input.driverId, fulfillmentMode: "DELIVERY" },
      select: { id: true, status: true },
    });
    if (!current) throw new DeliveryWorkflowError("NOT_FOUND");

    // Already there: return the current state rather than writing a second event.
    if (current.status === input.to) {
      return (await tx.assignment.findUniqueOrThrow({ where: { id: current.id }, select: DRIVER_DELIVERY_SELECT })) as DriverDelivery;
    }
    if (!input.from.includes(current.status)) throw new DeliveryWorkflowError("INVALID_TRANSITION");

    // Conditional update: a concurrent transition updates zero rows and is rejected below.
    const claim = await tx.assignment.updateMany({
      where: { id: current.id, driverId: input.driverId, fulfillmentMode: "DELIVERY", status: { in: input.from } },
      data: { status: input.to, [input.stamp]: now },
    });
    if (claim.count === 0) throw new DeliveryWorkflowError("INVALID_TRANSITION");

    await tx.assignmentEvent.create({
      data: { assignmentId: current.id, type: input.event, actorPlane: "DRIVER", actorId: input.driverId, metadata: { from: current.status, to: input.to } },
    });
    await appendAuditLog(tx, {
      actorPlane: "DRIVER",
      actorId: input.driverId,
      action: input.audit,
      targetType: "Assignment",
      targetId: current.id,
      payload: { from: current.status, to: input.to },
    });

    if (input.to === "DELIVERED") {
      // Locked rule: customer and driver lose the delivery chat once delivered. History is kept
      // and admin oversight is unaffected — the thread is closed, never removed.
      await tx.conversation.updateMany({
        where: { assignmentId: current.id, kind: "ORDER_DELIVERY", status: "OPEN" },
        data: { status: "CLOSED", closedAt: now },
      });
    }

    return (await tx.assignment.findUniqueOrThrow({ where: { id: current.id }, select: DRIVER_DELIVERY_SELECT })) as DriverDelivery;
  });
}

export async function startDelivery(assignmentId: string, driverId: string): Promise<DriverDelivery> {
  return transition({
    assignmentId,
    driverId,
    from: STARTABLE_STATUSES,
    to: "OUT_FOR_DELIVERY",
    stamp: "dispatchedAt",
    event: "OUT_FOR_DELIVERY",
    audit: "DELIVERY_STARTED",
  });
}

export async function completeDelivery(assignmentId: string, driverId: string): Promise<DriverDelivery> {
  return transition({
    assignmentId,
    driverId,
    from: ["OUT_FOR_DELIVERY"],
    to: "DELIVERED",
    stamp: "deliveredAt",
    event: "DELIVERED",
    audit: "DELIVERY_COMPLETED",
  });
}
