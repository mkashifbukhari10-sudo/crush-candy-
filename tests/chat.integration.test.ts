import { afterEach, describe, expect, it } from "vitest";
import db from "../app/db.server";
import { adminReadConversation, ensureOrderConversation, getCustomerConversation, getDriverConversation, sendMessage } from "../app/services/chat.server";
import { assignOrder } from "../app/services/dispatch.server";

const suite = process.env.RUN_DATABASE_TESTS === "1" ? describe : describe.skip;
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let assignmentId = ""; let accountIds: string[] = [];

suite("M5 chat authorization", () => {
  afterEach(async () => {
    if (assignmentId) { const cs = await db.conversation.findMany({ where: { assignmentId } }); for (const c of cs) { await db.message.deleteMany({ where: { conversationId: c.id } }); await db.conversationParticipant.deleteMany({ where: { conversationId: c.id } }); await db.auditLog.deleteMany({ where: { targetId: c.id } }); await db.conversation.delete({ where: { id: c.id } }); } await db.assignmentEvent.deleteMany({ where: { assignmentId } }); await db.auditLog.deleteMany({ where: { targetId: assignmentId } }); await db.assignment.delete({ where: { id: assignmentId } }); assignmentId = ""; }
    for (const id of accountIds) { await db.driver.deleteMany({ where: { accountId: id } }); await db.driverAccount.delete({ where: { id } }); } accountIds = [];
  });
  it("creates one conversation and revokes the previous driver's access after reassignment", async () => {
    const a = await db.driverAccount.create({ data: { email: `m5-a-${suffix}@example.com`, createdByAdminId: "m5", status: "ACTIVE", passwordHash: "test", driver: { create: { displayName: "Driver A" } } }, include: { driver: true } });
    const b = await db.driverAccount.create({ data: { email: `m5-b-${suffix}@example.com`, createdByAdminId: "m5", status: "ACTIVE", passwordHash: "test", driver: { create: { displayName: "Driver B" } } }, include: { driver: true } }); accountIds = [a.id, b.id];
    const assignment = await db.assignment.create({ data: { shopifyOrderId: `gid://shopify/Order/m5-${suffix}`, shopifyOrderNumber: "#M5", shopifyCustomerId: `gid://shopify/Customer/m5-${suffix}`, driverId: a.driver!.id, status: "ASSIGNED", slaDueAt: new Date(Date.now() + 86400000) } }); assignmentId = assignment.id;
    const first = await ensureOrderConversation(assignment.id); const second = await ensureOrderConversation(assignment.id); expect(second.id).toBe(first.id);
    await sendMessage({ conversationId: first.id, senderType: "DRIVER", senderId: a.driver!.id, senderLabel: "Driver A", body: "On the way" });
    expect((await getDriverConversation(first.id, a.driver!.id))?.messages).toHaveLength(1);
    await assignOrder({ assignmentId: assignment.id, driverId: b.driver!.id, actorId: "m5-admin", actorPlane: "ADMIN" });
    expect(await getDriverConversation(first.id, a.driver!.id)).toBeNull();
    expect(await getDriverConversation(first.id, b.driver!.id)).not.toBeNull();
    expect(await getCustomerConversation(first.id, assignment.shopifyCustomerId!)).not.toBeNull();
    await db.assignment.update({ where: { id: assignment.id }, data: { status: "DELIVERED", deliveredAt: new Date() } });
    expect(await getCustomerConversation(first.id, assignment.shopifyCustomerId!)).toBeNull();
    expect(await getDriverConversation(first.id, b.driver!.id)).toBeNull();
    expect((await adminReadConversation(first.id, "m8-admin"))?.messages).toHaveLength(1);
    expect((await db.message.count({ where: { conversationId: first.id } }))).toBe(1);
  });
});
