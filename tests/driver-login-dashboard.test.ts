import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const countCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const activateDriver = vi.hoisted(() => vi.fn());
const resetPassword = vi.hoisted(() => vi.fn());

vi.mock("../app/db.server", () => ({
  default: {
    assignment: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        countCalls.push(where);
        return countCalls.length;
      }),
    },
  },
}));

vi.mock("../app/services/driver/auth.server", () => ({ activateDriver, resetPassword }));
vi.mock("../app/lib/driver-security.server", () => ({
  createDriverCsrfToken: () => "csrf",
  verifyDriverCsrfToken: () => true,
}));

const read = (file: string) => readFileSync(new URL(`../app/${file}`, import.meta.url), "utf8");

function post(url: string, fields: Record<string, string>) {
  return new Request(url, { method: "POST", body: new URLSearchParams(fields) });
}

describe("driver home counts", () => {
  beforeEach(() => { countCalls.length = 0; });

  it("scopes both counts to the signed-in driver's delivery work only", async () => {
    const { countDriverWork } = await import("../app/services/driver/delivery.server");
    const now = new Date("2026-10-01T00:00:00Z");
    await countDriverWork("driver-1", now);

    expect(countCalls).toHaveLength(2);
    for (const where of countCalls) {
      expect(where.driverId).toBe("driver-1");
      expect(where.fulfillmentMode).toBe("DELIVERY");
    }
    expect(countCalls[0].status).toEqual({ in: ["PENDING", "ASSIGNED", "SCHEDULED", "OUT_FOR_DELIVERY"] });
    expect(countCalls[1]).toMatchObject({ status: "SCHEDULED", scheduledFor: { gte: now } });
  });
});

describe("confirm-password check runs before any credential change", () => {
  const token = "t".repeat(32);
  const base = { token, password: "correct horse battery", csrfToken: "csrf" };

  beforeEach(() => { activateDriver.mockReset(); resetPassword.mockReset(); });

  it("rejects a mismatched activation without calling activateDriver", async () => {
    const { action } = await import("../app/routes/driver.activate");
    const result = await action({ request: post("https://x.test/driver/activate", { ...base, confirmPassword: "something else!!" }), params: {}, context: {} } as never);
    expect(result).toMatchObject({ ok: false, message: "The two passwords do not match." });
    expect(activateDriver).not.toHaveBeenCalled();
  });

  it("rejects a mismatched reset without calling resetPassword", async () => {
    const { action } = await import("../app/routes/driver.reset-password");
    const result = await action({ request: post("https://x.test/driver/reset-password", { ...base, confirmPassword: "something else!!" }), params: {}, context: {} } as never);
    expect(result).toMatchObject({ message: "The two passwords do not match." });
    expect(resetPassword).not.toHaveBeenCalled();
  });

  it("still passes matching passwords through to the unchanged services", async () => {
    resetPassword.mockResolvedValue(undefined);
    const { action } = await import("../app/routes/driver.reset-password");
    await expect(action({ request: post("https://x.test/driver/reset-password", { ...base, confirmPassword: base.password }), params: {}, context: {} } as never)).rejects.toBeInstanceOf(Response);
    expect(resetPassword).toHaveBeenCalledTimes(1);
  });
});

describe("signed-out driver screens use the shared auth card", () => {
  it("renders every auth screen through AuthCard with labelled, styled inputs", () => {
    for (const route of ["routes/driver.login.tsx", "routes/driver.activate.tsx", "routes/driver.forgot-password.tsx", "routes/driver.reset-password.tsx"]) {
      const source = read(route);
      expect(source).toContain("<AuthCard");
      expect(source).not.toContain('background: "white"');
      expect(source).not.toContain("style={{");
      expect(source).toContain('className="drv-input"');
    }
  });

  it("keeps the generic login failure message", () => {
    expect(read("routes/driver.login.tsx")).toContain('"Invalid email or password."');
  });

  it("uses the approved palette with AA-passing button and border colours", () => {
    const tokens = read("styles/tokens.css");
    expect(tokens).toContain("--ccs-accent: #ff2056");
    expect(tokens).toContain("--ccs-button: #e0184b");
    expect(tokens).toContain("--ccs-on-button: #ffffff");
    expect(tokens).toContain("--ccs-border-input: #71717a");
    expect(read("routes/driver.tsx")).toContain('import "../styles/tokens.css"');
  });
});
