import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const assignments = vi.hoisted(() => [] as Row[]);
const conversations = vi.hoisted(() => [] as Row[]);
const participants = vi.hoisted(() => [] as Row[]);
const messages = vi.hoisted(() => [] as Row[]);

const DRIVER = "driver-1";
const OTHER = "driver-2";
const CUSTOMER = "gid://shopify/Customer/9";

function matches(row: Row, where: Row, related?: (key: string, row: Row, filter: Row) => boolean): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && !(value instanceof Date)) {
      const filter = value as Row;
      if ("in" in filter) return (filter.in as unknown[]).includes(row[key]);
      if ("notIn" in filter) return !(filter.notIn as unknown[]).includes(row[key]);
      if ("not" in filter) return row[key] !== filter.not;
      if ("gte" in filter) return (row[key] as Date) >= (filter.gte as Date);
      if ("lt" in filter) return row[key] !== null && (row[key] as Date) < (filter.lt as Date);
      if (related) return related(key, row, filter);
      return false;
    }
    return row[key] === value;
  });
}

const client = vi.hoisted(() => ({
  assignment: {
    findMany: async ({ where }: { where: Row }) =>
      assignments.filter((row) => matches(row, where)).sort((a, b) => Number(a.scheduledFor) - Number(b.scheduledFor)).map((r) => ({ ...r })),
  },
  conversation: {
    findMany: async ({ where }: { where: Row }) =>
      conversations
        .filter((c) =>
          matches(c, where, (key, row, filter) => {
            if (key !== "assignment") return false;
            const assignment = assignments.find((a) => a.id === row.assignmentId);
            return Boolean(assignment && matches(assignment, filter));
          }),
        )
        .map((c) => ({
          id: c.id,
          participants: participants.filter((p) => p.conversationId === c.id && p.role === "DRIVER").map((p) => ({ lastReadAt: p.lastReadAt })),
        })),
  },
  message: {
    findMany: async ({ where }: { where: Row }) =>
      messages.filter((m) => matches(m, where)).map((m) => ({ conversationId: m.conversationId, createdAt: m.createdAt })),
  },
}));

vi.mock("../app/db.server", () => ({ default: client }));

const { driverUnreadCounts, driverUnreadTotal } = await import("../app/services/chat.server");
const { listScheduledForDriver, perthDateKey } = await import("../app/services/driver/delivery.server");

const at = (iso: string) => new Date(iso);

function assignment(id: string, overrides: Row = {}): Row {
  const row: Row = { id, shopifyOrderNumber: `#${id}`, driverId: DRIVER, fulfillmentMode: "DELIVERY", status: "SCHEDULED", scheduledFor: at("2026-09-12T02:00:00.000Z"), destinationCity: "Mandurah", destinationPostcode: "6210", lineItems: [{ quantity: 2 }], ...overrides };
  assignments.push(row);
  return row;
}

function thread(id: string, assignmentId: string, overrides: Row = {}) {
  conversations.push({ id, assignmentId, kind: "ORDER_DELIVERY", status: "OPEN", ...overrides });
  participants.push({ conversationId: id, role: "DRIVER", subjectId: DRIVER, lastReadAt: null });
}

const say = (conversationId: string, senderId: string, iso: string) =>
  messages.push({ conversationId, senderId, createdAt: at(iso) });

beforeEach(() => {
  assignments.length = 0;
  conversations.length = 0;
  participants.length = 0;
  messages.length = 0;
});

describe("scheduled deliveries", () => {
  const now = at("2026-09-11T00:00:00.000Z");

  it("groups this driver's future scheduled deliveries by Perth date", async () => {
    assignment("a1", { scheduledFor: at("2026-09-12T02:00:00.000Z") });
    assignment("a2", { scheduledFor: at("2026-09-12T06:00:00.000Z") });
    assignment("a3", { scheduledFor: at("2026-09-13T02:00:00.000Z") });

    const groups = await listScheduledForDriver(DRIVER, now);
    expect(groups.map((g) => g.date)).toEqual(["2026-09-12", "2026-09-13"]);
    expect(groups[0].deliveries.map((d) => d.id)).toEqual(["a1", "a2"]);
    expect(groups[0].deliveries[0]).toMatchObject({ shopifyOrderNumber: "#a1", destinationCity: "Mandurah", destinationPostcode: "6210", items: 2 });
  });

  it("groups on the Perth day, not the UTC day", () => {
    // 2026-09-11T18:00Z is already 2026-09-12 in Perth (UTC+8).
    expect(perthDateKey(at("2026-09-11T18:00:00.000Z"))).toBe("2026-09-12");
    expect(perthDateKey(at("2026-09-11T15:00:00.000Z"))).toBe("2026-09-11");
  });

  it("excludes another driver", async () => {
    assignment("a1", { driverId: OTHER });
    expect(await listScheduledForDriver(DRIVER, now)).toEqual([]);
  });

  it("excludes pickup orders", async () => {
    assignment("a1", { fulfillmentMode: "PICKUP" });
    expect(await listScheduledForDriver(DRIVER, now)).toEqual([]);
  });

  it("excludes an ASSIGNED order with no schedule, which belongs in Upcoming", async () => {
    assignment("a1", { status: "ASSIGNED", scheduledFor: null });
    expect(await listScheduledForDriver(DRIVER, now)).toEqual([]);
  });

  it("excludes past schedules", async () => {
    assignment("a1", { scheduledFor: at("2026-09-10T02:00:00.000Z") });
    expect(await listScheduledForDriver(DRIVER, now)).toEqual([]);
  });

  it.each(["OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "PENDING"])("excludes %s orders", async (status) => {
    assignment("a1", { status });
    expect(await listScheduledForDriver(DRIVER, now)).toEqual([]);
  });
});

