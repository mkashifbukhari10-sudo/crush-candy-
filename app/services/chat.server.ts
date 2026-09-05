import db from "../db.server";
import { appendAuditLog } from "./audit/audit.server";

const MAX_MESSAGE_LENGTH = 2000;
const OPEN_STATUSES = ["PENDING", "ASSIGNED", "SCHEDULED", "OUT_FOR_DELIVERY"] as const;

export async function ensureOrderConversation(assignmentId: string) {
  const assignment = await db.assignment.findUnique({ where: { id: assignmentId } });
  if (!assignment?.shopifyCustomerId || !assignment.driverId || !OPEN_STATUSES.includes(assignment.status as (typeof OPEN_STATUSES)[number])) throw new Error("Conversation is not available for this order");
  const customerId = assignment.shopifyCustomerId; const driverId = assignment.driverId;
  return db.$transaction(async (tx) => {
    const existing = await tx.conversation.findFirst({ where: { assignmentId, kind: "ORDER_DELIVERY" }, include: { participants: true } });
    if (existing) return existing;
    const conversation = await tx.conversation.create({ data: { assignmentId, shopifyOrderId: assignment.shopifyOrderId, shopifyCustomerId: customerId, participants: { create: [{ role: "CUSTOMER", subjectId: customerId }, { role: "DRIVER", subjectId: driverId }] } }, include: { participants: true } });
    await appendAuditLog(tx, { actorPlane: "SYSTEM", actorId: "chat", action: "CONVERSATION_CREATED", targetType: "Conversation", targetId: conversation.id, payload: { assignmentId } });
    return conversation;
  });
}

export async function getCustomerConversation(id: string, customerId: string) {
  return db.conversation.findFirst({ where: { id, shopifyCustomerId: customerId, status: "OPEN", OR: [{ kind: "PICKUP_ARRANGEMENT" }, { kind: "ORDER_DELIVERY", assignment: { status: { in: [...OPEN_STATUSES] } } }] }, include: { messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100 }, assignment: true } });
}
export async function getDriverConversation(id: string, driverId: string) {
  return db.conversation.findFirst({ where: { id, kind: "ORDER_DELIVERY", status: "OPEN", assignment: { driverId, status: { in: [...OPEN_STATUSES] } } }, include: { messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100 }, assignment: true } });
}
export async function listCustomerConversations(customerId: string) { return db.conversation.findMany({ where: { shopifyCustomerId: customerId, status: "OPEN" }, include: { assignment: { select: { shopifyOrderNumber: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" }, take: 200 }); }
export async function listDriverConversations(driverId: string) { return db.conversation.findMany({ where: { kind: "ORDER_DELIVERY", status: "OPEN", assignment: { driverId, status: { in: [...OPEN_STATUSES] } } }, include: { assignment: { select: { shopifyOrderNumber: true } }, messages: { orderBy: { createdAt: "desc" }, take: 1 } }, orderBy: { updatedAt: "desc" }, take: 200 }); }
export async function adminSearchConversations(query?: string) { return db.conversation.findMany({ where: query ? { OR: [{ shopifyOrderId: { contains: query, mode: "insensitive" } }, { assignment: { shopifyOrderNumber: { contains: query, mode: "insensitive" } } }] } : undefined, include: { assignment: { select: { shopifyOrderNumber: true, shopifyCustomerId: true, driver: { select: { displayName: true } } } }, messages: { orderBy: { createdAt: "asc" }, take: 100 } }, orderBy: { updatedAt: "desc" }, take: 100 }); }
export async function adminReadConversation(id: string, adminId: string) { const c = await db.conversation.findUnique({ where: { id }, include: { messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 200 }, assignment: { include: { driver: { select: { displayName: true } } } }, participants: true } }); if (c) await appendAuditLog(db, { actorPlane: "ADMIN", actorId: adminId, action: "CHAT_READ_BY_ADMIN", targetType: "Conversation", targetId: id, payload: { assignmentId: c.assignmentId } }); return c; }

async function rateLimitMessages(conversationId: string, senderId: string) { const since = new Date(Date.now() - 60_000); const count = await db.message.count({ where: { conversationId, senderId, createdAt: { gt: since } } }); if (count >= 30) throw new Error("Message rate limit exceeded"); }
export async function sendMessage(input: { conversationId: string; senderType: "CUSTOMER" | "DRIVER"; senderId: string; senderLabel: string; body: string }) {
  const body = input.body.trim(); if (!body || body.length > MAX_MESSAGE_LENGTH) throw new Error("Message must be 1–2000 characters");
  await rateLimitMessages(input.conversationId, input.senderId);
  const c = input.senderType === "CUSTOMER" ? await getCustomerConversation(input.conversationId, input.senderId) : await getDriverConversation(input.conversationId, input.senderId);
  if (!c) throw new Response("Not found", { status: 404 });
  return db.message.create({ data: { conversationId: c.id, senderType: input.senderType, senderId: input.senderId, senderLabel: input.senderLabel.slice(0, 120), body } });
}
export async function markConversationRead(id: string, role: "CUSTOMER" | "DRIVER", subjectId: string, messageId?: string) { const c = role === "CUSTOMER" ? await getCustomerConversation(id, subjectId) : await getDriverConversation(id, subjectId); if (!c) throw new Response("Not found", { status: 404 }); return db.conversationParticipant.updateMany({ where: { conversationId: id, role, subjectId }, data: { lastReadAt: new Date(), lastReadMessageId: messageId ?? null } }); }
export async function conversationEvents(id: string, after: Date, role: "CUSTOMER" | "DRIVER", subjectId: string) { const c = role === "CUSTOMER" ? await getCustomerConversation(id, subjectId) : await getDriverConversation(id, subjectId); if (!c) throw new Response("Not found", { status: 404 }); return db.message.findMany({ where: { conversationId: id, createdAt: { gt: after } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100 }); }
