import db from "../db.server";
import { getServerEnvironment } from "../config/env.server";
import { appendAuditLog } from "./audit/audit.server";

export const PICKUP_THRESHOLD_GRAMS = 5000;
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

export async function getPickupForCustomer(assignmentId: string, customerId: string) {
  const assignment = await db.assignment.findFirst({ where: { id: assignmentId, shopifyCustomerId: customerId }, select: { id: true, shopifyOrderId: true, shopifyOrderNumber: true, shopifyCustomerId: true, lineItems: true, status: true } });
  if (!assignment || !isPickupEligible(assignment.lineItems)) return null;
  const address = getServerEnvironment().PICKUP_ADDRESS;
  if (!address) throw new Error("Pickup address is not configured");
  const conversation = await db.$transaction(async (tx) => {
    const existing = await tx.conversation.findFirst({ where: { assignmentId, kind: "PICKUP_ARRANGEMENT" } });
    if (existing) return existing;
    const created = await tx.conversation.create({ data: { assignmentId, kind: "PICKUP_ARRANGEMENT", shopifyOrderId: assignment.shopifyOrderId, shopifyCustomerId: customerId, participants: { create: [{ role: "CUSTOMER", subjectId: customerId }, { role: "ADMIN", subjectId: "admin" }] } } });
    await appendAuditLog(tx, { actorPlane: "CUSTOMER", actorId: customerId, action: "PICKUP_CONVERSATION_CREATED", targetType: "Conversation", targetId: created.id, payload: { assignmentId } });
    return created;
  });
  return { assignment, conversation, address };
}