describe("driver unread counts", () => {
  it("counts unread customer messages", async () => {
    assignment("a1", { status: "ASSIGNED" });
    thread("c1", "a1");
    say("c1", CUSTOMER, "2026-09-11T01:00:00.000Z");
    say("c1", CUSTOMER, "2026-09-11T02:00:00.000Z");

    expect(await driverUnreadCounts(DRIVER)).toEqual({ c1: 2 });
    expect(await driverUnreadTotal(DRIVER)).toBe(2);
  });

  it("never counts the driver's own messages", async () => {
    assignment("a1", { status: "ASSIGNED" });
    thread("c1", "a1");
    say("c1", DRIVER, "2026-09-11T01:00:00.000Z");
    say("c1", DRIVER, "2026-09-11T02:00:00.000Z");

    expect(await driverUnreadCounts(DRIVER)).toEqual({ c1: 0 });
  });

  it("counts only messages newer than the read marker", async () => {
    assignment("a1", { status: "ASSIGNED" });
    thread("c1", "a1");
    participants[0].lastReadAt = at("2026-09-11T01:30:00.000Z");
    say("c1", CUSTOMER, "2026-09-11T01:00:00.000Z");
    say("c1", CUSTOMER, "2026-09-11T02:00:00.000Z");

    expect(await driverUnreadCounts(DRIVER)).toEqual({ c1: 1 });
  });

  it("drops to zero once the marker passes every message", async () => {
    assignment("a1", { status: "ASSIGNED" });
    thread("c1", "a1");
    say("c1", CUSTOMER, "2026-09-11T01:00:00.000Z");
    participants[0].lastReadAt = at("2026-09-11T03:00:00.000Z");

    expect(await driverUnreadTotal(DRIVER)).toBe(0);
  });

  it("excludes a delivered order's conversation", async () => {
    assignment("a1", { status: "DELIVERED" });
    thread("c1", "a1");
    say("c1", CUSTOMER, "2026-09-11T01:00:00.000Z");

    expect(await driverUnreadCounts(DRIVER)).toEqual({});
    expect(await driverUnreadTotal(DRIVER)).toBe(0);
  });

  it("excludes a closed conversation", async () => {
    assignment("a1", { status: "ASSIGNED" });
    thread("c1", "a1", { status: "CLOSED" });
    say("c1", CUSTOMER, "2026-09-11T01:00:00.000Z");

    expect(await driverUnreadCounts(DRIVER)).toEqual({});
  });

  it("excludes pickup conversations", async () => {
    assignment("a1", { status: "ASSIGNED", fulfillmentMode: "PICKUP" });
    thread("c1", "a1", { kind: "PICKUP_ARRANGEMENT" });
    say("c1", CUSTOMER, "2026-09-11T01:00:00.000Z");

    expect(await driverUnreadCounts(DRIVER)).toEqual({});
  });

  it("excludes another driver's conversation", async () => {
    assignment("a1", { status: "ASSIGNED", driverId: OTHER });
    thread("c1", "a1");
    say("c1", CUSTOMER, "2026-09-11T01:00:00.000Z");

    expect(await driverUnreadCounts(DRIVER)).toEqual({});
  });

  it("keeps counts separate per conversation", async () => {
    assignment("a1", { status: "ASSIGNED" });
    assignment("a2", { status: "ASSIGNED" });
    thread("c1", "a1");
    thread("c2", "a2");
    say("c1", CUSTOMER, "2026-09-11T01:00:00.000Z");
    say("c2", CUSTOMER, "2026-09-11T01:00:00.000Z");
    say("c2", CUSTOMER, "2026-09-11T02:00:00.000Z");

    expect(await driverUnreadCounts(DRIVER)).toEqual({ c1: 1, c2: 2 });
    expect(await driverUnreadTotal(DRIVER)).toBe(3);
  });

  it("returns nothing when the driver has no accessible threads", async () => {
    expect(await driverUnreadCounts(DRIVER)).toEqual({});
    expect(await driverUnreadTotal(DRIVER)).toBe(0);
  });
});
