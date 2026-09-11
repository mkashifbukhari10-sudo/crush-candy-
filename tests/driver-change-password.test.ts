import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const accounts = vi.hoisted(() => new Map<string, Row>());
const sessions = vi.hoisted(() => [] as Row[]);
const authEvents = vi.hoisted(() => [] as Row[]);
const audits = vi.hoisted(() => [] as Row[]);
const bucket = vi.hoisted(() => ({ count: 0 }));

const ACCOUNT = "account-1";
const OTHER_ACCOUNT = "account-2";
const DRIVER = "driver-1";
const SESSION = "session-current";

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object" && !(value instanceof Date)) {
      const filter = value as Row;
      if ("in" in filter) return (filter.in as unknown[]).includes(row[key]);
      if ("not" in filter) return row[key] !== filter.not;
    }
    return row[key] === value;
  });
}

const client = vi.hoisted(() => ({
  driverAccount: {
    findUnique: async ({ where }: { where: { id?: string } }) => {
      const row = accounts.get(String(where.id));
      return row ? { ...row, driver: { id: DRIVER, displayName: "Test Driver" } } : null;
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const row = accounts.get(String(where.id));
      if (!row || !matches(row, where)) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
    update: async ({ where, data }: { where: { id: string }; data: Row }) => {
      Object.assign(accounts.get(where.id) ?? {}, data);
      return {};
    },
  },
  driverSession: {
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      let count = 0;
      for (const s of sessions) if (matches(s, where)) { Object.assign(s, data); count += 1; }
      return { count };
    },
    create: async ({ data }: { data: Row }) => {
      const row = { id: `session-${sessions.length + 1}`, revokedAt: null, ...data };
      sessions.push(row);
      return { ...row };
    },
  },
  driverAuthEvent: { create: async ({ data }: { data: Row }) => void authEvents.push(data) },
  auditLog: { create: async ({ data }: { data: Row }) => void audits.push(data) },
  $queryRaw: async () => { bucket.count += 1; return [{ count: bucket.count, resetAt: new Date(Date.now() + 900_000) }]; },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
}));

vi.mock("../app/db.server", () => ({ default: client }));
// The driver security helpers derive secrets from server env; supply them without a real config.
vi.mock("../app/config/env.server", () => ({
  getDriverSecurityConfig: () => ({ csrfSecret: "test-csrf-secret", tokenSecret: "test-token-secret", cookieName: "__Host-ccs_driver", idleTimeoutMinutes: 120, absoluteTimeoutHours: 12 }),
  getServerEnvironment: () => ({ NODE_ENV: "test" }),
}));

const { DriverPasswordChangeError, changeDriverPassword } = await import("../app/services/driver/auth.server");
const { hashDriverPassword, verifyDriverPassword } = await import("../app/lib/driver-security.server");

const CURRENT = "current-password-123";
const NEXT = "brand-new-password-456";

const request = () => new Request("https://crush-candy-production.up.railway.app/driver/account", { method: "POST", headers: { "user-agent": "vitest" } });
const auth = (accountId = ACCOUNT) =>
  ({ context: { plane: "driver", accountId, driverId: DRIVER, sessionId: SESSION, email: "driver@example.com", displayName: "Test Driver" }, responseHeaders: new Headers() }) as never;

async function seed() {
  accounts.clear();
  sessions.length = 0;
  authEvents.length = 0;
  audits.length = 0;
  bucket.count = 0;

  const hash = await hashDriverPassword(CURRENT);
  accounts.set(ACCOUNT, { id: ACCOUNT, email: "driver@example.com", status: "ACTIVE", passwordHash: hash, failedLoginCount: 3, lockedUntil: null, passwordChangedAt: null, resetTokenHash: "stale-token", resetExpiresAt: new Date() });
  accounts.set(OTHER_ACCOUNT, { id: OTHER_ACCOUNT, email: "other@example.com", status: "ACTIVE", passwordHash: await hashDriverPassword("other-password-789"), failedLoginCount: 0, lockedUntil: null });
  sessions.push({ id: SESSION, accountId: ACCOUNT, revokedAt: null }, { id: "session-elsewhere", accountId: ACCOUNT, revokedAt: null }, { id: "session-other-driver", accountId: OTHER_ACCOUNT, revokedAt: null });
}

