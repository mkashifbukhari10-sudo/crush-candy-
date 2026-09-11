import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const assignments = vi.hoisted(() => new Map<string, Row>());
const conversations = vi.hoisted(() => [] as Row[]);
const events = vi.hoisted(() => [] as Row[]);
const audits = vi.hoisted(() => [] as Row[]);

const DRIVER = "driver-1";
const OTHER_DRIVER = "driver-2";

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object") {
      const filter = value as Row;
      if ("in" in filter) return (filter.in as unknown[]).includes(row[key]);
      if ("notIn" in filter) return !(filter.notIn as unknown[]).includes(row[key]);
    }
    return row[key] === value;
  });
}

/** Mirrors Prisma: a `select` projects the row, so the service's field allow-list is real here. */
function project(row: Row, select?: Row): Row {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]));
}

const client = vi.hoisted(() => ({
  assignment: {
    findFirst: async ({ where, select }: { where: Row; select?: Row }) => {
      const row = [...assignments.values()].find((entry) => matches(entry, where));
      return row ? project(row, select) : null;
    },
    findUniqueOrThrow: async ({ where, select }: { where: { id: string }; select?: Row }) => project(assignments.get(where.id) as Row, select),
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const row = [...assignments.values()].find((entry) => matches(entry, where));
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  },
  conversation: {
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const c of conversations) if (matches(c, where)) { Object.assign(c, data); count += 1; }
      return { count };
    },
  },
  assignmentEvent: { create: async ({ data }: { data: Row }) => void events.push(data) },
  auditLog: { create: async ({ data }: { data: Row }) => void audits.push(data) },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
}));

vi.mock("../app/db.server", () => ({ default: client }));

const { DeliveryWorkflowError, completeDelivery, getDeliveryForDriver, startDelivery } = await import(
  "../app/services/driver/delivery.server"
);

function seed(overrides: Row = {}) {
  assignments.clear();
  conversations.length = 0;
  events.length = 0;
  audits.length = 0;
  const row: Row = {
    id: "a1",
    shopifyOrderId: "gid://shopify/Order/1",
    shopifyOrderNumber: "#1001",
    shopifyCustomerId: "gid://shopify/Customer/9",
    driverId: DRIVER,
    fulfillmentMode: "DELIVERY",
    status: "ASSIGNED",
    scheduledFor: null,
    dispatchedAt: null,
    deliveredAt: null,
    lineItems: [{ title: "Lollies", quantity: 2, sku: "LOL" }],
    destinationAddress1: "12 Sample Street",
    destinationAddress2: null,
    destinationCity: "Mandurah",
    destinationPostcode: "6210",
    deliveryNotes: "Leave at side gate",
    customerFirstName: "Alex",
    ...overrides,
  };
  assignments.set("a1", row);
  conversations.push({ id: "conv-1", assignmentId: "a1", kind: "ORDER_DELIVERY", status: "OPEN" });
  return row;
}

const stored = () => assignments.get("a1") as Row;

beforeEach(() => seed());

describe("delivery detail access", () => {
  it("returns the assigned driver's own delivery", async () => {
    const delivery = await getDeliveryForDriver("a1", DRIVER);
    expect(delivery?.shopifyOrderNumber).toBe("#1001");
  });

  it("refuses another driver", async () => {
    expect(await getDeliveryForDriver("a1", OTHER_DRIVER)).toBeNull();
  });

  it("refuses an unassigned order", async () => {
    seed({ driverId: null });
    expect(await getDeliveryForDriver("a1", DRIVER)).toBeNull();
  });

  it("refuses a pickup order even when the driver id still matches", async () => {
    seed({ fulfillmentMode: "PICKUP" });
    expect(await getDeliveryForDriver("a1", DRIVER)).toBeNull();
  });

  it.each(["PENDING", "DELIVERED", "FAILED", "CANCELLED"])("refuses a %s order", async (status) => {
    seed({ status });
    expect(await getDeliveryForDriver("a1", DRIVER)).toBeNull();
  });

  it("exposes only the permitted fields", async () => {
    const delivery = await getDeliveryForDriver("a1", DRIVER);
    expect(Object.keys(delivery ?? {}).sort()).toEqual([
      "customerFirstName", "deliveredAt", "deliveryNotes", "destinationAddress1", "destinationAddress2",
      "destinationCity", "destinationPostcode", "dispatchedAt", "id", "lineItems", "scheduledFor",
      "shopifyOrderNumber", "status",
    ]);
    const serialised = JSON.stringify(delivery);
    expect(serialised).not.toContain("shopifyCustomerId");
    expect(serialised).not.toContain("gid://shopify/Customer");
    expect(serialised).not.toMatch(/email|phone|slaDueAt|assignedBy/i);
  });
});

