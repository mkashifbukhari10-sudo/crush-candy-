import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.DRIVER_CSRF_SECRET ??= "driver-csrf-integration-secret-at-least-32-characters";
process.env.SHOPIFY_API_SECRET ??= "integration-api-secret";
process.env.SHOPIFY_API_KEY ??= "integration-client-id";
process.env.SHOPIFY_APP_URL ??= "https://integration.invalid";

import db from "../app/db.server";
import { createDriverCsrfToken, verifyDriverCsrfToken } from "../app/lib/driver-security.server";
import { DriverAuthenticationError } from "../app/lib/errors.server";
import { activateDriver, loginDriver, logoutDriver, requireDriver, resetPassword, requestPasswordReset } from "../app/services/driver/auth.server";
import { createDriverAccount, setDriverStatus } from "../app/services/admin/driver-management.server";

const suite = process.env.RUN_DATABASE_TESTS === "1" ? describe : describe.skip;
const PREFIX = `m2-driver-${Date.now()}-`;
const request = new Request("https://integration.invalid/driver", { headers: { "user-agent": "m2-test", "x-forwarded-for": "192.0.2.44" } });

function requestWithCookie(cookie: string) { return new Request("https://integration.invalid/driver", { headers: { cookie, "user-agent": "m2-test" } }); }
function cookieFrom(headers: Headers) { return headers.get("set-cookie")!.split(";", 1)[0]; }

suite("M2 driver authentication", () => {
  async function clean() {
    await db.driver.deleteMany({ where: { account: { email: { startsWith: PREFIX } } } });
    await db.driverAccount.deleteMany({ where: { email: { startsWith: PREFIX } } });
  }
  beforeAll(async () => {
    await db.driverAuthEvent.deleteMany({ where: { emailTried: { startsWith: PREFIX } } });
    await clean();
  });
  afterAll(async () => {
    await db.driverAuthEvent.deleteMany({ where: { emailTried: { startsWith: PREFIX } } });
    await clean();
    await db.$disconnect();
  });

  it("activates an invite and logs in with an opaque session", async () => {
    const created = await createDriverAccount({ email: `${PREFIX}valid@example.com`, displayName: "Valid Driver", createdByAdminId: "admin-test", request });
    const activation = await activateDriver({ token: created.activationToken, password: "a-long-driver-password", request });
    const auth = await requireDriver(requestWithCookie(cookieFrom(activation.responseHeaders)));
    expect(auth.context.plane).toBe("driver");
    expect(auth.context.displayName).toBe("Valid Driver");
    await expect(activateDriver({ token: created.activationToken, password: "another-long-password", request })).rejects.toBeInstanceOf(DriverAuthenticationError);
  });

  it("rejects invalid and inactive login", async () => {
    const created = await createDriverAccount({ email: `${PREFIX}inactive@example.com`, displayName: "Inactive", createdByAdminId: "admin-test", request });
    const activation = await activateDriver({ token: created.activationToken, password: "a-long-driver-password", request });
    await setDriverStatus({ accountId: created.id, status: "SUSPENDED", adminId: "admin-test", request });
    await expect(loginDriver({ email: created.email, password: "a-long-driver-password", request })).rejects.toBeInstanceOf(DriverAuthenticationError);
    await expect(requireDriver(requestWithCookie(cookieFrom(activation.responseHeaders)))).rejects.toBeInstanceOf(DriverAuthenticationError);
  });

  it("reset revokes sessions and reset token is single use", async () => {
    const created = await createDriverAccount({ email: `${PREFIX}reset@example.com`, displayName: "Reset", createdByAdminId: "admin-test", request });
    await activateDriver({ token: created.activationToken, password: "a-long-driver-password", request });
    const loggedIn = await loginDriver({ email: created.email, password: "a-long-driver-password", request });
    const reset = await requestPasswordReset({ email: created.email, request });
    expect(reset?.resetToken).toBeTruthy();
    await resetPassword({ token: reset!.resetToken, password: "a-different-long-password", request });
    await expect(requireDriver(requestWithCookie(cookieFrom(loggedIn.responseHeaders)))).rejects.toBeInstanceOf(DriverAuthenticationError);
    await expect(resetPassword({ token: reset!.resetToken, password: "another-long-password", request })).rejects.toBeInstanceOf(DriverAuthenticationError);
  });

  it("enforces idle and absolute session expiry and current-session logout", async () => {
    const created = await createDriverAccount({ email: `${PREFIX}expiry@example.com`, displayName: "Expiry", createdByAdminId: "admin-test", request });
    await activateDriver({ token: created.activationToken, password: "a-long-driver-password", request });
    const idle = await loginDriver({ email: created.email, password: "a-long-driver-password", request });
    await db.driverSession.update({ where: { id: idle.session.id }, data: { idleExpiresAt: new Date(Date.now() - 1_000) } });
    await expect(requireDriver(requestWithCookie(cookieFrom(idle.responseHeaders)))).rejects.toBeInstanceOf(DriverAuthenticationError);
    const absolute = await loginDriver({ email: created.email, password: "a-long-driver-password", request });
    await db.driverSession.update({ where: { id: absolute.session.id }, data: { absoluteExpiresAt: new Date(Date.now() - 1_000) } });
    await expect(requireDriver(requestWithCookie(cookieFrom(absolute.responseHeaders)))).rejects.toBeInstanceOf(DriverAuthenticationError);
    const current = await loginDriver({ email: created.email, password: "a-long-driver-password", request });
    await logoutDriver(requestWithCookie(cookieFrom(current.responseHeaders)));
    await expect(requireDriver(requestWithCookie(cookieFrom(current.responseHeaders)))).rejects.toBeInstanceOf(DriverAuthenticationError);
  });

  it("supports CSRF tokens only for their bound session", () => {
    const token = createDriverCsrfToken("session-a");
    expect(verifyDriverCsrfToken(token, "session-a")).toBe(true);
    expect(verifyDriverCsrfToken(token, "session-b")).toBe(false);
  });
});
