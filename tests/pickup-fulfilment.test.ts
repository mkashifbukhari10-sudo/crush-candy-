import { beforeEach, describe, expect, it, vi } from "vitest";

const PICKUP_ADDRESS = "Unit 3, 100 Private Way, Mirrabooka WA 6061";
const OWNER = "gid://shopify/Customer/9";
const OTHER = "gid://shopify/Customer/99";

type Row = Record<string, unknown>;
const assignments = vi.hoisted(() => new Map<string, Row>());
const conversations = vi.hoisted(() => [] as Row[]);
const events = vi.hoisted(() => [] as Row[]);
const audits = vi.hoisted(() => [] as Row[]);
let seq = 0;

vi.mock("../app/config/env.server", () => ({
  getServerEnvironment: () => ({ PICKUP_ADDRESS }),
}));

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object") {
      const filter = value as Row;
      if ("notIn" in filter) return !(filter.notIn as unknown[]).includes(row[key]);
      if ("in" in filter) return (filter.in as unknown[]).includes(row[key]);
    }
    return row[key] === value;
  });
}

const client = vi.hoisted(() => ({
  assignment: {
    findFirst: async ({ where }: { where: Row }) => {
      const row = [...assignments.values()].find((entry) => matches(entry, where));
      return row ? { ...row } : null;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const row = [...assignments.values()].find((entry) => matches(entry, where));
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  },
  conversation: {
    findFirst: async ({ where }: { where: Row }) => conversations.find((c) => matches(c, where)) ?? null,
    create: async ({ data }: { data: Row }) => {
      const row: Row = { id: `conv-${++seq}`, status: "OPEN", ...data };
      delete row.participants;
      conversations.push(row);
      return { ...row };
    },
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

const { PickupError, electPickup, getPickupForCustomer, isPickupEligible, orderWeightGrams } = await import(
  "../app/services/pickup.server"
);

const heavy = [{ weightGrams: 2500, quantity: 2 }];
const light = [{ weightGrams: 500, quantity: 1 }];

function seed(overrides: Row = {}) {
  const row: Row = {
    id: "assignment-1",
    shopifyOrderId: "gid://shopify/Order/1",
    shopifyOrderNumber: "#1001",
    shopifyCustomerId: OWNER,
    lineItems: heavy,
    status: "PENDING",
    fulfillmentMode: "DELIVERY",
    pickupElectedAt: null,
    driverId: null,
    assignedAt: null,
    assignedBy: null,
    scheduledFor: null,
    slaDueAt: new Date('2026-09-12T00:00:00.000Z'),
    ...overrides,
  };
  assignments.set(String(row.id), row);
  return row;
}

const stored = () => assignments.get("assignment-1") as Row;

beforeEach(() => {
  assignments.clear();
  conversations.length = 0;
  events.length = 0;
  audits.length = 0;
  seq = 0;
});

describe("eligibility", () => {
  it("uses normalized total applicable weight against the 5 kg threshold", () => {
    expect(orderWeightGrams(heavy)).toBe(5000);
    expect(isPickupEligible(heavy)).toBe(true);
    expect(isPickupEligible([{ weightValue: 4.999, weightUnit: "kg", quantity: 1 }])).toBe(false);
    expect(isPickupEligible([{ weightValue: 11, weightUnit: "lb", quantity: 1 }])).toBe(false); // 4989 g
    expect(isPickupEligible([{ weightValue: 12, weightUnit: "lb", quantity: 1 }])).toBe(true); // 5443 g
  });

  it("refuses a cart under 5 kg", async () => {
    seed({ lineItems: light });
    await expect(getPickupForCustomer("assignment-1", OWNER)).rejects.toMatchObject({ reason: "NOT_ELIGIBLE" });
    await expect(electPickup("assignment-1", OWNER)).rejects.toMatchObject({ reason: "NOT_ELIGIBLE" });
    expect(stored().fulfillmentMode).toBe("DELIVERY");
  });
});

describe("authorization", () => {
  it("refuses another customer's order", async () => {
    seed();
    await expect(getPickupForCustomer("assignment-1", OTHER)).rejects.toMatchObject({ reason: "NOT_FOUND" });
    await expect(electPickup("assignment-1", OTHER)).rejects.toMatchObject({ reason: "NOT_FOUND" });
    expect(stored().fulfillmentMode).toBe("DELIVERY");
  });

  it("refuses an unknown order", async () => {
    await expect(electPickup("missing", OWNER)).rejects.toBeInstanceOf(PickupError);
  });
});

describe("private pickup address", () => {
  it("is withheld before election and a read never elects", async () => {
    seed();
    const view = await getPickupForCustomer("assignment-1", OWNER);
    expect(view.elected).toBe(false);
    expect(view.address).toBeNull();
    expect(JSON.stringify(view)).not.toContain("Private Way");

    // The read must not have mutated anything.
    expect(stored().fulfillmentMode).toBe("DELIVERY");
    expect(stored().pickupElectedAt).toBeNull();
    expect(conversations).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("is returned only after a valid election", async () => {
    seed();
    const elected = await electPickup("assignment-1", OWNER);
    expect(elected.address).toBe(PICKUP_ADDRESS);
    expect((await getPickupForCustomer("assignment-1", OWNER)).address).toBe(PICKUP_ADDRESS);
  });

  it("is never persisted to the database", async () => {
    seed();
    await electPickup("assignment-1", OWNER);
    const persisted = JSON.stringify([...assignments.values(), conversations, events, audits]);
    expect(persisted).not.toContain(PICKUP_ADDRESS);
    expect(persisted).not.toContain("Private Way");
  });
});

describe("election transitions the order", () => {
  it("sets pickup, releases the driver and clears delivery scheduling", async () => {
    seed({ driverId: "driver-1", assignedAt: new Date(), assignedBy: "admin", scheduledFor: new Date(), status: "SCHEDULED" });

    const view = await electPickup("assignment-1", OWNER);
    expect(view.elected).toBe(true);

    const row = stored();
    expect(row.fulfillmentMode).toBe("PICKUP");
    expect(row.pickupElectedAt).toBeInstanceOf(Date);
    expect(row.driverId).toBeNull();
    expect(row.assignedAt).toBeNull();
    expect(row.assignedBy).toBeNull();
    expect(row.scheduledFor).toBeNull();
    expect(row.status).toBe("PENDING");
  });

  it("writes unassignment and election history", async () => {
    seed({ driverId: "driver-1" });
    await electPickup("assignment-1", OWNER);

    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(["UNASSIGNED", "PICKUP_ELECTED"]));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["ORDER_UNASSIGNED", "PICKUP_ELECTED"]));
    const unassigned = events.find((e) => e.type === "UNASSIGNED");
    expect(unassigned?.metadata).toMatchObject({ reason: "PICKUP_ELECTED", previousDriverId: "driver-1" });
  });

  it("records no unassignment when no driver was assigned", async () => {
    seed();
    await electPickup("assignment-1", OWNER);
    expect(events.filter((e) => e.type === "UNASSIGNED")).toHaveLength(0);
    expect(events.filter((e) => e.type === "PICKUP_ELECTED")).toHaveLength(1);
  });

  it("transitions an auto-assigned order safely", async () => {
    seed({ driverId: "auto-driver", assignedBy: "system:auto-assign", status: "ASSIGNED" });
    await electPickup("assignment-1", OWNER);
    expect(stored().driverId).toBeNull();
    expect(stored().fulfillmentMode).toBe("PICKUP");
  });

  it.each(["PENDING", "ASSIGNED", "SCHEDULED"])("allows election from %s", async (status) => {
    seed({ status, driverId: status === "PENDING" ? null : "driver-1" });
    const view = await electPickup("assignment-1", OWNER);
    expect(view.elected).toBe(true);
    expect(stored().fulfillmentMode).toBe("PICKUP");
    expect(stored().driverId).toBeNull();
  });

  it("refuses an order already OUT_FOR_DELIVERY and changes nothing", async () => {
    seed({ status: "OUT_FOR_DELIVERY", driverId: "driver-1", slaDueAt: new Date("2026-09-12T00:00:00.000Z") });
    await expect(electPickup("assignment-1", OWNER)).rejects.toMatchObject({ reason: "ALREADY_DISPATCHED" });
    const row = stored();
    expect(row.fulfillmentMode).toBe("DELIVERY");
    expect(row.pickupElectedAt).toBeNull();
    expect(row.driverId).toBe("driver-1");
    expect(row.slaDueAt).toBeInstanceOf(Date);
    expect(events).toHaveLength(0);
    expect(conversations).toHaveLength(0);
  });

  it.each(["DELIVERED", "FAILED", "CANCELLED"])("refuses a %s order", async (status) => {
    seed({ status });
    await expect(electPickup("assignment-1", OWNER)).rejects.toMatchObject({ reason: "TERMINAL_STATE" });
    expect(stored().fulfillmentMode).toBe("DELIVERY");
    expect(stored().slaDueAt).toBeInstanceOf(Date);
  });

  it("clears the delivery SLA on successful election", async () => {
    seed({ status: "ASSIGNED", driverId: "driver-1" });
    expect(stored().slaDueAt).toBeInstanceOf(Date);
    await electPickup("assignment-1", OWNER);
    expect(stored().slaDueAt).toBeNull();
  });
});

describe("chat", () => {
  it("closes the delivery conversation and opens a pickup thread", async () => {
    seed({ driverId: "driver-1" });
    conversations.push({ id: "conv-delivery", assignmentId: "assignment-1", kind: "ORDER_DELIVERY", status: "OPEN" });

    const view = await electPickup("assignment-1", OWNER);

    const delivery = conversations.find((c) => c.id === "conv-delivery");
    expect(delivery?.status).toBe("CLOSED");
    expect(delivery?.closedAt).toBeInstanceOf(Date);
    // History preserved: the row still exists and no messages were removed.
    expect(conversations.filter((c) => c.kind === "ORDER_DELIVERY")).toHaveLength(1);

    const pickup = conversations.find((c) => c.kind === "PICKUP_ARRANGEMENT");
    expect(pickup).toBeTruthy();
    expect(view.conversationId).toBe(pickup?.id);
  });

  it("reuses an existing pickup thread", async () => {
    seed();
    conversations.push({ id: "conv-pickup", assignmentId: "assignment-1", kind: "PICKUP_ARRANGEMENT", status: "OPEN" });
    const view = await electPickup("assignment-1", OWNER);
    expect(view.conversationId).toBe("conv-pickup");
    expect(conversations.filter((c) => c.kind === "PICKUP_ARRANGEMENT")).toHaveLength(1);
  });
});

describe("idempotency", () => {
  it("treats a repeated confirmation as a no-op", async () => {
    seed({ driverId: "driver-1" });
    const first = await electPickup("assignment-1", OWNER);
    const electedAt = stored().pickupElectedAt;

    const second = await electPickup("assignment-1", OWNER);

    expect(second.elected).toBe(true);
    expect(second.conversationId).toBe(first.conversationId);
    expect(stored().pickupElectedAt).toBe(electedAt);
    expect(events.filter((e) => e.type === "PICKUP_ELECTED")).toHaveLength(1);
    expect(conversations.filter((c) => c.kind === "PICKUP_ARRANGEMENT")).toHaveLength(1);
  });

  it("produces one election under concurrent confirmation", async () => {
    seed();
    await Promise.all([electPickup("assignment-1", OWNER), electPickup("assignment-1", OWNER)]);
    expect(events.filter((e) => e.type === "PICKUP_ELECTED")).toHaveLength(1);
    expect(conversations.filter((c) => c.kind === "PICKUP_ARRANGEMENT")).toHaveLength(1);
  });
});

describe("delivery orders are unaffected", () => {
  it("leaves a delivery order fully intact", async () => {
    const before = { ...seed({ driverId: "driver-1", status: "ASSIGNED" }) };
    await getPickupForCustomer("assignment-1", OWNER);
    expect(stored()).toEqual(before);
  });
});
