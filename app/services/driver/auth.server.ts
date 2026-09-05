import { Prisma } from "@prisma/client";

import db from "../../db.server";
import {
  DRIVER_ABSOLUTE_TIMEOUT_HOURS,
  DRIVER_IDLE_TIMEOUT_MINUTES,
  DRIVER_LOGIN_LOCK_MINUTES,
  DRIVER_LOGIN_MAX_FAILURES,
  DRIVER_RESET_TTL_MINUTES,
} from "../../config/constants";
import {
  DriverAuthenticationError,
  DriverAuthorizationError,
  DriverRateLimitError,
} from "../../lib/errors.server";
import { appendAuditLog } from "../audit/audit.server";
import {
  createOpaqueToken,
  getDriverCookieName,
  getDriverCookieOptions,
  getRequestIp,
  hashDriverIdentifier,
  hashDriverToken,
  hashIp,
  isExpired,
  normalizeDriverEmail,
  parseCookie,
  verifyDriverPassword,
  hashDriverPassword,
  verifyDriverCsrfToken,
} from "../../lib/driver-security.server";

export type DriverAuthContext = {
  readonly plane: "driver";
  readonly accountId: string;
  readonly driverId: string;
  readonly sessionId: string;
  readonly email: string;
  readonly displayName: string;
};

export type DriverRequestContext = { context: DriverAuthContext; responseHeaders: Headers };

async function consumeAuthBucket(namespace: string, subject: string, limit: number, windowSeconds: number) {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowSeconds * 1000);
  const keyHash = hashDriverIdentifier(`${namespace}:${subject}`);
  const rows = await db.$queryRaw<Array<{ count: number; resetAt: Date }>>(Prisma.sql`
    INSERT INTO "RateLimitBucket" ("keyHash", "count", "resetAt", "createdAt", "updatedAt")
    VALUES (${keyHash}, 1, ${resetAt}, ${now}, ${now})
    ON CONFLICT ("keyHash") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimitBucket"."resetAt" <= ${now} THEN ${resetAt} ELSE "RateLimitBucket"."resetAt" END,
      "updatedAt" = ${now}
    RETURNING "count", "resetAt"
  `);
  const bucket = rows[0];
  if (!bucket || bucket.count > limit) {
    throw new DriverRateLimitError(bucket ? Math.max(1, Math.ceil((bucket.resetAt.getTime() - now.getTime()) / 1000)) : 60);
  }
}

function authEventData(request: Request) {
  return {
    ip: hashIp(getRequestIp(request)),
    userAgent: request.headers.get("user-agent")?.slice(0, 500),
  };
}

export async function activateDriver(input: { token: string; password: string; request: Request }) {
  const tokenHash = hashDriverToken(input.token.trim());
  const account = await db.driverAccount.findFirst({ where: { activationTokenHash: tokenHash, status: "INVITED" } });
  if (!account || !account.activationExpiresAt || isExpired(account.activationExpiresAt)) {
    throw new DriverAuthenticationError("This activation link is invalid or expired.");
  }
  const passwordHash = await hashDriverPassword(input.password);
  const now = new Date();
  const updated = await db.$transaction(async (tx) => {
    const result = await tx.driverAccount.updateMany({
      where: { id: account.id, status: "INVITED", activationTokenHash: tokenHash, activationExpiresAt: { gt: now } },
      data: { passwordHash, status: "ACTIVE", activationTokenHash: null, activationExpiresAt: null, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null },
    });
    if (result.count !== 1) throw new DriverAuthenticationError("This activation link is invalid or already used.");
    await tx.driverAuthEvent.create({ data: { accountId: account.id, type: "ACTIVATED", ...authEventData(input.request) } });
    await appendAuditLog(tx, { actorPlane: "SYSTEM", actorId: account.id, action: "DRIVER_ACTIVATED", targetType: "DriverAccount", targetId: account.id, payload: {} });
    return tx.driverAccount.findUniqueOrThrow({ where: { id: account.id }, include: { driver: true } });
  });
  return createSession(updated, input.request);
}

