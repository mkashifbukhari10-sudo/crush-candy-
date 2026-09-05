import { AnnouncementAudience, AnnouncementStatus, HelpNodeType, SupportStatus } from "@prisma/client";
import db from "../db.server";
import { appendAuditLog } from "./audit/audit.server";

const MAX = 4000;
const clean = (value: unknown, max = MAX) => typeof value === "string" ? value.trim().slice(0, max) : "";
export const sanitizeSupportText = clean;
export function isAnnouncementVisible(status: AnnouncementStatus, publishAt: Date | null, now = new Date()) { return status === AnnouncementStatus.PUBLISHED && (!publishAt || publishAt <= now); }
export function isSupportStatusTransitionAllowed(from: SupportStatus, to: SupportStatus) { if (from === SupportStatus.CLOSED && to !== SupportStatus.CLOSED) return false; return [SupportStatus.OPEN, SupportStatus.ANSWERED, SupportStatus.CLOSED].includes(to); }

export async function listAnnouncements(audience: AnnouncementAudience) {
  const now = new Date();
  return db.announcement.findMany({ where: { audience, status: AnnouncementStatus.PUBLISHED, OR: [{ publishAt: null }, { publishAt: { lte: now } }] }, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }], select: { id: true, title: true, body: true, publishAt: true, createdAt: true } });
}
export async function listAllAnnouncements() { return db.announcement.findMany({ orderBy: [{ audience: "asc" }, { sortOrder: "asc" }, { createdAt: "desc" }] }); }
export async function saveAnnouncement(input: { id?: string; audience: AnnouncementAudience; status: AnnouncementStatus; title: string; body: string; publishAt?: Date | null; sortOrder?: number; actorId: string }) {
  const data = { audience: input.audience, status: input.status, title: clean(input.title, 180), body: clean(input.body), publishAt: input.publishAt ?? null, sortOrder: Number.isFinite(input.sortOrder) ? input.sortOrder : 0, updatedBy: input.actorId };
  if (!data.title || !data.body) throw new Error("Title and body are required");
  return db.$transaction(async (tx) => { const item = input.id ? await tx.announcement.update({ where: { id: input.id }, data }) : await tx.announcement.create({ data: { ...data, createdBy: input.actorId } }); await appendAuditLog(tx, { actorPlane: "ADMIN", actorId: input.actorId, action: input.id ? "ANNOUNCEMENT_UPDATED" : "ANNOUNCEMENT_CREATED", targetType: "Announcement", targetId: item.id, payload: { audience: item.audience, status: item.status } }); return item; });
}
export async function listHelpNodes(parentId: string | null = null) { return db.helpNode.findMany({ where: { parentId, active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, type: true, label: true, guidance: true } }); }
export async function getHelpNode(id: string) { return db.helpNode.findFirst({ where: { id, active: true }, select: { id: true, type: true, label: true, guidance: true, parentId: true } }); }
export async function createSupportTicket(input: { customerId: string; category: string; nodePath: string[]; subject: string; message: string }) {
  const subject = clean(input.subject, 180), message = clean(input.message);
  if (!subject || !message) throw new Error("Subject and message are required");
  return db.$transaction(async (tx) => { const ticket = await tx.supportTicket.create({ data: { shopifyCustomerId: input.customerId, category: clean(input.category, 120), nodePath: input.nodePath.slice(0, 20), subject, initialMessage: message, messages: { create: { senderPlane: "CUSTOMER", senderId: input.customerId, body: message } } }, include: { messages: true } }); await appendAuditLog(tx, { actorPlane: "CUSTOMER", actorId: input.customerId, action: "SUPPORT_TICKET_CREATED", targetType: "SupportTicket", targetId: ticket.id, payload: { category: ticket.category } }); return ticket; });
}
export async function listCustomerTickets(customerId: string) { return db.supportTicket.findMany({ where: { shopifyCustomerId: customerId }, orderBy: { createdAt: "desc" }, include: { messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } }); }
export async function listSupportTickets() { return db.supportTicket.findMany({ orderBy: { updatedAt: "desc" }, include: { messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } }); }
export async function updateSupportTicket(input: { id: string; status: SupportStatus; actorId: string; response?: string }) {
  const response = input.response ? clean(input.response) : "";
  return db.$transaction(async (tx) => { const existing = await tx.supportTicket.findUnique({ where: { id: input.id } }); if (!existing) throw new Error("Support request not found"); const updated = await tx.supportTicket.update({ where: { id: input.id }, data: { status: input.status, respondedAt: response ? new Date() : existing.respondedAt, closedAt: input.status === "CLOSED" ? new Date() : null, ...(response ? { messages: { create: { senderPlane: "ADMIN", senderId: input.actorId, body: response } } } : {}) }, include: { messages: true } }); await appendAuditLog(tx, { actorPlane: "ADMIN", actorId: input.actorId, action: "SUPPORT_STATUS_CHANGED", targetType: "SupportTicket", targetId: input.id, payload: { from: existing.status, to: input.status, responded: Boolean(response) } }); return updated; });
}
export { AnnouncementAudience, AnnouncementStatus, HelpNodeType, SupportStatus };