describe("mark out for delivery", () => {
  it.each(["ASSIGNED", "SCHEDULED"])("succeeds from %s", async (status) => {
    seed({ status });
    const delivery = await startDelivery("a1", DRIVER);
    expect(delivery.status).toBe("OUT_FOR_DELIVERY");
    expect(stored().dispatchedAt).toBeInstanceOf(Date);
    expect(stored().deliveredAt).toBeNull();
    expect(stored().driverId).toBe(DRIVER);
  });

  it("keeps the delivery chat open", async () => {
    await startDelivery("a1", DRIVER);
    expect(conversations[0].status).toBe("OPEN");
  });

  it("writes an event and an audit entry", async () => {
    await startDelivery("a1", DRIVER);
    expect(events).toContainEqual(expect.objectContaining({ type: "OUT_FOR_DELIVERY", actorPlane: "DRIVER", actorId: DRIVER }));
    expect(audits).toContainEqual(expect.objectContaining({ action: "DELIVERY_STARTED", actorPlane: "DRIVER" }));
  });

  it("cannot be started from PENDING", async () => {
    seed({ status: "PENDING" });
    await expect(startDelivery("a1", DRIVER)).rejects.toMatchObject({ reason: "INVALID_TRANSITION" });
    expect(stored().status).toBe("PENDING");
    expect(stored().dispatchedAt).toBeNull();
  });

  it("cannot be started by another driver", async () => {
    await expect(startDelivery("a1", OTHER_DRIVER)).rejects.toMatchObject({ reason: "NOT_FOUND" });
    expect(stored().status).toBe("ASSIGNED");
  });

  it("cannot be started on a pickup order", async () => {
    seed({ fulfillmentMode: "PICKUP" });
    await expect(startDelivery("a1", DRIVER)).rejects.toMatchObject({ reason: "NOT_FOUND" });
    expect(stored().status).toBe("ASSIGNED");
  });

  it("is idempotent and writes one event", async () => {
    await startDelivery("a1", DRIVER);
    const dispatchedAt = stored().dispatchedAt;
    const again = await startDelivery("a1", DRIVER);
    expect(again.status).toBe("OUT_FOR_DELIVERY");
    expect(stored().dispatchedAt).toBe(dispatchedAt);
    expect(events.filter((e) => e.type === "OUT_FOR_DELIVERY")).toHaveLength(1);
  });

  it("produces one transition under concurrency", async () => {
    await Promise.allSettled([startDelivery("a1", DRIVER), startDelivery("a1", DRIVER)]);
    expect(events.filter((e) => e.type === "OUT_FOR_DELIVERY")).toHaveLength(1);
  });
});

describe("mark delivered", () => {
  it("succeeds from OUT_FOR_DELIVERY and stamps deliveredAt", async () => {
    seed({ status: "OUT_FOR_DELIVERY", dispatchedAt: new Date("2026-09-11T01:00:00.000Z") });
    const delivery = await completeDelivery("a1", DRIVER);
    expect(delivery.status).toBe("DELIVERED");
    expect(stored().deliveredAt).toBeInstanceOf(Date);
    expect(stored().dispatchedAt).toEqual(new Date("2026-09-11T01:00:00.000Z"));
  });

  it("cannot jump straight from ASSIGNED", async () => {
    await expect(completeDelivery("a1", DRIVER)).rejects.toMatchObject({ reason: "INVALID_TRANSITION" });
    expect(stored().status).toBe("ASSIGNED");
    expect(stored().deliveredAt).toBeNull();
  });

  it.each(["PENDING", "SCHEDULED"])("cannot be completed from %s", async (status) => {
    seed({ status });
    await expect(completeDelivery("a1", DRIVER)).rejects.toBeInstanceOf(DeliveryWorkflowError);
    expect(stored().deliveredAt).toBeNull();
  });

  it("cannot be completed by another driver", async () => {
    seed({ status: "OUT_FOR_DELIVERY" });
    await expect(completeDelivery("a1", OTHER_DRIVER)).rejects.toMatchObject({ reason: "NOT_FOUND" });
    expect(stored().status).toBe("OUT_FOR_DELIVERY");
  });

  it("writes an event and an audit entry", async () => {
    seed({ status: "OUT_FOR_DELIVERY" });
    await completeDelivery("a1", DRIVER);
    expect(events).toContainEqual(expect.objectContaining({ type: "DELIVERED", actorPlane: "DRIVER", actorId: DRIVER }));
    expect(audits).toContainEqual(expect.objectContaining({ action: "DELIVERY_COMPLETED" }));
  });

  it("is idempotent and writes one event", async () => {
    seed({ status: "OUT_FOR_DELIVERY" });
    await completeDelivery("a1", DRIVER);
    const deliveredAt = stored().deliveredAt;
    await completeDelivery("a1", DRIVER);
    expect(stored().deliveredAt).toBe(deliveredAt);
    expect(events.filter((e) => e.type === "DELIVERED")).toHaveLength(1);
  });

  it("produces one transition under concurrency", async () => {
    seed({ status: "OUT_FOR_DELIVERY" });
    await Promise.allSettled([completeDelivery("a1", DRIVER), completeDelivery("a1", DRIVER)]);
    expect(events.filter((e) => e.type === "DELIVERED")).toHaveLength(1);
  });
});

describe("chat after delivery", () => {
  it("stays open through the active statuses", async () => {
    await startDelivery("a1", DRIVER);
    expect(conversations[0].status).toBe("OPEN");
  });

  it("closes on delivery without deleting history", async () => {
    seed({ status: "OUT_FOR_DELIVERY" });
    await completeDelivery("a1", DRIVER);
    expect(conversations[0].status).toBe("CLOSED");
    expect(conversations[0].closedAt).toBeInstanceOf(Date);
    // The row survives: only access is withdrawn, so admin oversight still reads it.
    expect(conversations).toHaveLength(1);
    expect(conversations[0].id).toBe("conv-1");
  });

  it("makes the delivery unreachable to the driver once delivered", async () => {
    seed({ status: "OUT_FOR_DELIVERY" });
    await completeDelivery("a1", DRIVER);
    expect(await getDeliveryForDriver("a1", DRIVER)).toBeNull();
  });
});
