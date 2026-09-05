import { AssignmentStatus } from "@prisma/client";

import db from "../db.server";
import { appendAuditLog } from "./audit/audit.server";

const ACTIVE_STATUSES: AssignmentStatus[] = ["PENDING", "ASSIGNED", "SCHEDULED", "OUT_FOR_DELIVERY"];

function orderGid(id: unknown): string | null {
  if (typeof id !== "string" && typeof id !== "number") return null;
  const value = String(id);
  return value.startsWith("gid://") ? value : `gid://shopify/Order/${value}`;
}
function customerGid(value: unknown): string | null {
  if (value && typeof value === "object" && "admin_graphql_api_id" in value) return customerGid((value as {admin_graphql_api_id: unknown}).admin_graphql_api_id);
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  return text.startsWith("gid://") ? text : `gid://shopify/Customer/${text}`;
}
function orderPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") throw new Error("Invalid order payload");
  const p = payload as Record<string, unknown>;
  const id = orderGid(p.admin_graphql_api_id ?? p.id);
  if (!id) throw new Error("Order id missing");
  const customer = customerGid(p.customer);
  const lineItems = Array.isArray(p.line_items) ? p.line_items.map((item) => { const i = item as Record<string, unknown>; return { title: typeof i.title === "string" ? i.title : "Item", quantity: Number(i.quantity) || 0, sku: typeof i.sku === "string" ? i.sku : null }; }) : [];
  const address = p.shipping_address && typeof p.shipping_address === "object" ? p.shipping_address as Record<string, unknown> : {};
  return { id, orderNumber: String(p.name ?? p.order_number ?? p.id), customer, lineItems, city: typeof address.city === "string" ? address.city : null, postcode: typeof address.zip === "string" ? address.zip : null, cancelled: Boolean(p.cancelled_at) };
}

