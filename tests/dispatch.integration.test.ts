import { afterEach, describe, expect, it } from "vitest";
import db from "../app/db.server";
import { syncShopifyOrder } from "../app/services/dispatch.server";

const suite = process.env.RUN_DATABASE_TESTS === "1" ? describe : describe.skip;
const orderId = `gid://shopify/Order/m4-${Date.now()}`;

suite("M4 dispatch order synchronization", () => {
  afterEach(async () => {
    const row = await db.assignment.findUnique({ where: { shopifyOrderId: orderId } });
    if (row) { await db.assignmentEvent.deleteMany({ where: { assignmentId: row.id } }); await db.auditLog.deleteMany({ where: { targetId: row.id } }); await db.assignment.delete({ where: { id: row.id } }); }
  });
  it("creates one operational order and remains idempotent on duplicate delivery", async () => {
    const payload = { admin_graphql_api_id: orderId, name: "#M4-1", customer: { admin_graphql_api_id: "gid://shopify/Customer/m4-test" }, line_items: [{ title: "Lollies", quantity: 2, sku: "LOL" }], shipping_address: { city: "Perth", zip: "6000" } };
    await syncShopifyOrder(payload); await syncShopifyOrder(payload);
    expect(await db.assignment.count({ where: { shopifyOrderId: orderId } })).toBe(1);
    expect((await db.assignment.findUnique({ where: { shopifyOrderId: orderId } }))?.status).toBe("PENDING");
  });
});
