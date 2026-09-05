import { Prisma } from "@prisma/client";

import db from "../../db.server";
import type {
  RateLimiter,
  RateLimitPolicy,
  RateLimitResult,
} from "../../lib/rate-limit.server";
import { hashPrivateIdentifier } from "../../lib/access-code-security.server";

async function consumeBucket(
  keyHash: string,
  policy: RateLimitPolicy,
): Promise<RateLimitResult> {
  const now = new Date();
  const nextResetAt = new Date(now.getTime() + policy.windowSeconds * 1000);
  const rows = await db.$queryRaw<Array<{ count: number; resetAt: Date }>>(
    Prisma.sql`
      INSERT INTO "RateLimitBucket" (
        "keyHash", "count", "resetAt", "createdAt", "updatedAt"
      )
      VALUES (${keyHash}, 1, ${nextResetAt}, ${now}, ${now})
      ON CONFLICT ("keyHash") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimitBucket"."resetAt" <= ${now} THEN 1
          ELSE "RateLimitBucket"."count" + 1
        END,
        "resetAt" = CASE
          WHEN "RateLimitBucket"."resetAt" <= ${now} THEN ${nextResetAt}
          ELSE "RateLimitBucket"."resetAt"
        END,
        "updatedAt" = ${now}
      RETURNING "count", "resetAt"
    `,
  );
  const bucket = rows[0];
  if (!bucket) throw new Error("Rate limit bucket update failed");

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((bucket.resetAt.getTime() - now.getTime()) / 1000),
  );

  return {
    allowed: bucket.count <= policy.limit,
    remaining: Math.max(0, policy.limit - bucket.count),
    ...(bucket.count > policy.limit ? { retryAfterSeconds } : {}),
  };
}

export const customerRateLimiter: RateLimiter = {
  consume(namespace, subject, policy) {
    const keyHash = hashPrivateIdentifier(
      "rate-limit",
      `${namespace}:${subject}`,
    );
    return consumeBucket(keyHash, policy);
  },
};

export function getRequestIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("cf-connecting-ip") || "unknown";
}