export async function syncShopifyOrder(payload: unknown, actorId = "shopify-webhook") {
  const order = orderPayload(payload); const now = new Date();
  const existing = await db.assignment.findUnique({ where: { shopifyOrderId: order.id } });
  if (existing) return db.assignment.update({ where: { id: existing.id }, data: { shopifyOrderNumber: order.orderNumber, shopifyCustomerId: order.customer, lineItems: order.lineItems, destinationCity: order.city, destinationPostcode: order.postcode, ...(order.cancelled && !["DELIVERED", "FAILED"].includes(existing.status) ? { status: "CANCELLED", cancelledAt: now, cancellationReason: "Shopify order cancelled" } : {}) } });
  const created = await db.$transaction(async (tx) => {
    const assignment = await tx.assignment.create({ data: { shopifyOrderId: order.id, shopifyOrderNumber: order.orderNumber, shopifyCustomerId: order.customer, lineItems: order.lineItems, destinationCity: order.city, destinationPostcode: order.postcode, slaDueAt: new Date(now.getTime() + 24 * 60 * 60 * 1000), status: order.cancelled ? "CANCELLED" : "PENDING", cancelledAt: order.cancelled ? now : null } });
    await tx.assignmentEvent.create({ data: { assignmentId: assignment.id, type: order.cancelled ? "CANCELLED" : "ORDER_SYNCED", actorPlane: "SYSTEM", actorId, metadata: {} } });
    await appendAuditLog(tx, { actorPlane: "SYSTEM", actorId, action: order.cancelled ? "ORDER_CANCELLED" : "ORDER_SYNCED", targetType: "Assignment", targetId: assignment.id, payload: {} });
    return assignment;
  });
  return maybeAutoAssign(created.id);
}
async function maybeAutoAssign(assignmentId: string) {
  const settings = await db.appSettings.findUnique({ where: { id: "singleton" } });
  if (!settings?.autoAssignEnabled || !settings.autoAssignDriverId) return db.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { driver: true } });
  const driver = await db.driver.findFirst({ where: { id: settings.autoAssignDriverId, account: { status: "ACTIVE" } } });
  if (!driver) return db.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { driver: true } });
  return assignOrder({ assignmentId, driverId: driver.id, actorId: "system:auto-assign", actorPlane: "SYSTEM" });
}
export async function listAssignments() { return db.assignment.findMany({ include: { driver: { select: { id: true, displayName: true } } }, orderBy: { createdAt: "desc" } }); }
export async function getAssignmentForDriver(id: string, driverId: string) { return db.assignment.findFirst({ where: { id, driverId, status: { in: ACTIVE_STATUSES } }, include: { driver: true } }); }
export async function listAssignmentsForDriver(driverId: string) { return db.assignment.findMany({ where: { driverId, status: { in: ACTIVE_STATUSES } }, orderBy: [{ scheduledFor: "asc" }, { createdAt: "asc" }] }); }
export async function listAssignmentsForCustomer(customerId: string) { return db.assignment.findMany({ where: { shopifyCustomerId: customerId }, select: { id: true, shopifyOrderNumber: true, status: true, scheduledFor: true, createdAt: true }, orderBy: { createdAt: "desc" } }); }
export async function assignOrder(input: { assignmentId: string; driverId: string | null; actorId: string; actorPlane: "ADMIN" | "CUSTOMER" | "DRIVER" | "SYSTEM" }) {
  return db.$transaction(async (tx) => {
    const current = await tx.assignment.findUnique({ where: { id: input.assignmentId } });
    if (!current || current.status === "CANCELLED") throw new Error("Assignment unavailable");
    if (input.driverId && !(await tx.driver.findFirst({ where: { id: input.driverId, account: { status: "ACTIVE" } } }))) throw new Error("Driver is not active");
    const nextStatus = input.driverId ? (current.scheduledFor ? "SCHEDULED" : "ASSIGNED") : "PENDING";
    const updated = await tx.assignment.update({ where: { id: current.id }, data: { driverId: input.driverId, assignedAt: input.driverId ? new Date() : null, assignedBy: input.driverId ? input.actorId : null, status: nextStatus } });
    await tx.assignmentEvent.create({ data: { assignmentId: current.id, type: input.driverId ? (current.driverId ? "REASSIGNED" : "ASSIGNED") : "UNASSIGNED", actorPlane: input.actorPlane, actorId: input.actorId, metadata: {} } });
    await appendAuditLog(tx, { actorPlane: input.actorPlane, actorId: input.actorId, action: input.driverId ? (current.driverId ? "ORDER_REASSIGNED" : "ORDER_ASSIGNED") : "ORDER_UNASSIGNED", targetType: "Assignment", targetId: current.id, payload: { driverId: input.driverId } });
    return updated;
  });
}
export async function scheduleOrder(input: { assignmentId: string; scheduledFor: Date; actorId: string }) {
  if (Number.isNaN(input.scheduledFor.getTime()) || input.scheduledFor.getTime() < Date.now()) throw new Error("Schedule must be a future date");
  return db.$transaction(async (tx) => {
    const current = await tx.assignment.findUnique({ where: { id: input.assignmentId } });
    if (!current || !current.driverId || current.status === "CANCELLED") throw new Error("An active assignment is required");
    const updated = await tx.assignment.update({ where: { id: current.id }, data: { scheduledFor: input.scheduledFor, status: "SCHEDULED" } });
    await tx.assignmentEvent.create({ data: { assignmentId: current.id, type: current.scheduledFor ? "RESCHEDULED" : "SCHEDULED", actorPlane: "ADMIN", actorId: input.actorId, metadata: { scheduledFor: input.scheduledFor.toISOString() } } });
    await appendAuditLog(tx, { actorPlane: "ADMIN", actorId: input.actorId, action: current.scheduledFor ? "ORDER_RESCHEDULED" : "ORDER_SCHEDULED", targetType: "Assignment", targetId: current.id, payload: { scheduledFor: input.scheduledFor.toISOString() } });
    return updated;
  });
}
export async function listActiveDrivers() { return db.driver.findMany({ where: { account: { status: "ACTIVE" } }, select: { id: true, displayName: true } }); }
export async function getDispatchSettings() { return db.appSettings.findUnique({ where: { id: "singleton" } }); }
export async function setDefaultDriver(driverId: string | null, enabled: boolean) {
  if (enabled && driverId && !(await db.driver.findFirst({ where: { id: driverId, account: { status: "ACTIVE" } } }))) throw new Error("Driver is not active");
  return db.appSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", autoAssignEnabled: enabled, autoAssignDriverId: enabled ? driverId : null }, update: { autoAssignEnabled: enabled, autoAssignDriverId: enabled ? driverId : null } });
}
export function parseOrderWebhook(payload: unknown) { return orderPayload(payload); }
