import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const assignments = vi.hoisted(() => new Map<string, Row>());
const calls = vi.hoisted(() => [] as Row[]);

const client = vi.hoisted(() => ({
  assignment: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = assignments.get(where.id);
      return row ? { ...row } : null;
    },
    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => ({ ...(assignments.get(where.id) as Row) }),
    findMany: async ({ where }: { where: Row }) => {
      calls.push({ op: "findMany", where });
      return [...assignments.values()].filter((row) => Object.entries(where).every(([k, v]) => (v && typeof v === "object" ? true : row[k] === v)));
    },
    findFirst: async ({ where }: { where: Row }) => {
      calls.push({ op: "findFirst", where });
      const row = [...assignments.values()].find((r) => Object.entries(where).every(([k, v]) => (v && typeof v === "object" ? true : r[k] === v)));
      return row ? { ...row } : null;
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      Object.assign(assignments.get(where.id) ?? {}, data);
      return { ...(assignments.get(where.id) as Row) };
    },
  },
  driver: { findFirst: async () => ({ id: "driver-1" }) },
  appSettings: { findUnique: async () => ({ autoAssignEnabled: true, autoAssignDriverId: "driver-1" }) },
  assignmentEvent: { create: async () => undefined },
  auditLog: { create: async () => undefined },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
}));

vi.mock("../app/db.server", () => ({ default: client }));

const { assignOrder, deliverySlaScope, getAssignmentForDriver, listAssignmentsForDriver, listOverdueDeliveries, scheduleOrder } = await import(
  "../app/services/dispatch.server"
);

function seed(mode: "DELIVERY" | "PICKUP", overrides: Row = {}) {
  assignments.clear();
  assignments.set("a1", { id: "a1", status: "PENDING", fulfillmentMode: mode, driverId: null, scheduledFor: null, ...overrides });
}

beforeEach(() => calls.length = 0);

describe("dispatch refuses pickup orders server-side", () => {
  it("blocks assignment", async () => {
    seed("PICKUP");
    await expect(assignOrder({ assignmentId: "a1", driverId: "driver-1", actorId: "admin", actorPlane: "ADMIN" })).rejects.toThrow(/pickup/i);
    expect(assignments.get("a1")?.driverId).toBeNull();
  });

  it("blocks reassignment of a pickup order that somehow has a driver", async () => {
    seed("PICKUP", { driverId: "driver-0", status: "ASSIGNED" });
    await expect(assignOrder({ assignmentId: "a1", driverId: "driver-1", actorId: "admin", actorPlane: "ADMIN" })).rejects.toThrow(/pickup/i);
    expect(assignments.get("a1")?.driverId).toBe("driver-0");
  });

  it("blocks scheduling", async () => {
    seed("PICKUP", { driverId: "driver-1", status: "ASSIGNED" });
    await expect(scheduleOrder({ assignmentId: "a1", scheduledFor: new Date(Date.now() + 86_400_000), actorId: "admin" })).rejects.toThrow(/pickup/i);
    expect(assignments.get("a1")?.scheduledFor).toBeNull();
  });

  it("still allows assignment and scheduling for delivery orders", async () => {
    seed("DELIVERY");
    await expect(assignOrder({ assignmentId: "a1", driverId: "driver-1", actorId: "admin", actorPlane: "ADMIN" })).resolves.toBeTruthy();
    expect(assignments.get("a1")?.driverId).toBe("driver-1");
    await expect(scheduleOrder({ assignmentId: "a1", scheduledFor: new Date(Date.now() + 86_400_000), actorId: "admin" })).resolves.toBeTruthy();
    expect(assignments.get("a1")?.status).toBe("SCHEDULED");
  });
});

describe("driver queues exclude pickup orders", () => {
  it("filters Upcoming to delivery orders", async () => {
    seed("PICKUP", { driverId: "driver-1" });
    await listAssignmentsForDriver("driver-1");
    expect((calls.at(-1)?.where as Row).fulfillmentMode).toBe("DELIVERY");
  });

  it("filters the order detail lookup to delivery orders", async () => {
    seed("PICKUP", { driverId: "driver-1" });
    await getAssignmentForDriver("a1", "driver-1");
    expect((calls.at(-1)?.where as Row).fulfillmentMode).toBe("DELIVERY");
  });
});

describe("delivery SLA reporting excludes pickup", () => {
  const now = new Date("2026-09-11T12:00:00.000Z");

  it("scopes overdue work to delivery orders with a live SLA", () => {
    const scope = deliverySlaScope(now);
    expect(scope.fulfillmentMode).toBe("DELIVERY");
    expect(scope.slaDueAt).toEqual({ not: null, lt: now });
    expect(scope.status.in).toEqual(["PENDING", "ASSIGNED", "SCHEDULED", "OUT_FOR_DELIVERY"]);
  });

  it("queries only delivery orders when listing overdue work", async () => {
    seed("PICKUP", { slaDueAt: null });
    await listOverdueDeliveries(now);
    const where = calls.at(-1)?.where as Row;
    expect(where.fulfillmentMode).toBe("DELIVERY");
    expect(where.slaDueAt).toEqual({ not: null, lt: now });
  });

  it("leaves the delivery SLA scope unchanged for delivery orders", () => {
    expect(deliverySlaScope(now)).toEqual({
      fulfillmentMode: "DELIVERY",
      slaDueAt: { not: null, lt: now },
      status: { in: ["PENDING", "ASSIGNED", "SCHEDULED", "OUT_FOR_DELIVERY"] },
    });
  });
});
