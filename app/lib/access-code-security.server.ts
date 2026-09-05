import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { getCustomerSecurityConfig } from "../config/env.server";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CSRF_MAX_AGE_SECONDS = 15 * 60;

function hmac(value: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(value, "utf8").digest();
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function normalizeAccessCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashAccessCode(value: string, secret?: string): string {
  const key = secret ?? getCustomerSecurityConfig().accessCodeHashSecret;
  return hmac(`access-code:${normalizeAccessCode(value)}`, key).toString("hex");
}

export function hashPrivateIdentifier(
  namespace: string,
  value: string,
  secret?: string,
): string {
  const key = secret ?? getCustomerSecurityConfig().accessCodeHashSecret;
  return hmac(`${namespace}:${value}`, key).toString("hex");
}

export function generateAccessCode(): { plaintext: string; last4: string } {
  const bytes = randomBytes(20);
  let compact = "";

  for (let index = 0; index < bytes.length; index += 1) {
    compact += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
  }

  const grouped = compact.match(/.{1,4}/g)?.join("-") ?? compact;
  return {
    plaintext: `CCS-${grouped}`,
    last4: compact.slice(-4),
  };
}

interface CsrfPayload {
  customerId: string;
  issuedAt: number;
  nonce: string;
  shop: string;
}

export function createCustomerCsrfToken(
  shop: string,
  customerId: string,
  now = new Date(),
  secret?: string,
): string {
  const key = secret ?? getCustomerSecurityConfig().customerCsrfSecret;
  const payload: CsrfPayload = {
    customerId,
    issuedAt: Math.floor(now.getTime() / 1000),
    nonce: randomBytes(16).toString("base64url"),
    shop,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signature = hmac(`customer-csrf:${encoded}`, key).toString("base64url");
  return `${encoded}.${signature}`;
}

export function verifyCustomerCsrfToken(
  token: string,
  shop: string,
  customerId: string,
  now = new Date(),
  secret?: string,
): boolean {
  const key = secret ?? getCustomerSecurityConfig().customerCsrfSecret;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return false;

  const expected = hmac(`customer-csrf:${encoded}`, key).toString("base64url");
  if (!constantTimeEqual(signature, expected)) return false;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<CsrfPayload>;
    const nowSeconds = Math.floor(now.getTime() / 1000);

    return (
      payload.shop === shop &&
      payload.customerId === customerId &&
      typeof payload.issuedAt === "number" &&
      payload.issuedAt <= nowSeconds + 30 &&
      nowSeconds - payload.issuedAt <= CSRF_MAX_AGE_SECONDS &&
      typeof payload.nonce === "string" &&
      payload.nonce.length >= 16
    );
  } catch {
    return false;
  }
}
