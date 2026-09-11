import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { parseOrderWebhook } from "../app/services/dispatch.server";

const source = (file: string) => readFileSync(new URL(`../app/${file}`, import.meta.url), "utf8");

const payload = {
  admin_graphql_api_id: "gid://shopify/Order/1",
  name: "#1001",
  note: "Leave at side gate",
  customer: { admin_graphql_api_id: "gid://shopify/Customer/9", first_name: "Alex", last_name: "Smith", email: "alex@example.com", phone: "+61400000000" },
  line_items: [{ title: "Lollies", quantity: 2, sku: "LOL", grams: 2500 }],
  shipping_address: { first_name: "Alex", last_name: "Smith", address1: "12 Sample Street", address2: "Unit 4", city: "Mandurah", province: "WA", zip: "6210", country: "Australia", phone: "+61400000000" },
  billing_address: { address1: "99 Billing Road", city: "Perth", zip: "6000" },
};

describe("order sync captures the delivery-facing fields", () => {
  const order = parseOrderWebhook(payload);

  it("takes the street address from the shipping address", () => {
    expect(order.address1).toBe("12 Sample Street");
    expect(order.address2).toBe("Unit 4");
    expect(order.city).toBe("Mandurah");
    expect(order.postcode).toBe("6210");
  });

  it("uses the Shopify order note as the drop note", () => {
    expect(order.deliveryNotes).toBe("Leave at side gate");
  });

  it("keeps the customer's first name only", () => {
    expect(order.customerFirstName).toBe("Alex");
    expect(JSON.stringify(order)).not.toContain("Smith");
  });

  it("captures no email, phone or billing address", () => {
    const serialised = JSON.stringify(order);
    expect(serialised).not.toContain("alex@example.com");
    expect(serialised).not.toContain("+61400000000");
    expect(serialised).not.toContain("99 Billing Road");
    expect(serialised).not.toContain("Perth");
  });

  it("tolerates a payload with no address, note or customer name", () => {
    const bare = parseOrderWebhook({ admin_graphql_api_id: "gid://shopify/Order/2", name: "#1002" });
    expect(bare.address1).toBeNull();
    expect(bare.deliveryNotes).toBeNull();
    expect(bare.customerFirstName).toBeNull();
  });

  it("falls back to the customer record when the address has no first name", () => {
    const order2 = parseOrderWebhook({ ...payload, shipping_address: { ...payload.shipping_address, first_name: "" } });
    expect(order2.customerFirstName).toBe("Alex");
  });
});

describe("chat access follows assignment status", () => {
  const chat = source("services/chat.server.ts");

  it("scopes driver access to open delivery orders in an active status", () => {
    expect(chat).toContain('const OPEN_STATUSES = ["PENDING", "ASSIGNED", "SCHEDULED", "OUT_FOR_DELIVERY"]');
    // DELIVERED is absent from OPEN_STATUSES, so access lapses on completion.
    expect(chat).not.toMatch(/OPEN_STATUSES[^;]*DELIVERED/);
  });

  it("denies the driver a delivered order's thread by status and by mode", () => {
    expect(chat).toContain('kind: "ORDER_DELIVERY", status: "OPEN", assignment: { driverId, fulfillmentMode: "DELIVERY", status: { in: [...OPEN_STATUSES] } }');
  });

  it("denies the customer a delivered order's delivery thread", () => {
    expect(chat).toContain('{ kind: "ORDER_DELIVERY", assignment: { status: { in: [...OPEN_STATUSES] } } }');
  });

  it("leaves admin oversight unfiltered and still audited", () => {
    expect(chat).toContain("adminSearchConversations");
    expect(chat).toContain('action: "CHAT_READ_BY_ADMIN"');
    expect(chat).not.toMatch(/adminReadConversation[\s\S]{0,200}status: "OPEN"/);
  });

  it("never deletes messages", () => {
    expect(chat).not.toMatch(/message\.delete|deleteMany/);
  });
});

describe("pickup protections are unchanged", () => {
  const dispatch = source("services/dispatch.server.ts");
  const pickup = source("services/pickup.server.ts");
  const delivery = source("services/driver/delivery.server.ts");

  it("keeps pickup out of every driver-facing query", () => {
    for (const fragment of ["listAssignmentsForDriver", "getAssignmentForDriver"]) {
      const line = dispatch.split("\n").find((l) => l.includes(fragment)) ?? "";
      expect(line).toContain('fulfillmentMode: "DELIVERY"');
    }
    expect(delivery).toContain('fulfillmentMode: "DELIVERY"');
  });

  it("keeps the dispatch guards", () => {
    expect(dispatch).toContain('current.fulfillmentMode === "PICKUP"');
    expect(dispatch).toContain("Pickup orders are collected by the customer and cannot be assigned to a driver");
    expect(dispatch).toContain("Pickup orders cannot be scheduled for delivery");
  });

  it("keeps OUT_FOR_DELIVERY blocked from electing pickup", () => {
    expect(pickup).toContain('const DISPATCHED_STATUS = "OUT_FOR_DELIVERY"');
    expect(pickup).toContain('throw new PickupError("ALREADY_DISPATCHED")');
  });

  it("never exposes the private pickup address to the driver plane", () => {
    expect(delivery).not.toContain("PICKUP_ADDRESS");
    expect(delivery).not.toContain("pickupAddress");
  });
});
