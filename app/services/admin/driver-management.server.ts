import db from "../../db.server";
import { DRIVER_ACTIVATION_TTL_HOURS, DRIVER_RESET_TTL_MINUTES } from "../../config/constants";
import { appendAuditLog } from "../audit/audit.server";
import { createOpaqueToken, getRequestIp, hashDriverToken, hashIp, normalizeDriverEmail } from "../../lib/driver-security.server";

function requestMeta(request: Request) { return { ip: hashIp(getRequestIp(request)), userAgent: request.headers.get("user-agent")?.slice(0, 500) }; }

export async function adminListDrivers() { return db.driverAccount.findMany({ include: { driver: true }, orderBy: { createdAt: "desc" }, take: 200 }); }

export async function createDriverAccount(input: { email: string; displayName: string; phone?: string; vehicleNote?: string; createdByAdminId: string; request: Request }) {
  const email = normalizeDriverEmail(input.email); const token = createOpaqueToken(); const now = new Date(); const expiresAt = new Date(now.getTime() + DRIVER_ACTIVATION_TTL_HOURS * 60 * 60 * 1000);
  const account = await db.$transaction(async (tx) => {
    const created = await tx.driverAccount.create({ data: { email, status: "INVITED", activationTokenHash: hashDriverToken(token), activationExpiresAt: expiresAt, createdByAdminId: input.createdByAdminId, driver: { create: { displayName: input.displayName.trim(), phone: input.phone?.trim() || null, vehicleNote: input.vehicleNote?.trim() || null } } }, include: { driver: true } });
    await tx.driverAuthEvent.create({ data: { accountId: created.id, type: "ACTIVATION_ISSUED", emailTried: email, ...requestMeta(input.request) } });
    await appendAuditLog(tx, { actorPlane: "ADMIN", actorId: input.createdByAdminId, action: "DRIVER_CREATED", targetType: "DriverAccount", targetId: created.id, payload: { status: "INVITED", driverId: created.driver?.id }, ipHash: hashIp(getRequestIp(input.request)) });
    return created;
  });
  return { id: account.id, email, expiresAt, activationToken: token };
}

export async function issueActivation(input: { accountId: string; adminId: string; request: Request }) {
  const token = createOpaqueToken(); const expiresAt = new Date(Date.now() + DRIVER_ACTIVATION_TTL_HOURS * 60 * 60 * 1000);
  const result = await db.driverAccount.updateMany({ where: { id: input.accountId, status: "INVITED" }, data: { activationTokenHash: hashDriverToken(token), activationExpiresAt: expiresAt } });
  if (result.count !== 1) return null;
  await db.driverAuthEvent.create({ data: { accountId: input.accountId, type: "ACTIVATION_ISSUED", ...requestMeta(input.request) } });
  await appendAuditLog(db, { actorPlane: "ADMIN", actorId: input.adminId, action: "DRIVER_ACTIVATION_ISSUED", targetType: "DriverAccount", targetId: input.accountId, payload: {} });
  return { activationToken: token, expiresAt };
}

export async function setDriverStatus(input: { accountId: string; status: "ACTIVE" | "SUSPENDED" | "DEACTIVATED"; adminId: string; request: Request; reason?: string }) {
  const now = new Date();
  return db.$transaction(async (tx) => {
    const account = await tx.driverAccount.update({ where: { id: input.accountId }, data: { status: input.status, deactivatedAt: input.status === "DEACTIVATED" ? now : null, deactivatedBy: input.status === "DEACTIVATED" ? input.adminId : null, deactivationReason: input.status === "DEACTIVATED" ? input.reason?.trim() || "Admin action" : null } });
    if (input.status !== "ACTIVE") await tx.driverSession.updateMany({ where: { accountId: input.accountId, revokedAt: null }, data: { revokedAt: now, revokedReason: `ADMIN_${input.status}` } });
    await tx.driverAuthEvent.create({ data: { accountId: input.accountId, type: input.status === "ACTIVE" ? "REACTIVATED" : "DEACTIVATED", ...requestMeta(input.request) } });
    await appendAuditLog(tx, { actorPlane: "ADMIN", actorId: input.adminId, action: input.status === "ACTIVE" ? "DRIVER_REACTIVATED" : "DRIVER_DEACTIVATED", targetType: "DriverAccount", targetId: input.accountId, payload: { status: input.status, reason: input.reason?.trim() || null }, ipHash: hashIp(getRequestIp(input.request)) });
    return account;
  });
}

export async function revokeDriverSessions(accountId: string, adminId: string, request: Request) {
  const now = new Date(); const result = await db.driverSession.updateMany({ where: { accountId, revokedAt: null }, data: { revokedAt: now, revokedReason: "ADMIN_REVOKE" } });
  await db.driverAuthEvent.create({ data: { accountId, type: "SESSIONS_REVOKED", ...requestMeta(request) } });
  await appendAuditLog(db, { actorPlane: "ADMIN", actorId: adminId, action: "DRIVER_SESSIONS_REVOKED", targetType: "DriverAccount", targetId: accountId, payload: { count: result.count } });
  return result.count;
}

export async function issuePasswordReset(input: { accountId: string; email: string; adminId: string; request: Request }) {
  const account = await db.driverAccount.findFirst({ where: { id: input.accountId, email: normalizeDriverEmail(input.email), status: { not: "DEACTIVATED" } } });
  if (!account) return null;
  const token = createOpaqueToken(); const expiresAt = new Date(Date.now() + DRIVER_RESET_TTL_MINUTES * 60 * 1000);
  await db.$transaction(async (tx) => {
    await tx.driverAccount.update({ where: { id: account.id }, data: { resetTokenHash: hashDriverToken(token), resetExpiresAt: expiresAt } });
    await tx.driverAuthEvent.create({ data: { accountId: account.id, type: "RESET_REQUEST", ...requestMeta(input.request) } });
    await appendAuditLog(tx, { actorPlane: "ADMIN", actorId: input.adminId, action: "DRIVER_PASSWORD_RESET_ISSUED", targetType: "DriverAccount", targetId: account.id, payload: {} });
  });
  return { resetToken: token, expiresAt };
}
