import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";

import {
  DRIVER_MIN_PASSWORD_LENGTH,
  DRIVER_RESET_TTL_MINUTES,
} from "../config/constants";
import { getDriverSecurityConfig } from "../config/env.server";

export function normalizeDriverEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function assertDriverPassword(password: string): void {
  if (password.length < DRIVER_MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${DRIVER_MIN_PASSWORD_LENGTH} characters.`);
  }
}

export async function hashDriverPassword(password: string): Promise<string> {
  assertDriverPassword(password);
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyDriverPassword(
  passwordHash: string | null,
  password: string,
): Promise<boolean> {
  if (!passwordHash) return false;
  try {
    return await argon2.verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDriverToken(token: string): string {
  return createHmac("sha256", getDriverSecurityConfig().tokenSecret)
    .update(token, "utf8")
    .digest("hex");
}

export function hashDriverIdentifier(value: string): string {
  return createHmac("sha256", getDriverSecurityConfig().tokenSecret)
    .update(value.trim().toLowerCase(), "utf8")
    .digest("hex");
}

export function createDriverCsrfToken(sessionId: string): string {
  const expires = Math.floor(Date.now() / 1000) + DRIVER_RESET_TTL_MINUTES * 60;
  const payload = `${sessionId}.${expires}`;
  const signature = createHmac("sha256", getDriverSecurityConfig().csrfSecret)
    .update(payload, "utf8")
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyDriverCsrfToken(token: string, sessionId: string): boolean {
  const [tokenSessionId, expiresText, signature] = token.split(".");
  if (!tokenSessionId || !expiresText || !signature || tokenSessionId !== sessionId) {
    return false;
  }
  const expires = Number(expiresText);
  if (!Number.isSafeInteger(expires) || expires < Math.floor(Date.now() / 1000)) {
    return false;
  }
  const expected = createHmac("sha256", getDriverSecurityConfig().csrfSecret)
    .update(`${tokenSessionId}.${expiresText}`, "utf8")
    .digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function secureRandomId(): string {
  return randomBytes(16).toString("hex");
}

export function hashIp(ip: string | null | undefined): string | undefined {
  if (!ip) return undefined;
  return createHash("sha256").update(ip, "utf8").digest("hex");
}

export function getDriverCookieOptions() {
  const secure = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 12,
  };
}

export function getDriverCookieName(): string {
  return getDriverSecurityConfig().cookieName;
}

export function parseCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

export function getRequestIp(request: Request): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || undefined;
}

export function isExpired(date: Date | null | undefined, now = new Date()): boolean {
  return Boolean(date && date.getTime() <= now.getTime());
}
