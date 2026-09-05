-- Milestone 1: private customer access foundation.
-- The existing Shopify Session table is intentionally unchanged.

CREATE TYPE "ApprovalSource" AS ENUM ('ACCESS_CODE', 'ADMIN_MANUAL', 'MIGRATION');
CREATE TYPE "AccessCodeStatus" AS ENUM ('ACTIVE', 'CLAIMED', 'REDEEMED', 'REVOKED');

CREATE TABLE "AccessCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeLast4" TEXT NOT NULL,
    "createdByAdminId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "AccessCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "claimedAt" TIMESTAMP(3),
    "claimedByCustomerId" TEXT,
    "redeemedAt" TIMESTAMP(3),
    "redeemedByCustomerId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AccessCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerProfile" (
    "id" TEXT NOT NULL,
    "shopifyCustomerId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvalSource" "ApprovalSource",
    "accessCodeUsedId" TEXT,
    "approvalRevokedAt" TIMESTAMP(3),
    "lastShopifyTagObservedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorPlane" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RateLimitBucket" (
    "keyHash" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("keyHash")
);

CREATE UNIQUE INDEX "AccessCode_codeHash_key" ON "AccessCode"("codeHash");
CREATE INDEX "AccessCode_status_expiresAt_idx" ON "AccessCode"("status", "expiresAt");
CREATE INDEX "AccessCode_redeemedByCustomerId_idx" ON "AccessCode"("redeemedByCustomerId");
CREATE UNIQUE INDEX "CustomerProfile_shopifyCustomerId_key" ON "CustomerProfile"("shopifyCustomerId");
CREATE UNIQUE INDEX "CustomerProfile_accessCodeUsedId_key" ON "CustomerProfile"("accessCodeUsedId");
CREATE INDEX "CustomerProfile_approvedAt_idx" ON "CustomerProfile"("approvedAt");
CREATE INDEX "AuditLog_targetType_targetId_createdAt_idx" ON "AuditLog"("targetType", "targetId", "createdAt");
CREATE INDEX "AuditLog_actorPlane_actorId_createdAt_idx" ON "AuditLog"("actorPlane", "actorId", "createdAt");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
CREATE INDEX "RateLimitBucket_resetAt_idx" ON "RateLimitBucket"("resetAt");

ALTER TABLE "CustomerProfile"
ADD CONSTRAINT "CustomerProfile_accessCodeUsedId_fkey"
FOREIGN KEY ("accessCodeUsedId") REFERENCES "AccessCode"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