async function createSession(account: { id: string; email: string; driver: { id: string; displayName: string } | null }, request: Request) {
  if (!account.driver) throw new DriverAuthenticationError();
  const rawToken = createOpaqueToken();
  const now = new Date();
  const idleExpiresAt = new Date(now.getTime() + DRIVER_IDLE_TIMEOUT_MINUTES * 60 * 1000);
  const absoluteExpiresAt = new Date(now.getTime() + DRIVER_ABSOLUTE_TIMEOUT_HOURS * 60 * 60 * 1000);
  const session = await db.driverSession.create({ data: { accountId: account.id, tokenHash: hashDriverToken(rawToken), issuedAt: now, lastSeenAt: now, idleExpiresAt, absoluteExpiresAt, ip: hashIp(getRequestIp(request)), userAgent: request.headers.get("user-agent")?.slice(0, 500) } });
  return { session, rawToken, context: { plane: "driver" as const, accountId: account.id, driverId: account.driver.id, sessionId: session.id, email: account.email, displayName: account.driver.displayName } satisfies DriverAuthContext, responseHeaders: new Headers({ "set-cookie": sessionCookie(rawToken) }) };
}

function sessionCookie(rawToken: string): string {
  const options = getDriverCookieOptions();
  return `${getDriverCookieName()}=${encodeURIComponent(rawToken)}; Max-Age=${options.maxAge}; Path=${options.path}; HttpOnly; SameSite=${options.sameSite === "lax" ? "Lax" : "Strict"}${options.secure ? "; Secure" : ""}`;
}

export async function loginDriver(input: { email: string; password: string; request: Request }) {
  const email = normalizeDriverEmail(input.email);
  await consumeAuthBucket("driver-login-ip", getRequestIp(input.request) ?? "unknown", 30, 15 * 60);
  const account = await db.driverAccount.findUnique({ where: { email }, include: { driver: true } });
  const passwordValid = await verifyDriverPassword(account?.passwordHash ?? null, input.password);
  const now = new Date();
  if (!account || !passwordValid || account.status !== "ACTIVE" || Boolean(account.lockedUntil && account.lockedUntil > now)) {
    if (account) {
      const failed = account.failedLoginCount + 1;
      const locked = failed >= DRIVER_LOGIN_MAX_FAILURES ? new Date(now.getTime() + DRIVER_LOGIN_LOCK_MINUTES * 60 * 1000) : null;
      await db.driverAccount.update({ where: { id: account.id }, data: { failedLoginCount: locked ? 0 : failed, lockedUntil: locked } });
      await db.driverAuthEvent.create({ data: { accountId: account.id, type: locked ? "LOCKOUT" : "LOGIN_FAIL", emailTried: email, ...authEventData(input.request) } });
    } else {
      await db.driverAuthEvent.create({ data: { type: "LOGIN_FAIL", emailTried: email, ...authEventData(input.request) } });
    }
    throw new DriverAuthenticationError("Invalid email or password.");
  }
  const session = await db.$transaction(async (tx) => {
    await tx.driverAccount.update({ where: { id: account.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now, lastLoginIp: hashIp(getRequestIp(input.request)) } });
    await tx.driverAuthEvent.create({ data: { accountId: account.id, type: "LOGIN_OK", ...authEventData(input.request) } });
    return createSessionWithClient(tx, account, input.request);
  });
  return session;
}

async function createSessionWithClient(tx: Prisma.TransactionClient, account: { id: string; email: string; driver: { id: string; displayName: string } | null }, request: Request) {
  if (!account.driver) throw new DriverAuthenticationError();
  const rawToken = createOpaqueToken();
  const now = new Date();
  const session = await tx.driverSession.create({ data: { accountId: account.id, tokenHash: hashDriverToken(rawToken), issuedAt: now, lastSeenAt: now, idleExpiresAt: new Date(now.getTime() + DRIVER_IDLE_TIMEOUT_MINUTES * 60 * 1000), absoluteExpiresAt: new Date(now.getTime() + DRIVER_ABSOLUTE_TIMEOUT_HOURS * 60 * 60 * 1000), ip: hashIp(getRequestIp(request)), userAgent: request.headers.get("user-agent")?.slice(0, 500) } });
  return { session, rawToken, context: { plane: "driver" as const, accountId: account.id, driverId: account.driver.id, sessionId: session.id, email: account.email, displayName: account.driver.displayName } satisfies DriverAuthContext, responseHeaders: new Headers({ "set-cookie": sessionCookie(rawToken) }) };
}