const stored = () => accounts.get(ACCOUNT) as Row;

beforeEach(seed);

describe("changing the password", () => {
  it("replaces the hash so the new password verifies and the old one stops working", async () => {
    await changeDriverPassword({ auth: auth(), currentPassword: CURRENT, newPassword: NEXT, request: request() });

    const hash = stored().passwordHash as string;
    expect(await verifyDriverPassword(hash, NEXT)).toBe(true);
    expect(await verifyDriverPassword(hash, CURRENT)).toBe(false);
  });

  it("uses the shared Argon2id configuration", async () => {
    await changeDriverPassword({ auth: auth(), currentPassword: CURRENT, newPassword: NEXT, request: request() });
    expect(stored().passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it("stamps the change and clears lockout counters and any stale reset token", async () => {
    await changeDriverPassword({ auth: auth(), currentPassword: CURRENT, newPassword: NEXT, request: request() });
    expect(stored().passwordChangedAt).toBeInstanceOf(Date);
    expect(stored().failedLoginCount).toBe(0);
    expect(stored().lockedUntil).toBeNull();
    expect(stored().resetTokenHash).toBeNull();
  });

  it("writes an auth event and an audit entry", async () => {
    await changeDriverPassword({ auth: auth(), currentPassword: CURRENT, newPassword: NEXT, request: request() });
    expect(authEvents).toContainEqual(expect.objectContaining({ type: "PASSWORD_CHANGE_OK", accountId: ACCOUNT }));
    expect(audits).toContainEqual(expect.objectContaining({ action: "DRIVER_PASSWORD_CHANGED", actorPlane: "DRIVER", actorId: DRIVER }));
  });
});

describe("rejections leave the password untouched", () => {
  it("rejects a wrong current password", async () => {
    const before = stored().passwordHash;
    await expect(changeDriverPassword({ auth: auth(), currentPassword: "not-the-password", newPassword: NEXT, request: request() })).rejects.toMatchObject({ reason: "INVALID_CURRENT" });
    expect(stored().passwordHash).toBe(before);
    expect(authEvents).toContainEqual(expect.objectContaining({ type: "PASSWORD_CHANGE_FAIL" }));
  });

  it("rejects reuse of the current password", async () => {
    const before = stored().passwordHash;
    await expect(changeDriverPassword({ auth: auth(), currentPassword: CURRENT, newPassword: CURRENT, request: request() })).rejects.toMatchObject({ reason: "SAME_PASSWORD" });
    expect(stored().passwordHash).toBe(before);
  });

  it.each(["", "short", "eleven-chrs"])("rejects a password below the policy length (%s)", async (weak) => {
    const before = stored().passwordHash;
    await expect(changeDriverPassword({ auth: auth(), currentPassword: CURRENT, newPassword: weak, request: request() })).rejects.toMatchObject({ reason: "WEAK_PASSWORD" });
    expect(stored().passwordHash).toBe(before);
  });

  it("accepts exactly the minimum length", async () => {
    await changeDriverPassword({ auth: auth(), currentPassword: CURRENT, newPassword: "123456789012", request: request() });
    expect(await verifyDriverPassword(stored().passwordHash as string, "123456789012")).toBe(true);
  });

  it("refuses an account that is not active", async () => {
    (stored() as Row).status = "SUSPENDED";
    await expect(changeDriverPassword({ auth: auth(), currentPassword: CURRENT, newPassword: NEXT, request: request() })).rejects.toThrow();
  });

  it("leaves another driver's credentials and sessions alone", async () => {
    const otherHash = (accounts.get(OTHER_ACCOUNT) as Row).passwordHash;
    await changeDriverPassword({ auth: auth(), currentPassword: CURRENT, newPassword: NEXT, request: request() });

    expect((accounts.get(OTHER_ACCOUNT) as Row).passwordHash).toBe(otherHash);
    expect(sessions.find((s) => s.id === "session-other-driver")?.revokedAt).toBeNull();
  });
});

describe("session behaviour", () => {
  it("revokes every existing session for this account", async () => {
    await changeDriverPassword({ auth: auth(), currentPassword: CURRENT, newPassword: NEXT, request: request() });
    for (const id of [SESSION, "session-elsewhere"]) {
      const session = sessions.find((s) => s.id === id);
      expect(session?.revokedAt).toBeInstanceOf(Date);
      expect(session?.revokedReason).toBe("PASSWORD_CHANGE");
    }
  });

  it("issues a fresh session for the current device and returns its cookie", async () => {
    const headers = await changeDriverPassword({ auth: auth(), currentPassword: CURRENT, newPassword: NEXT, request: request() });
    const cookie = headers.get("set-cookie") ?? "";

    expect(cookie).toContain("__Host-ccs_driver=");
    expect(cookie).toContain("HttpOnly");
    const live = sessions.filter((s) => s.accountId === ACCOUNT && s.revokedAt === null);
    expect(live).toHaveLength(1);
    expect(live[0].id).not.toBe(SESSION);
  });

  it("never puts a password value in the returned headers", async () => {
    const headers = await changeDriverPassword({ auth: auth(), currentPassword: CURRENT, newPassword: NEXT, request: request() });
    const serialised = JSON.stringify([...headers.entries()]);
    expect(serialised).not.toContain(CURRENT);
    expect(serialised).not.toContain(NEXT);
  });
});

describe("rate limiting", () => {
  it("blocks after repeated attempts within the window", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(changeDriverPassword({ auth: auth(), currentPassword: "wrong", newPassword: NEXT, request: request() })).rejects.toBeInstanceOf(DriverPasswordChangeError);
    }
    await expect(changeDriverPassword({ auth: auth(), currentPassword: CURRENT, newPassword: NEXT, request: request() })).rejects.toMatchObject({ name: "DriverRateLimitError" });
    // The password survived the blocked attempt.
    expect(await verifyDriverPassword(stored().passwordHash as string, CURRENT)).toBe(true);
  });
});

describe("no password value is ever persisted or logged", () => {
  it("keeps plaintext out of auth events, audit entries and session rows", async () => {
    await changeDriverPassword({ auth: auth(), currentPassword: CURRENT, newPassword: NEXT, request: request() });
    const serialised = JSON.stringify({ authEvents, audits, sessions });
    expect(serialised).not.toContain(CURRENT);
    expect(serialised).not.toContain(NEXT);
  });

  it("keeps plaintext out of a failed attempt too", async () => {
    await expect(changeDriverPassword({ auth: auth(), currentPassword: "not-the-password", newPassword: NEXT, request: request() })).rejects.toBeInstanceOf(DriverPasswordChangeError);
    const serialised = JSON.stringify({ authEvents, audits });
    expect(serialised).not.toContain("not-the-password");
    expect(serialised).not.toContain(NEXT);
  });
});

describe("route enforces its boundaries", () => {
  const route = readFileSync(new URL("../app/routes/driver.account.tsx", import.meta.url), "utf8");

  it("requires an authenticated driver on both loader and action", () => {
    expect(route.match(/requireDriver\(request\)/g) ?? []).toHaveLength(2);
    expect(route).toContain('throw redirect("/driver/login")');
  });

  it("requires CSRF before touching the password", () => {
    const csrfIndex = route.indexOf("requireDriverCsrf");
    expect(csrfIndex).toBeGreaterThan(-1);
    expect(csrfIndex).toBeLessThan(route.indexOf("changeDriverPassword({"));
  });

  it("rejects a confirmation mismatch before calling the service", () => {
    expect(route).toContain("if (newPassword !== confirmPassword)");
    expect(route.indexOf("newPassword !== confirmPassword")).toBeLessThan(route.indexOf("await changeDriverPassword"));
  });

  it("gives a generic message for a wrong current password", () => {
    expect(route).toContain("INVALID_CURRENT: \"That password change could not be completed.");
    expect(route).not.toMatch(/incorrect current password|wrong password|no such account/i);
  });

  it("returns no password value in action data and never caches the response", () => {
    expect(route).not.toMatch(/currentPassword,\s*newPassword\s*\}\s*\)|message: (currentPassword|newPassword)/);
    expect(route).toContain('"cache-control": "no-store"');
    expect(route).toContain('autoComplete="off"');
  });

  it("handles rate limiting with a retry-after", () => {
    expect(route).toContain("DriverRateLimitError");
    expect(route).toContain('"retry-after"');
  });
});