export async function requireDriver(request: Request): Promise<DriverRequestContext> {
  const rawToken = parseCookie(request, getDriverCookieName());
  if (!rawToken) throw new DriverAuthenticationError();
  const now = new Date();
  const session = await db.driverSession.findUnique({ where: { tokenHash: hashDriverToken(rawToken) }, include: { account: { include: { driver: true } } } });
  if (!session || session.revokedAt || isExpired(session.absoluteExpiresAt, now) || isExpired(session.idleExpiresAt, now) || session.account.status !== "ACTIVE" || (session.account.passwordChangedAt && session.account.passwordChangedAt > session.issuedAt) || !session.account.driver) {
    throw new DriverAuthenticationError();
  }
  const nextIdle = new Date(Math.min(session.absoluteExpiresAt.getTime(), now.getTime() + DRIVER_IDLE_TIMEOUT_MINUTES * 60 * 1000));
  await db.driverSession.update({ where: { id: session.id }, data: { lastSeenAt: now, idleExpiresAt: nextIdle } });
  return { context: { plane: "driver", accountId: session.account.id, driverId: session.account.driver.id, sessionId: session.id, email: session.account.email, displayName: session.account.driver.displayName }, responseHeaders: new Headers() };
}

export async function logoutDriver(request: Request, all = false): Promise<Headers> {
  const auth = await requireDriver(request);
  const now = new Date();
  if (all) await db.driverSession.updateMany({ where: { accountId: auth.context.accountId, revokedAt: null }, data: { revokedAt: now, revokedReason: "LOGOUT_ALL" } });
  else await db.driverSession.update({ where: { id: auth.context.sessionId }, data: { revokedAt: now, revokedReason: "LOGOUT" } });
  await db.driverAuthEvent.create({ data: { accountId: auth.context.accountId, type: all ? "LOGOUT_ALL" : "LOGOUT", ...authEventData(request) } });
  await appendAuditLog(db, { actorPlane: "DRIVER", actorId: auth.context.driverId, action: all ? "DRIVER_LOGOUT_ALL" : "DRIVER_LOGOUT", targetType: "DriverSession", targetId: auth.context.sessionId, payload: {} });
  return new Headers({ "set-cookie": `${getDriverCookieName()}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}` });
}

export async function requestPasswordReset(input: { email: string; request: Request }) {
  const email = normalizeDriverEmail(input.email);
  await consumeAuthBucket("driver-reset-ip", getRequestIp(input.request) ?? "unknown", 10, 60 * 60);
  const account = await db.driverAccount.findUnique({ where: { email } });
  if (!account || account.status === "DEACTIVATED") return null;
  const token = createOpaqueToken();
  const expiresAt = new Date(Date.now() + DRIVER_RESET_TTL_MINUTES * 60 * 1000);
  await db.$transaction(async (tx) => {
    await tx.driverAccount.update({ where: { id: account.id }, data: { resetTokenHash: hashDriverToken(token), resetExpiresAt: expiresAt } });
    await tx.driverAuthEvent.create({ data: { accountId: account.id, type: "RESET_REQUEST", ...authEventData(input.request) } });
  });
  return { resetToken: token, expiresAt, accountId: account.id };
}

export async function resetPassword(input: { token: string; password: string; request: Request }) {
  const tokenHash = hashDriverToken(input.token.trim());
  const account = await db.driverAccount.findFirst({ where: { resetTokenHash: tokenHash, resetExpiresAt: { gt: new Date() }, status: { not: "DEACTIVATED" } } });
  if (!account) throw new DriverAuthenticationError("This reset link is invalid or expired.");
  const passwordHash = await hashDriverPassword(input.password);
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.driverAccount.updateMany({ where: { id: account.id, resetTokenHash: tokenHash, resetExpiresAt: { gt: now } }, data: { passwordHash, resetTokenHash: null, resetExpiresAt: null, passwordChangedAt: now, status: "ACTIVE", failedLoginCount: 0, lockedUntil: null } });
    await tx.driverSession.updateMany({ where: { accountId: account.id, revokedAt: null }, data: { revokedAt: now, revokedReason: "PASSWORD_CHANGE" } });
    await tx.driverAuthEvent.create({ data: { accountId: account.id, type: "RESET_OK", ...authEventData(input.request) } });
    await appendAuditLog(tx, { actorPlane: "SYSTEM", actorId: account.id, action: "DRIVER_PASSWORD_RESET", targetType: "DriverAccount", targetId: account.id, payload: { sessionsRevoked: true } });
  });
}

export function requireDriverCsrf(request: Request, auth: DriverRequestContext, token: string | null) {
  void request;
  if (!token || !verifyDriverCsrfToken(token, auth.context.sessionId)) {
    throw new DriverAuthorizationError("CSRF validation failed.");
  }
}
